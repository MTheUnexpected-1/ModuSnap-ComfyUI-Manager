import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveBackendDir } from '../../_lib/backendControl';

type CatalogItem = {
  id?: string;
  title?: string;
  author?: string;
  description?: string;
  repository?: string;
  reference?: string;
  files?: string[];
  [key: string]: any;
};

function readHardwareProfile(backendDir: string) {
  const profilePath = path.join(backendDir, '.torch_profile');
  if (!fs.existsSync(profilePath)) {
    return { profile: 'unknown', hasNvidia: false, hasRocm: false, isDarwinArm64: false };
  }
  const profile = fs.readFileSync(profilePath, 'utf-8').trim();
  const lower = profile.toLowerCase();
  return {
    profile,
    hasNvidia: lower.includes('nvidia:true'),
    hasRocm: lower.includes('rocm:true'),
    isDarwinArm64: lower.includes('darwin-arm64'),
  };
}

function pipCheck(backendDir: string) {
  const pythonBin = path.join(backendDir, 'venv', 'bin', 'python');
  if (!fs.existsSync(pythonBin)) {
    return { ok: false, output: 'venv missing' };
  }
  const check = spawnSync(pythonBin, ['-m', 'pip', 'check'], { cwd: backendDir, encoding: 'utf-8', timeout: 15000 });
  const output = `${check.stdout || ''}${check.stderr || ''}`.trim();
  return { ok: check.status === 0, output: output || '(no output)' };
}

function getTextBlob(item: CatalogItem) {
  return [
    item.id,
    item.title,
    item.author,
    item.description,
    item.repository,
    item.reference,
    ...(Array.isArray(item.files) ? item.files : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function assessItem(item: CatalogItem, hw: ReturnType<typeof readHardwareProfile>) {
  const text = getTextBlob(item);
  const reasons: string[] = [];
  let decision: 'installable' | 'warning' | 'blocked' = 'installable';

  const cudaOnlyMarkers = /(cuda-only|requires cuda|nvidia-only|requires nvidia|tensorrt required|triton required)/i;
  const rocmOnlyMarkers = /(rocm-only|requires rocm|hip required)/i;

  if (!hw.hasNvidia && cudaOnlyMarkers.test(text)) {
    reasons.push('Pack appears to require NVIDIA/CUDA runtime and is marked as NVIDIA-only.');
    decision = 'blocked';
  } else if (!hw.hasNvidia && /(cuda|nvidia|tensorrt|cu12|cu11)/i.test(text)) {
    reasons.push('Pack metadata suggests NVIDIA/CUDA dependencies, but NVIDIA hardware is not detected.');
    decision = 'warning';
  }
  if (!hw.hasRocm && rocmOnlyMarkers.test(text)) {
    reasons.push('Pack appears to require ROCm runtime and is marked as ROCm-only.');
    decision = 'blocked';
  } else if (!hw.hasRocm && /(rocm|hip)/i.test(text)) {
    reasons.push('Pack metadata suggests ROCm dependencies, but ROCm hardware is not detected.');
    if (decision !== 'blocked') decision = 'warning';
  }
  if (hw.isDarwinArm64 && /(xformers|triton|flash-attn|bitsandbytes)/i.test(text)) {
    reasons.push('Pack may require binaries that are often unavailable on macOS ARM64.');
    if (decision !== 'blocked') decision = 'warning';
  }

  return {
    key: item.ui_id || item.__uiKey || item.id || item.title || item.repository || `item_${Date.now()}`,
    title: item.title || item.id || 'Unknown pack',
    decision,
    reasons,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const items = Array.isArray(body?.items) ? body.items as CatalogItem[] : [];
    const mode = (body?.mode as string | undefined) || 'install';
    if (items.length === 0) {
      return NextResponse.json({ error: 'No items provided for compatibility preflight.' }, { status: 400 });
    }

    const backendDir = resolveBackendDir();
    const hw = readHardwareProfile(backendDir);
    const baseline = pipCheck(backendDir);

    const perItem = items.map((item) => assessItem(item, hw));
    const warning = perItem.filter((row) => row.decision === 'warning').length;
    const blocked = perItem.filter((row) => row.decision === 'blocked').length;
    const installable = perItem.length - warning - blocked;
    const blockedKeys = perItem.filter((row) => row.decision === 'blocked').map((row) => row.key);
    const warningKeys = perItem.filter((row) => row.decision === 'warning').map((row) => row.key);
    const isLargeBatch = items.length > 600;

    const globalWarnings: string[] = [];
    if (!baseline.ok) {
      globalWarnings.push('Current environment already has pip mismatches. Apply diagnostics fix before large installs.');
    }
    if (mode === 'install' && items.length > 20) {
      globalWarnings.push('Large install batch detected. Install in smaller chunks for faster rollback if one pack fails.');
    }

    return NextResponse.json({
      ok: true,
      mode,
      hardwareProfile: hw.profile,
      pipHealthy: baseline.ok,
      pipCheckOutput: baseline.output,
      summary: {
        total: items.length,
        installable,
        warning,
        blocked,
      },
      globalWarnings,
      blockedKeys,
      warningKeys,
      // Avoid massive payloads for very large pack lists; keep full details for risky entries only.
      perItem: isLargeBatch ? perItem.filter((row) => row.decision !== 'installable') : perItem,
      compact: isLargeBatch,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to run compatibility preflight', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
