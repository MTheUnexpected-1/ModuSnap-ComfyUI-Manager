import { NextResponse } from 'next/server';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { BACKEND_URL, isBackendUp, resolveBackendDir, restartBackendDetached } from '../../_lib/backendControl';

function runPython(backendDir: string, args: string[]) {
  const venvPython = path.join(backendDir, 'venv', 'bin', 'python');
  if (!fs.existsSync(venvPython)) {
    return { ok: false, output: 'ModuSnap-ComfyUI-Backend/venv missing', status: 1 };
  }

  const proc = spawnSync(venvPython, args, {
    cwd: backendDir,
    encoding: 'utf-8',
    timeout: 120000,
    env: {
      ...process.env,
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
    },
  });

  const output = `${proc.stdout || ''}${proc.stderr || ''}`.trim();
  return { ok: proc.status === 0, output: output || '(no output)', status: proc.status ?? 1 };
}

function readRequirementNames(filePath: string) {
  if (!fs.existsSync(filePath)) return new Set<string>();
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  const out = new Set<string>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    const nameMatch = line.match(/^([A-Za-z0-9_.-]+)/);
    if (!nameMatch?.[1]) continue;
    out.add(nameMatch[1].toLowerCase());
  }
  return out;
}

function parseConflictParents(output: string) {
  const parents = new Set<string>();
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    let m = line.match(/^([A-Za-z0-9_.-]+)\s+.+\s+has requirement\s+/i);
    if (m?.[1]) {
      parents.add(m[1].toLowerCase());
      continue;
    }
    m = line.match(/^([A-Za-z0-9_.-]+)\s+.+\s+requires\s+.+,\s+but you have\s+/i);
    if (m?.[1]) {
      parents.add(m[1].toLowerCase());
      continue;
    }
    m = line.match(/^([A-Za-z0-9_.-]+)\s+.+\s+is not supported on this platform/i);
    if (m?.[1]) {
      parents.add(m[1].toLowerCase());
      continue;
    }
  }
  return Array.from(parents);
}

function enforceCompatibleEnvironment(backendDir: string) {
  const steps: Array<{ command: string; ok: boolean; output: string }> = [];
  const compatReqPath = path.join(backendDir, 'user', 'modusnap_compatible_requirements.txt');
  const coreReqPath = path.join(backendDir, 'requirements.txt');
  const mgrReqPath = path.join(backendDir, 'manager_requirements.txt');

  const coreReq = runPython(backendDir, ['-m', 'pip', 'install', '-r', 'requirements.txt']);
  steps.push({ command: 'python -m pip install -r requirements.txt', ok: coreReq.ok, output: coreReq.output });
  const mgrReq = runPython(backendDir, ['-m', 'pip', 'install', '-r', 'manager_requirements.txt']);
  steps.push({ command: 'python -m pip install -r manager_requirements.txt', ok: mgrReq.ok, output: mgrReq.output });
  if (fs.existsSync(compatReqPath)) {
    const compatReq = runPython(backendDir, ['-m', 'pip', 'install', '-r', compatReqPath]);
    steps.push({ command: `python -m pip install -r ${compatReqPath}`, ok: compatReq.ok, output: compatReq.output });
  }

  const protectedPkgs = new Set<string>([
    'pip',
    'setuptools',
    'wheel',
    'torch',
    'torchvision',
    'torchaudio',
    'comfyui-manager',
    'comfyui_frontend_package',
  ]);
  for (const name of readRequirementNames(coreReqPath)) protectedPkgs.add(name);
  for (const name of readRequirementNames(mgrReqPath)) protectedPkgs.add(name);
  for (const name of readRequirementNames(compatReqPath)) protectedPkgs.add(name);

  let finalCheck = runPython(backendDir, ['-m', 'pip', 'check']);
  steps.push({ command: 'python -m pip check', ok: finalCheck.ok, output: finalCheck.output });
  if (finalCheck.ok) {
    return { ok: true, finalCheck, steps, removed: [] as string[] };
  }

  const removed = new Set<string>();
  for (let round = 1; round <= 6; round++) {
    const conflictParents = parseConflictParents(finalCheck.output);
    const removable = conflictParents.filter((pkg) => !protectedPkgs.has(pkg));
    if (removable.length === 0) break;

    const uninstall = runPython(backendDir, ['-m', 'pip', 'uninstall', '-y', ...removable]);
    steps.push({
      command: `python -m pip uninstall -y ${removable.join(' ')}`,
      ok: uninstall.ok,
      output: uninstall.output,
    });
    for (const pkg of removable) removed.add(pkg);

    // Re-apply baseline constraints after pruning.
    const reCore = runPython(backendDir, ['-m', 'pip', 'install', '-r', 'requirements.txt']);
    steps.push({ command: `python -m pip install -r requirements.txt (round ${round})`, ok: reCore.ok, output: reCore.output });
    const reMgr = runPython(backendDir, ['-m', 'pip', 'install', '-r', 'manager_requirements.txt']);
    steps.push({ command: `python -m pip install -r manager_requirements.txt (round ${round})`, ok: reMgr.ok, output: reMgr.output });
    if (fs.existsSync(compatReqPath)) {
      const reCompat = runPython(backendDir, ['-m', 'pip', 'install', '-r', compatReqPath]);
      steps.push({ command: `python -m pip install -r ${compatReqPath} (round ${round})`, ok: reCompat.ok, output: reCompat.output });
    }

    finalCheck = runPython(backendDir, ['-m', 'pip', 'check']);
    steps.push({ command: `python -m pip check (round ${round})`, ok: finalCheck.ok, output: finalCheck.output });
    if (finalCheck.ok) break;
  }

  return { ok: finalCheck.ok, finalCheck, steps, removed: Array.from(removed).sort() };
}

