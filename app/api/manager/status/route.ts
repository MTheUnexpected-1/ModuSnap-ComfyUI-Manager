import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const BACKEND_URL = 'http://localhost:8188';

type DiagnosticIssue = {
  id: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  cause: string;
  evidence: string;
  fix: string;
};

type ProbeResult = {
  endpoint: string;
  ok: boolean;
  status?: number;
  error?: string;
};

type TorchRuntimeInfo = {
  torchVersion: string;
  cudaAvailable: boolean;
  cudaVersion: string | null;
  mpsAvailable: boolean;
};

type ManagerRuntimeSnapshot = ReturnType<typeof checkVenvAndManager>;
type HardwareRuntimeSnapshot = ReturnType<typeof getHardwareRuntimeInfo>;
type LogSnapshot = ReturnType<typeof getRecentLogErrors>;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const cache = {
  managerRuntime: null as CacheEntry<ManagerRuntimeSnapshot> | null,
  hardwareRuntime: null as CacheEntry<HardwareRuntimeSnapshot> | null,
  logInfo: null as CacheEntry<LogSnapshot> | null,
};

function withCache<T>(slot: keyof typeof cache, ttlMs: number, compute: () => T): T {
  const now = Date.now();
  const existing = cache[slot] as CacheEntry<T> | null;
  if (existing && existing.expiresAt > now) {
    return existing.value;
  }
  const value = compute();
  cache[slot] = { value, expiresAt: now + ttlMs } as CacheEntry<any>;
  return value;
}

