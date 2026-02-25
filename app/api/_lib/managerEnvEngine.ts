import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolveBackendDir } from './backendControl';

type EnvTxStatus = 'planned' | 'running' | 'succeeded' | 'failed' | 'rolled_back';
type EnvTxKind = 'repair' | 'install';

type EnvStep = {
  id: string;
  command: string;
  ok: boolean;
  status: number;
  output: string;
  startedAt: string;
  finishedAt: string;
};

type EnvTx = {
  id: string;
  kind: EnvTxKind;
  status: EnvTxStatus;
  createdAt: string;
  updatedAt: string;
  requestedPackages: string[];
  planCommands: string[];
  steps: EnvStep[];
  pipCheckOutput?: string;
  pipHealthy?: boolean;
  rollbackOf?: string;
  snapshotBefore?: string | null;
  snapshotAfter?: string | null;
  error?: string | null;
};

type Store = {
  transactions: EnvTx[];
};

const MAX_TX = 200;
const MAX_OUTPUT = 12000;

function envRoot() {
  return path.join(resolveBackendDir(), 'user', 'modusnap_manager_env');
}

function txStorePath() {
  return path.join(envRoot(), 'transactions.json');
}

function snapshotsDir() {
  return path.join(envRoot(), 'snapshots');
}

function ensureDirs() {
  fs.mkdirSync(envRoot(), { recursive: true });
  fs.mkdirSync(snapshotsDir(), { recursive: true });
}

function readStore(): Store {
  ensureDirs();
  const p = txStorePath();
  if (!fs.existsSync(p)) return { transactions: [] };
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.transactions)) return { transactions: [] };
    return { transactions: parsed.transactions as EnvTx[] };
  } catch {
    return { transactions: [] };
  }
}

function writeStore(store: Store) {
  ensureDirs();
  const trimmed = {
    transactions: [...store.transactions].slice(-MAX_TX),
  };
  fs.writeFileSync(txStorePath(), JSON.stringify(trimmed, null, 2), 'utf-8');
}

function nowIso() {
  return new Date().toISOString();
}

function venvPythonPath(backendDir: string) {
  return path.join(backendDir, 'venv', 'bin', 'python');
}

function runPython(backendDir: string, args: string[]): EnvStep {
  const startedAt = nowIso();
  const python = venvPythonPath(backendDir);
  if (!fs.existsSync(python)) {
    const finishedAt = nowIso();
    return {
      id: randomUUID(),
      command: `python ${args.join(' ')}`,
      ok: false,
      status: 1,
      output: 'backend-comfyui/venv missing',
      startedAt,
      finishedAt,
    };
  }

  const proc = spawnSync(python, args, {
    cwd: backendDir,
    encoding: 'utf-8',
    timeout: 15 * 60 * 1000,
    env: {
      ...process.env,
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
    },
  });
  const finishedAt = nowIso();
  const output = `${proc.stdout || ''}${proc.stderr || ''}`.trim();
  return {
    id: randomUUID(),
    command: `${python} ${args.join(' ')}`,
    ok: proc.status === 0,
    status: proc.status ?? 1,
    output: (output || '(no output)').slice(0, MAX_OUTPUT),
    startedAt,
    finishedAt,
  };
}

function sanitizePackages(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const item of input) {
    const value = String(item || '').trim();
    if (!value) continue;
    // allow package specifiers like foo, foo==1.2.3, "foo<2", extras, direct refs.
    if (!/^[A-Za-z0-9_.\-<>=!~\[\],:@+/ ]+$/.test(value)) continue;
    out.add(value);
  }
  return Array.from(out);
}

function writeFreezeSnapshot(backendDir: string, tag: string): string | null {
  const freezeStep = runPython(backendDir, ['-m', 'pip', 'freeze']);
  if (!freezeStep.ok) return null;
  const file = path.join(snapshotsDir(), `${tag}.txt`);
  fs.writeFileSync(file, freezeStep.output, 'utf-8');
  return file;
}

function findTx(id: string): { store: Store; tx: EnvTx | null; index: number } {
  const store = readStore();
  const index = store.transactions.findIndex((tx) => tx.id === id);
  if (index < 0) return { store, tx: null, index: -1 };
  return { store, tx: store.transactions[index] ?? null, index };
}

function buildPlan(kind: EnvTxKind, requestedPackages: string[]) {
  const commands = [
    'python -m pip install -r requirements.txt',
    'python -m pip install -r manager_requirements.txt',
  ];
  if (kind === 'install' && requestedPackages.length) {
    commands.push(`python -m pip install ${requestedPackages.join(' ')}`);
  }
  commands.push('python -m pip check');
  return commands;
}