async function restartBackendAfterFix() {
  try {
    const rebootRes = await fetch(`${BACKEND_URL}/v2/manager/reboot`, { method: 'GET', cache: 'no-store' });
    if (rebootRes.ok) {
      const details = await rebootRes.text();
      return { mode: 'manager_reboot', details: details || 'reboot-requested' };
    }
  } catch {
    // Continue to fallback logic.
  }

  if (await isBackendUp()) {
    return { mode: 'already_running', details: 'Backend reachable; skipped detached restart to avoid duplicate bind.' };
  }
  return restartBackendDetached();
}

function parsePipConflicts(output: string) {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
  const hasShaderflowScipyConflict = lines.some(
    (line) => line.includes('shaderflow') && line.includes('scipy~=1.15.3')
  );
  const hasGradioPillowConflict = lines.some(
    (line) => line.includes('gradio') && line.includes('pillow<12.0')
  );
  const hasDepthflowMissingDeps = lines.some(
    (line) => line.includes('depthflow') && (line.includes('requires gradio') || line.includes('requires shaderflow'))
  );
  const hasRembgStrictPins = lines.some(
    (line) => line.includes('rembg') && (line.includes('requires pillow') || line.includes('requires scipy'))
  );
  const hasFastapiStarletteConflict = lines.some(
    (line) => line.includes('fastapi') && line.includes('has requirement starlette<0.47.0,>=0.40.0')
  );
  const hasSSEStarletteConflict = lines.some(
    (line) => line.includes('sse-starlette') && line.includes('has requirement starlette>=0.49.1')
  );

  return {
    lines,
    hasShaderflowScipyConflict,
    hasGradioPillowConflict,
    hasDepthflowMissingDeps,
    hasRembgStrictPins,
    hasFastapiStarletteConflict,
    hasSSEStarletteConflict,
  };
}

function extractPipRequiredSpecs(output: string) {
  const specs = new Set<string>();
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const hasReqMatch = line.match(/has requirement (.+), but you have /i);
    if (hasReqMatch?.[1]) {
      specs.add(hasReqMatch[1].trim());
      continue;
    }

    const requiresMissingMatch = line.match(/requires (.+), which is not installed\./i);
    if (requiresMissingMatch?.[1]) {
      specs.add(requiresMissingMatch[1].trim());
    }
  }

  return Array.from(specs);
}

function applyCompatibilityProfile(backendDir: string) {
  const steps: Array<{ command: string; ok: boolean; output: string }> = [];
  const baseCompat = runPython(backendDir, [
    '-m', 'pip', 'install',
    'scipy~=1.15.3',
    'pillow<12',
    'rembg==2.0.69',
    'onnxruntime',
  ]);
  steps.push({
    command: 'python -m pip install scipy~=1.15.3 pillow<12 rembg==2.0.69 onnxruntime',
    ok: baseCompat.ok,
    output: baseCompat.output,
  });

  const depthflowCompat = runPython(backendDir, [
    '-m', 'pip', 'install', '--no-deps', 'gradio==5.35.0', 'shaderflow==0.9.1',
  ]);
  steps.push({
    command: 'python -m pip install --no-deps gradio==5.35.0 shaderflow==0.9.1',
    ok: depthflowCompat.ok,
    output: depthflowCompat.output,
  });

  return steps;
}

function applyTyperCompatibilityProfile(backendDir: string) {
  const steps: Array<{ command: string; ok: boolean; output: string }> = [];

  const installTyper = runPython(backendDir, ['-m', 'pip', 'install', 'typer==0.15.4', 'typer-slim==0.15.4', 'click<8.2,>=8.0.0']);
  steps.push({
    command: 'python -m pip install typer==0.15.4 typer-slim==0.15.4 click<8.2,>=8.0.0',
    ok: installTyper.ok,
    output: installTyper.output,
  });

  return steps;
}