function resolveBackendDir() {
  const fallback = path.resolve(process.cwd(), 'backend-comfyui');
  const candidates = [
    fallback,
    path.resolve(process.cwd(), '..', '..', 'backend-comfyui'),
    path.resolve(process.cwd(), '..', '..', '..', 'backend-comfyui'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return fallback;
}

async function getJson(url: string, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal }).finally(() => clearTimeout(timer));
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function probeManagerEndpoints() {
  const endpoints = [
    '/v2/manager/version',
    '/v2/manager/queue/status',
    '/v2/customnode/getlist?mode=cache&skip_update=true',
    '/v2/customnode/installed',
  ];
  const probes = await Promise.all(endpoints.map(async (endpoint): Promise<ProbeResult> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${BACKEND_URL}${endpoint}`, { method: 'GET', cache: 'no-store', signal: controller.signal }).finally(() => clearTimeout(timer));
      return { endpoint, ok: res.ok, status: res.status };
    } catch (error: any) {
      return { endpoint, ok: false, error: error?.message || String(error) };
    }
  }));

  const firstReachable = probes.find((probe) => probe.ok)?.endpoint || null;
  return { probes, managerEndpoint: firstReachable };
}

function checkVenvAndManager(backendDir: string, deepDiagnostics: boolean) {
  const venvPython = path.join(backendDir, 'venv', 'bin', 'python');
  if (!fs.existsSync(venvPython)) {
    return {
      venvFound: false,
      managerInstalled: false,
      managerImportRuntimeOk: false,
      managerRuntimeVersion: null as string | null,
      managerSpecCheckOutput: 'backend-comfyui/venv not found',
      managerImportRuntimeOutput: 'venv missing',
      pipCheckPassed: false,
      pipCheckOutput: 'venv missing',
    };
  }

  if (!deepDiagnostics) {
    const managerDir = path.join(backendDir, 'custom_nodes', 'ComfyUI-Manager');
    const managerLegacyDir = path.join(backendDir, 'custom_nodes', 'comfyui-manager');
    const managerInstalled = fs.existsSync(managerDir) || fs.existsSync(managerLegacyDir);
    return {
      venvFound: true,
      managerInstalled,
      managerImportRuntimeOk: managerInstalled,
      managerRuntimeVersion: null as string | null,
      managerSpecCheckOutput: 'skipped (fast status mode)',
      managerImportRuntimeOutput: 'skipped (fast status mode)',
      pipCheckPassed: true,
      pipCheckOutput: 'skipped (fast status mode)',
    };
  }

  const specCheck = spawnSync(
    venvPython,
    ['-c', 'import importlib.util; print(bool(importlib.util.find_spec("comfyui_manager")))'],
    { encoding: 'utf-8', timeout: 12000 }
  );

  const importRuntimeCheck = spawnSync(
    venvPython,
    ['-c', 'import comfyui_manager as m; print(getattr(m, "__version__", "unknown"))'],
    {
      cwd: backendDir,
      encoding: 'utf-8',
      timeout: 12000,
    }
  );

  const pipCheck = deepDiagnostics
    ? spawnSync(venvPython, ['-m', 'pip', 'check'], {
        encoding: 'utf-8',
        timeout: 5000,
      })
    : null;

  const specStdout = (specCheck.stdout || '').trim().toLowerCase();
  const managerInstalled = specStdout === 'true';

  const runtimeVersion = (importRuntimeCheck.stdout || '').trim() || null;
  const managerImportRuntimeOk = importRuntimeCheck.status === 0;

  return {
    venvFound: true,
    managerInstalled,
    managerImportRuntimeOk,
    managerRuntimeVersion: managerImportRuntimeOk ? runtimeVersion : null,
    managerSpecCheckOutput: `${specStdout || '(no output)'}${specCheck.stderr ? ` | stderr: ${specCheck.stderr.trim()}` : ''}`,
    managerImportRuntimeOutput: `${(importRuntimeCheck.stdout || '').trim() || '(no output)'}${importRuntimeCheck.stderr ? ` | stderr: ${importRuntimeCheck.stderr.trim()}` : ''}`,
    pipCheckPassed: pipCheck ? pipCheck.status === 0 : true,
    pipCheckOutput: pipCheck
      ? (`${(pipCheck.stdout || '').trim()}${pipCheck.stderr ? `\n${pipCheck.stderr.trim()}` : ''}`.trim() || '(no output)')
      : 'skipped (fast status mode)',
  };
}

function getHardwareRuntimeInfo(backendDir: string, includeTorchProbe: boolean) {
  const profilePath = path.join(backendDir, '.torch_profile');
  const depsMarkerPath = path.join(backendDir, '.deps_installed');
  const venvPython = path.join(backendDir, 'venv', 'bin', 'python');

  const hardwareProfile = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf-8').trim() : null;
  const depsSyncedAt = fs.existsSync(depsMarkerPath) ? fs.statSync(depsMarkerPath).mtime.toISOString() : null;

  let torchInfo: TorchRuntimeInfo | null = null;
  if (includeTorchProbe && fs.existsSync(venvPython)) {
    const torchProbe = spawnSync(
      venvPython,
      [
        '-c',
        'import json, torch; mps_ok = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()); print(json.dumps({"torchVersion": torch.__version__, "cudaAvailable": bool(torch.cuda.is_available()), "cudaVersion": torch.version.cuda, "mpsAvailable": mps_ok}))',
      ],
      { cwd: backendDir, encoding: 'utf-8', timeout: 3500 }
    );

    if (torchProbe.status === 0) {
      try {
        torchInfo = JSON.parse((torchProbe.stdout || '').trim());
      } catch {
        torchInfo = null;
      }
    }
  }

  return { hardwareProfile, depsSyncedAt, torchInfo };
}

function getRecentLogErrors(backendDir: string) {
  const logPath = path.join(backendDir, 'user', 'comfyui.log');
  if (!fs.existsSync(logPath)) {
    return { sslIssue: false, pipIssue: false, rembgIssue: false, rembgEvidence: '', logTail: '' };
  }

  const stat = fs.statSync(logPath);
  const maxBytes = 256 * 1024;
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(logPath, 'r');
  const len = stat.size - start;
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, start);
  fs.closeSync(fd);
  const raw = buf.toString('utf-8');
  const allLines = raw.split('\n');
  const lastServerStartIdx = allLines.map((line, idx) => ({ line, idx })).reverse()
    .find(({ line }) => line.includes('Starting server'))?.idx ?? Math.max(0, allLines.length - 320);
  const lines = allLines.slice(lastServerStartIdx).join('\n');
  const lower = lines.toLowerCase();

  const sslIssue = lines.includes('CERTIFICATE_VERIFY_FAILED');
  const pipIssue = /\bpip\b.*(error|failed|conflict|exception)/i.test(lines) || lower.includes('no broken requirements found') === false && lower.includes('pip check') && lower.includes('error');
  const rembgIssue = lower.includes('no onnxruntime backend found') || (lower.includes('install rembg') && lower.includes('onnxruntime'));
  const rembgEvidenceLine = allLines
    .slice(Math.max(lastServerStartIdx, allLines.length - 450))
    .find((line) => /onnxruntime backend found|install rembg/i.test(line));

  return {
    sslIssue,
    pipIssue,
    rembgIssue,
    rembgEvidence: rembgEvidenceLine || '',
    logTail: lines,
  };
}

export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get('deep') === '1';
  const backendDir = resolveBackendDir();
  const issues: DiagnosticIssue[] = [];

  let backendUp = false;
  let nodeCount = 0;
  let hasKSampler = false;
  let kSamplerHasSeedControl = false;
  let managerVersion: string | null = null;

  try {
    await getJson(`${BACKEND_URL}/system_stats`, 2500);
    backendUp = true;
  } catch (error: any) {
    issues.push({
      id: 'backend_down',
      severity: 'error',
      title: 'Backend is not reachable',
      cause: 'ComfyUI backend is not listening on localhost:8188.',
      evidence: error?.message || 'Connection refused while requesting /object_info.',
      fix: './start-backend.sh\n# or\nnpm run dev',
    });
  }

  if (backendUp) {
    try {
      const objectInfo = await getJson(`${BACKEND_URL}/object_info`, deep ? 12000 : 4000);
      nodeCount = Object.keys(objectInfo || {}).length;
      hasKSampler = Boolean(objectInfo?.KSampler);
      kSamplerHasSeedControl = Boolean(objectInfo?.KSampler?.input?.required?.seed?.[1]?.control_after_generate);
    } catch {
      // object_info may be slow while custom nodes initialize; keep backendUp true.
    }
  }

  const managerRuntime = withCache(
    'managerRuntime',
    deep ? 5000 : 20000,
    () => checkVenvAndManager(backendDir, deep)
  );
  const logInfo = withCache(
    'logInfo',
    deep ? 8000 : 30000,
    () => getRecentLogErrors(backendDir)
  );
  const hardwareInfo = withCache(
    'hardwareRuntime',
    deep ? 8000 : 30000,
    () => getHardwareRuntimeInfo(backendDir, deep)
  );

  let managerEndpoint: string | null = null;
  let probes: ProbeResult[] = [];
  if (backendUp) {
    const probed = await probeManagerEndpoints();
    managerEndpoint = probed.managerEndpoint;
    probes = probed.probes;

    if (!managerEndpoint) {
      issues.push({
        id: 'manager_routes_missing',
        severity: 'error',
        title: 'Manager API routes are not reachable',
        cause: 'ComfyUI started without manager compatibility endpoints or manager init failed.',
        evidence: JSON.stringify(probes),
        fix: 'Restart backend with manager flags:\npython3 main.py --enable-manager --enable-manager-legacy-ui\n# or use ./start-backend.sh',
      });
    } else if (managerEndpoint === '/v2/manager/version') {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const versionRes = await fetch(`${BACKEND_URL}/v2/manager/version`, { cache: 'no-store', signal: controller.signal }).finally(() => clearTimeout(timer));
        if (versionRes.ok) {
          managerVersion = (await versionRes.text()).trim();
        }
      } catch {
        // Keep managerVersion null.
      }
    }
  }

  const managerDetectedByRoutes = Boolean(managerEndpoint);
  const effectiveManagerInstalled = managerRuntime.managerInstalled || managerDetectedByRoutes;
  const effectiveManagerRuntimeOk = managerRuntime.managerImportRuntimeOk || managerDetectedByRoutes;

  if (!managerRuntime.venvFound) {
    issues.push({
      id: 'venv_missing',
      severity: 'error',
      title: 'Python venv is missing',
      cause: 'backend-comfyui/venv does not exist.',
      evidence: managerRuntime.managerSpecCheckOutput,
      fix: './start-backend.sh',
    });
  } else {
    if (!managerRuntime.managerInstalled && !managerDetectedByRoutes) {
      issues.push({
        id: 'manager_pkg_missing',
        severity: 'error',
        title: 'Manager package not detected in venv',
        cause: 'Direct manager package detection in backend venv failed and no manager routes were reachable.',
        evidence: managerRuntime.managerSpecCheckOutput,
        fix: 'cd backend-comfyui\nsource venv/bin/activate\npip install -r manager_requirements.txt',
      });
    }

    if (managerRuntime.managerInstalled && !managerRuntime.managerImportRuntimeOk && !managerDetectedByRoutes) {
      issues.push({
        id: 'manager_import_runtime_failed',
        severity: 'warning',
        title: 'Manager runtime import check failed',
        cause: 'Package exists but import failed in runtime context and manager routes were not reachable.',
        evidence: managerRuntime.managerImportRuntimeOutput,
        fix: 'cd backend-comfyui\nsource venv/bin/activate\npip install -r requirements.txt\npip install -r manager_requirements.txt\n# then restart backend',
      });
    }

    if (!managerRuntime.pipCheckPassed) {
      issues.push({
        id: 'pip_check_failed',
        severity: 'warning',
        title: 'pip dependency conflicts detected',
        cause: '`pip check` reported dependency problems in backend venv.',
        evidence: managerRuntime.pipCheckOutput,
        fix: 'cd backend-comfyui\nsource venv/bin/activate\npip install -r requirements.txt\npip install -r manager_requirements.txt\npip check',
      });
    }
  }

  if (logInfo.sslIssue) {
    issues.push({
      id: 'ssl_cert_issue',
      severity: 'warning',
      title: 'SSL certificate verification errors in backend log',
      cause: 'Manager registry fetch failed due to certificate verification.',
      evidence: 'Detected CERTIFICATE_VERIFY_FAILED in backend-comfyui/user/comfyui.log',
      fix: 'backend-comfyui/venv/bin/python -m pip install --upgrade certifi\nexport SSL_CERT_FILE=$(backend-comfyui/venv/bin/python -c "import certifi; print(certifi.where())")\n# restart backend',
    });
  }

  if (logInfo.pipIssue && !managerRuntime.pipCheckPassed) {
    issues.push({
      id: 'pip_log_issue',
      severity: 'warning',
      title: 'pip-related errors found in backend log',
      cause: 'Recent backend log contains pip failure markers.',
      evidence: 'Detected pip + error/failed markers in recent log tail.',
      fix: 'cd backend-comfyui\nsource venv/bin/activate\npip install -r requirements.txt\npip install -r manager_requirements.txt\npip check',
    });
  }

  if (logInfo.rembgIssue) {
    issues.push({
      id: 'rembg_onnx_missing',
      severity: 'error',
      title: 'Custom node runtime dependency missing (rembg/onnxruntime)',
      cause: 'A loaded custom node requires rembg and onnxruntime but backend environment does not have a compatible runtime.',
      evidence: logInfo.rembgEvidence || 'Detected rembg/onnxruntime missing markers in backend log.',
      fix: 'cd backend-comfyui\nsource venv/bin/activate\npip install "rembg[cpu]" onnxruntime\n# NVIDIA: pip install "rembg[gpu]" onnxruntime-gpu\n# backend restarts automatically from Apply Fix',
    });
  }

  const actions = issues.map((issue) => `${issue.title}: ${issue.fix}`);

  return NextResponse.json({
    backendUp,
    backendDir,
    managerEndpoint,
    managerRoutesReachable: Boolean(managerEndpoint),
    managerVersion,
    managerInstalledInVenv: effectiveManagerInstalled,
    managerImportRuntimeOk: effectiveManagerRuntimeOk,
    managerRuntimeVersion: managerRuntime.managerRuntimeVersion,
    venvFound: managerRuntime.venvFound,
    managerImportCheck: managerRuntime.managerSpecCheckOutput,
    managerImportRuntimeOutput: managerRuntime.managerImportRuntimeOutput,
    pipCheckPassed: managerRuntime.pipCheckPassed,
    pipCheckOutput: managerRuntime.pipCheckOutput,
    managerProbeResults: probes,
    hardwareProfile: hardwareInfo.hardwareProfile,
    dependenciesSyncedAt: hardwareInfo.depsSyncedAt,
    torchRuntime: hardwareInfo.torchInfo,
    nodeCount,
    hasKSampler,
    kSamplerHasSeedControl,
    sslIssue: logInfo.sslIssue,
    pipIssue: !managerRuntime.pipCheckPassed || logInfo.pipIssue,
    rembgIssue: logInfo.rembgIssue,
    diagnosticsMode: deep ? 'deep' : 'fast',
    actions,
    issues,
  });
}
