import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

export const BACKEND_URL = process.env.MODUSNAP_BACKEND_URL || 'http://localhost:8188';
const BACKEND_MARKER_FILES = ['main.py', 'requirements.txt'] as const;

type BackendResolutionSource = 'env' | 'discovery';

type BackendResolutionSuccess = {
  ok: true;
  backendDir: string;
  source: BackendResolutionSource;
};

type BackendResolutionFailure = {
  ok: false;
  code: 'BACKEND_DIR_NOT_FOUND';
  message: string;
  checked: string[];
  instructions: string[];
};

export type BackendResolutionResult = BackendResolutionSuccess | BackendResolutionFailure;

function isValidBackendDir(candidate: string) {
  return BACKEND_MARKER_FILES.every((marker) => fs.existsSync(path.join(candidate, marker)));
}

function backendNotFound(checked: string[]): BackendResolutionFailure {
  return {
    ok: false,
    code: 'BACKEND_DIR_NOT_FOUND',
    message: [
      'ComfyUI backend directory not found.',
      'Set MODUSNAP_BACKEND_DIR to your "ComfyUI Backend" path, or place the backend in one of the supported layouts.',
    ].join(' '),
    checked,
    instructions: [
      'export MODUSNAP_BACKEND_DIR=/absolute/path/to/ComfyUI\\ Backend',
      'preferred: ../ComfyUI Backend',
      'legacy fallback: ./backend-comfyui, ../backend-comfyui, or ../../backend-comfyui',
    ],
  };
}

export function resolveWorkspaceRoot() {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), '..', '..'),
    path.resolve(process.cwd(), '..', '..', '..'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'start-backend.sh'))) {
      return candidate;
    }
  }

  return path.resolve(process.cwd(), '..', '..');
}

export function resolveBackendDirResult(): BackendResolutionResult {
  const envDir = process.env.MODUSNAP_BACKEND_DIR?.trim();
  if (envDir) {
    const resolvedEnvDir = path.resolve(envDir);
    if (isValidBackendDir(resolvedEnvDir)) {
      return { ok: true, backendDir: resolvedEnvDir, source: 'env' };
    }
    return backendNotFound([resolvedEnvDir]);
  }

  const root = resolveWorkspaceRoot();
  const candidates = [
    path.resolve(root, '..', 'ComfyUI Backend'),
    path.resolve(root, 'ComfyUI Backend'),
    path.resolve(root, '..', '..', 'ComfyUI Backend'),
    path.resolve(root, 'backend-comfyui'),
    path.resolve(root, '..', 'backend-comfyui'),
    path.resolve(root, '..', '..', 'backend-comfyui'),
  ];

  const found = candidates.find((candidate) => isValidBackendDir(candidate));
  if (found) {
    return { ok: true, backendDir: found, source: 'discovery' };
  }

  return backendNotFound(candidates);
}

export function resolveBackendDir() {
  const resolved = resolveBackendDirResult();
  if (resolved.ok) {
    return resolved.backendDir;
  }

  const detail = [
    resolved.message,
    `Checked: ${resolved.checked.join(', ')}`,
    ...resolved.instructions,
  ].join('\n');
  throw new Error(detail);
}

export function getRestartLogPath() {
  return path.join(resolveBackendDir(), 'user', 'modusnap_backend_restart.log');
}

export function runBackendPython(args: string[], timeoutMs = 180000) {
  const backendDir = resolveBackendDir();
  const venvPython = path.join(backendDir, 'venv', 'bin', 'python');
  if (!fs.existsSync(venvPython)) {
    return { ok: false, status: 1, output: 'ComfyUI backend venv missing', backendDir };
  }

  const proc = spawnSync(venvPython, args, {
    cwd: backendDir,
    encoding: 'utf-8',
    timeout: timeoutMs,
    env: {
      ...process.env,
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
    },
  });

  const output = `${proc.stdout || ''}${proc.stderr || ''}`.trim() || '(no output)';
  return {
    ok: proc.status === 0,
    status: proc.status ?? 1,
    output,
    backendDir,
  };
}

export async function isBackendUp() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(`${BACKEND_URL}/system_stats`, {
      cache: 'no-store',
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    return res.ok;
  } catch {
    return false;
  }
}

export async function isBackendPortListening(host = 'localhost', port = 8188, timeoutMs = 2000) {
  return await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

export function restartBackendDetached() {
  const root = resolveWorkspaceRoot();
  const scriptPath = path.join(root, 'start-backend.sh');
  const logPath = getRestartLogPath();

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const command = `cd "${root}" && "${scriptPath}" >> "${logPath}" 2>&1`;

  const child = spawn('bash', ['-lc', command], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return {
    started: true,
    pid: child.pid,
    logPath,
  };
}

export async function restartBackendSafely() {
  try {
    const rebootRes = await fetch(`${BACKEND_URL}/v2/manager/reboot`, { method: 'GET', cache: 'no-store' });
    const details = await rebootRes.text();
    if (rebootRes.ok) {
      return {
        ok: true,
        mode: 'manager_reboot' as const,
        details: details || 'reboot-requested',
      };
    }
  } catch {
    // Fall back below.
  }

  if (await isBackendUp()) {
    return {
      ok: true,
      mode: 'already_running' as const,
      details: 'Backend already running; skipped detached restart to avoid duplicate process.',
    };
  }

  const started = restartBackendDetached();
  return {
    ok: true,
    mode: 'detached_start' as const,
    ...started,
  };
}

export function tailFile(filePath: string, maxLines = 120) {
  if (!fs.existsSync(filePath)) return '';
  let fd: number | null = null;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) return '';
    fd = fs.openSync(filePath, 'r');

    const linesNeeded = Math.max(20, Math.min(maxLines, 1000));
    const chunkSize = 64 * 1024;
    const maxBytesToRead = 4 * 1024 * 1024;
    let totalBytesRead = 0;
    let position = stat.size;
    let chunks: string[] = [];
    let newlineCount = 0;

    while (position > 0 && newlineCount <= linesNeeded + 2 && totalBytesRead < maxBytesToRead) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;

      const buffer = Buffer.allocUnsafe(readSize);
      const bytesRead = fs.readSync(fd, buffer, 0, readSize, position);
      if (bytesRead <= 0) break;
      totalBytesRead += bytesRead;

      const chunk = buffer.subarray(0, bytesRead).toString('utf-8');
      chunks.unshift(chunk);
      newlineCount += (chunk.match(/\n/g) || []).length;
    }

    const text = chunks.join('');
    const lines = text.split('\n');
    return lines.slice(Math.max(0, lines.length - linesNeeded)).join('\n');
  } catch {
    return '';
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close errors.
      }
    }
  }
}