function applyFastapiSSECompatibilityProfile(backendDir: string) {
  const steps: Array<{ command: string; ok: boolean; output: string }> = [];
  const pinned = runPython(backendDir, ['-m', 'pip', 'install', 'starlette>=0.40.0,<0.47.0', 'sse-starlette<3.0']);
  steps.push({
    command: 'python -m pip install starlette>=0.40.0,<0.47.0 sse-starlette<3.0',
    ok: pinned.ok,
    output: pinned.output,
  });
  return steps;
}

function autoHealPipConflicts(backendDir: string, initialPipCheckOutput: string) {
  const steps: Array<{ command: string; ok: boolean; output: string }> = [];
  const seenSpecSets = new Set<string>();
  let currentOutput = initialPipCheckOutput;
  let compatibilityApplied = false;

  for (let round = 1; round <= 6; round++) {
    const parsed = parsePipConflicts(currentOutput);
    const needsCompatibilityProfile =
      parsed.hasShaderflowScipyConflict ||
      parsed.hasGradioPillowConflict ||
      parsed.hasDepthflowMissingDeps ||
      parsed.hasRembgStrictPins;

    if (needsCompatibilityProfile && !compatibilityApplied) {
      compatibilityApplied = true;
      steps.push(...applyCompatibilityProfile(backendDir));
      const checkAfterCompat = runPython(backendDir, ['-m', 'pip', 'check']);
      steps.push({
        command: `python -m pip check (after compatibility profile, round ${round})`,
        ok: checkAfterCompat.ok,
        output: checkAfterCompat.output,
      });
      if (checkAfterCompat.ok) {
        return { steps, finalCheck: checkAfterCompat };
      }
      currentOutput = checkAfterCompat.output;
      continue;
    }

    const hasTyperConflict =
      currentOutput.includes('broken-source') && currentOutput.includes('typer~=0.15.4') ||
      currentOutput.includes('typer-slim') && currentOutput.includes('typer>=0.24.0');

    if (hasTyperConflict) {
      steps.push(...applyTyperCompatibilityProfile(backendDir));
      const checkAfterTyperFix = runPython(backendDir, ['-m', 'pip', 'check']);
      steps.push({
        command: `python -m pip check (after typer compatibility profile, round ${round})`,
        ok: checkAfterTyperFix.ok,
        output: checkAfterTyperFix.output,
      });
      if (checkAfterTyperFix.ok) {
        return { steps, finalCheck: checkAfterTyperFix };
      }
      currentOutput = checkAfterTyperFix.output;
      continue;
    }

    if (parsed.hasFastapiStarletteConflict && parsed.hasSSEStarletteConflict) {
      steps.push(...applyFastapiSSECompatibilityProfile(backendDir));
      const checkAfterFastapiSSEFix = runPython(backendDir, ['-m', 'pip', 'check']);
      steps.push({
        command: `python -m pip check (after fastapi/sse-starlette compatibility profile, round ${round})`,
        ok: checkAfterFastapiSSEFix.ok,
        output: checkAfterFastapiSSEFix.output,
      });
      if (checkAfterFastapiSSEFix.ok) {
        return { steps, finalCheck: checkAfterFastapiSSEFix };
      }
      currentOutput = checkAfterFastapiSSEFix.output;
      continue;
    }

    const specs = extractPipRequiredSpecs(currentOutput);
    if (specs.length === 0) {
      break;
    }

    const specKey = specs.slice().sort().join('|');
    if (seenSpecSets.has(specKey)) {
      break;
    }
    seenSpecSets.add(specKey);

    for (const spec of specs) {
      const installSpec = runPython(backendDir, ['-m', 'pip', 'install', spec]);
      steps.push({
        command: `python -m pip install ${spec}`,
        ok: installSpec.ok,
        output: installSpec.output,
      });
    }

    const check = runPython(backendDir, ['-m', 'pip', 'check']);
    steps.push({
      command: `python -m pip check (round ${round})`,
      ok: check.ok,
      output: check.output,
    });
    if (check.ok) {
      return { steps, finalCheck: check };
    }
    currentOutput = check.output;
  }

  const finalCheck = runPython(backendDir, ['-m', 'pip', 'check']);
  return { steps, finalCheck };
}

function hasNvidia() {
  try {
    const probe = spawnSync('bash', ['-lc', 'command -v nvidia-smi >/dev/null 2>&1'], { encoding: 'utf-8' });
    return probe.status === 0;
  } catch {
    return false;
  }
}