export function getEnvStatus() {
  const backendDir = resolveBackendDir();
  const venvExists = fs.existsSync(venvPythonPath(backendDir));
  const pipCheck = runPython(backendDir, ['-m', 'pip', 'check']);
  const store = readStore();
  const latest = store.transactions.at(-1) || null;
  return {
    ok: pipCheck.ok,
    backendDir,
    venvExists,
    pipHealthy: pipCheck.ok,
    pipCheckOutput: pipCheck.output,
    transactions: store.transactions.length,
    latestTransaction: latest
      ? {
          id: latest.id,
          status: latest.status,
          kind: latest.kind,
          updatedAt: latest.updatedAt,
        }
      : null,
  };
}

export function createPlan(input: { mode?: string; packages?: unknown }) {
  const mode = input.mode === 'install' ? 'install' : 'repair';
  const requestedPackages = sanitizePackages(input.packages);
  const tx: EnvTx = {
    id: randomUUID(),
    kind: mode,
    status: 'planned',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    requestedPackages,
    planCommands: buildPlan(mode, requestedPackages),
    steps: [],
    error: null,
  };
  const store = readStore();
  store.transactions.push(tx);
  writeStore(store);
  return tx;
}

export function applyTransaction(id: string) {
  const backendDir = resolveBackendDir();
  const { store, tx, index } = findTx(id);
  if (!tx) return { ok: false, status: 404, error: 'Transaction not found.' };
  if (!(tx.status === 'planned' || tx.status === 'failed')) {
    return { ok: false, status: 409, error: `Transaction is ${tx.status}; only planned/failed can be applied.` };
  }

  tx.status = 'running';
  tx.updatedAt = nowIso();
  tx.error = null;
  tx.snapshotBefore = writeFreezeSnapshot(backendDir, `${tx.id}-before`);
  store.transactions[index] = tx;
  writeStore(store);

  const steps: EnvStep[] = [];
  steps.push(runPython(backendDir, ['-m', 'pip', 'install', '-r', 'requirements.txt']));
  steps.push(runPython(backendDir, ['-m', 'pip', 'install', '-r', 'manager_requirements.txt']));
  if (tx.kind === 'install' && tx.requestedPackages.length) {
    steps.push(runPython(backendDir, ['-m', 'pip', 'install', ...tx.requestedPackages]));
  }
  const pipCheck = runPython(backendDir, ['-m', 'pip', 'check']);
  steps.push(pipCheck);

  tx.steps = tx.steps.concat(steps);
  tx.pipHealthy = pipCheck.ok;
  tx.pipCheckOutput = pipCheck.output;
  tx.snapshotAfter = writeFreezeSnapshot(backendDir, `${tx.id}-after`);
  tx.status = pipCheck.ok ? 'succeeded' : 'failed';
  tx.error = pipCheck.ok ? null : 'pip check reported conflicts after apply.';
  tx.updatedAt = nowIso();
  store.transactions[index] = tx;
  writeStore(store);

  return { ok: true, status: 200, transaction: tx };
}

export function rollbackTransaction(id: string) {
  const backendDir = resolveBackendDir();
  const { store, tx } = findTx(id);
  if (!tx) return { ok: false, status: 404, error: 'Transaction not found.' };
  if (!tx.snapshotBefore || !fs.existsSync(tx.snapshotBefore)) {
    return { ok: false, status: 409, error: 'No pre-apply snapshot found for this transaction.' };
  }

  const rollbackTx: EnvTx = {
    id: randomUUID(),
    kind: 'repair',
    status: 'running',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    requestedPackages: [],
    planCommands: ['python -m pip install -r <snapshot-before>', 'python -m pip check'],
    steps: [],
    rollbackOf: tx.id,
    snapshotBefore: tx.snapshotBefore,
    error: null,
  };

  const install = runPython(backendDir, ['-m', 'pip', 'install', '-r', tx.snapshotBefore]);
  const check = runPython(backendDir, ['-m', 'pip', 'check']);
  rollbackTx.steps.push(install, check);
  rollbackTx.pipHealthy = check.ok;
  rollbackTx.pipCheckOutput = check.output;
  rollbackTx.snapshotAfter = writeFreezeSnapshot(backendDir, `${rollbackTx.id}-after`);
  rollbackTx.status = check.ok ? 'rolled_back' : 'failed';
  rollbackTx.error = check.ok ? null : 'Rollback completed but pip check still reports conflicts.';
  rollbackTx.updatedAt = nowIso();

  store.transactions.push(rollbackTx);
  writeStore(store);
  return { ok: true, status: 200, transaction: rollbackTx };
}

export function listTransactions() {
  const store = readStore();
  return store.transactions.map((tx) => ({
    id: tx.id,
    kind: tx.kind,
    status: tx.status,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
    requestedPackages: tx.requestedPackages,
    rollbackOf: tx.rollbackOf || null,
  }));
}

export function getTransaction(id: string) {
  const { tx } = findTx(id);
  if (!tx) return null;
  return tx;
}