function getRembgInstallPlan() {
  const isDarwinArm64 = process.platform === 'darwin' && process.arch === 'arm64';
  const nvidia = hasNvidia();

  if (nvidia && !isDarwinArm64) {
    return {
      profile: `${process.platform}-${process.arch}-nvidia`,
      primary: ['-m', 'pip', 'install', 'scipy~=1.15.3', 'pillow<12', 'rembg==2.0.69', 'onnxruntime-gpu'],
      fallback: ['-m', 'pip', 'install', 'scipy~=1.15.3', 'pillow<12', 'rembg==2.0.69', 'onnxruntime'],
      verify: ['-c', 'import rembg, onnxruntime; print("ok")'],
    };
  }

  return {
    profile: `${process.platform}-${process.arch}-cpu`,
    primary: ['-m', 'pip', 'install', 'scipy~=1.15.3', 'pillow<12', 'rembg==2.0.69', 'onnxruntime'],
    fallback: null as string[] | null,
    verify: ['-c', 'import rembg, onnxruntime; print("ok")'],
  };
}

export async function POST(request: Request) {
  const backendDir = resolveBackendDir();

  try {
    const body = await request.json().catch(() => ({}));
    const issueId = body?.issueId as string | undefined;

    if (!issueId) {
      return NextResponse.json({ error: 'Missing issueId' }, { status: 400 });
    }

    if (issueId === 'ssl_cert_issue') {
      const certifi = runPython(backendDir, ['-m', 'pip', 'install', '--upgrade', 'certifi']);
      const certPath = runPython(backendDir, ['-c', 'import certifi; print(certifi.where())']);
      let restart = null as any;
      if (certifi.ok) {
        restart = await restartBackendAfterFix();
      }
      return NextResponse.json({
        ok: certifi.ok && certPath.ok,
        issueId,
        steps: [
          { command: 'python -m pip install --upgrade certifi', ok: certifi.ok, output: certifi.output },
          { command: 'python -c "import certifi; print(certifi.where())"', ok: certPath.ok, output: certPath.output },
        ],
        restartTriggered: Boolean(restart),
        restart,
        note: 'Backend restart was triggered automatically after SSL fix.',
      });
    }

    if (issueId === 'pip_check_failed' || issueId === 'pip_log_issue' || issueId === 'manager_import_runtime_failed' || issueId === 'manager_pkg_missing') {
      const envFix = enforceCompatibleEnvironment(backendDir);
      const finalCheck = envFix.finalCheck;
      let restart = null as any;
      if (envFix.ok && finalCheck.ok) {
        const backendAlreadyUp = await isBackendUp();
        if (!backendAlreadyUp) {
          restart = await restartBackendAfterFix();
        } else {
          restart = { mode: 'already_running', details: 'Dependency fix applied while backend is live; restart skipped.' };
        }
      }
      return NextResponse.json({
        ok: envFix.ok && finalCheck.ok,
        issueId,
        steps: envFix.steps,
        autoHealed: envFix.steps.length > 0,
        removedConflictingPackages: envFix.removed,
        restartTriggered: Boolean(restart) && restart?.mode !== 'already_running',
        restart,
      });
    }

    if (issueId === 'rembg_onnx_missing') {
      const plan = getRembgInstallPlan();
      const primary = runPython(backendDir, plan.primary);
      let fallbackResult: null | { ok: boolean; output: string; status: number } = null;
      if (!primary.ok && plan.fallback) {
        fallbackResult = runPython(backendDir, plan.fallback);
      }
      const verify = runPython(backendDir, plan.verify);
      let restart = null as any;
      if (verify.ok) {
        restart = await restartBackendAfterFix();
      }
      return NextResponse.json({
        ok: verify.ok,
        issueId,
        hardwareProfile: plan.profile,
        steps: [
          { command: `python ${plan.primary.join(' ')}`, ok: primary.ok, output: primary.output },
          ...(fallbackResult ? [{ command: `python ${plan.fallback?.join(' ')}`, ok: fallbackResult.ok, output: fallbackResult.output }] : []),
          { command: `python ${plan.verify.join(' ')}`, ok: verify.ok, output: verify.output },
        ],
        restartTriggered: Boolean(restart) && restart?.mode !== 'already_running',
        restart,
      });
    }

    if (issueId === 'backend_down') {
      if (await isBackendUp()) {
        return NextResponse.json({ ok: true, issueId, note: 'Backend is already reachable.' });
      }
      const restart = restartBackendDetached();
      return NextResponse.json({ ok: true, issueId, restartTriggered: true, restart, note: 'Backend restart started automatically.' });
    }

    return NextResponse.json({ error: `No automated fix available for ${issueId}` }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to apply fix', details: error?.message || String(error) }, { status: 500 });
  }
}
