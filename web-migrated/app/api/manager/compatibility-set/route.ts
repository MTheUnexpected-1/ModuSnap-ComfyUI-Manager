import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveBackendDir } from '../../_lib/backendControl';

type CatalogItem = {
  id?: string;
  title?: string;
  __uiKey?: string;
  [key: string]: any;
};

type DependencyItem = {
  name: string;
  version: string;
};

function getCompatibilitySetPath(backendDir: string) {
  return path.join(backendDir, 'user', 'modusnap_compatible_hardware_set.json');
}

function getCompatibilityHistoryDir(backendDir: string) {
  return path.join(backendDir, 'user', 'compatibility_sets');
}

function readHardwareProfile(backendDir: string) {
  const profilePath = path.join(backendDir, '.torch_profile');
  if (!fs.existsSync(profilePath)) return 'unknown';
  return fs.readFileSync(profilePath, 'utf-8').trim() || 'unknown';
}

function parseHardwareProfile(profile: string) {
  const lower = (profile || '').toLowerCase();
  return {
    profile: profile || 'unknown',
    hasNvidia: lower.includes('nvidia:true'),
    hasRocm: lower.includes('rocm:true'),
    isDarwinArm64: lower.includes('darwin-arm64'),
  };
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

function runCatalogAudit(backendDir: string, items: CatalogItem[]) {
  const profile = readHardwareProfile(backendDir);
  const hw = parseHardwareProfile(profile);
  const rows = items.map((item) => {
    const text = getTextBlob(item);
    const reasons: string[] = [];
    let decision: 'installable' | 'warning' | 'blocked' = 'installable';

    const cudaOnlyMarkers = /(cuda-only|requires cuda|nvidia-only|requires nvidia|tensorrt required|triton required)/i;
    const rocmOnlyMarkers = /(rocm-only|requires rocm|hip required)/i;
    if (!hw.hasNvidia && cudaOnlyMarkers.test(text)) {
      reasons.push('Pack appears NVIDIA/CUDA-only on this hardware.');
      decision = 'blocked';
    } else if (!hw.hasNvidia && /(cuda|nvidia|tensorrt|cu12|cu11)/i.test(text)) {
      reasons.push('Pack metadata suggests NVIDIA/CUDA dependency without NVIDIA hardware.');
      decision = 'warning';
    }
    if (!hw.hasRocm && rocmOnlyMarkers.test(text)) {
      reasons.push('Pack appears ROCm-only on this hardware.');
      decision = 'blocked';
    } else if (!hw.hasRocm && /(rocm|hip)/i.test(text)) {
      reasons.push('Pack metadata suggests ROCm dependency without ROCm hardware.');
      if (decision !== 'blocked') decision = 'warning';
    }
    if (hw.isDarwinArm64 && /(xformers|triton|flash-attn|bitsandbytes)/i.test(text)) {
      reasons.push('Likely requires binaries often unavailable on macOS ARM64.');
      if (decision !== 'blocked') decision = 'warning';
    }

    return {
      key: String(item.__uiKey || item.id || item.title || item.repository || item.reference || ''),
      id: String(item.id || ''),
      title: String(item.title || item.id || 'Unknown pack'),
      decision,
      reasons,
    };
  }).filter((row) => row.key);

  const installable = rows.filter((row) => row.decision === 'installable');
  const incompatible = rows.filter((row) => row.decision !== 'installable');
  const userDir = path.join(backendDir, 'user');
  fs.mkdirSync(userDir, { recursive: true });
  const installablePath = path.join(userDir, 'modusnap_catalog_installable_packs.json');
  const incompatiblePath = path.join(userDir, 'modusnap_catalog_incompatible_packs.json');

  fs.writeFileSync(installablePath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    hardwareProfile: profile,
    total: rows.length,
    installable: installable.length,
    packs: installable,
  }, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(incompatiblePath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    hardwareProfile: profile,
    total: rows.length,
    incompatible: incompatible.length,
    packs: incompatible,
  }, null, 2)}\n`, 'utf-8');

  return {
    generatedAt: new Date().toISOString(),
    hardwareProfile: profile,
    totalCatalogItems: rows.length,
    installableCount: installable.length,
    incompatibleCount: incompatible.length,
    installablePath,
    incompatiblePath,
  };
}

function runPython(backendDir: string, args: string[]) {
  const pythonBin = path.join(backendDir, 'venv', 'bin', 'python');
  if (!fs.existsSync(pythonBin)) {
    return { ok: false, output: 'ModuSnap-ComfyUI-Backend/venv missing', status: 1 };
  }
  const proc = spawnSync(pythonBin, args, {
    cwd: backendDir,
    encoding: 'utf-8',
    timeout: 180000,
    env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1' },
  });
  const output = `${proc.stdout || ''}${proc.stderr || ''}`.trim();
  return { ok: proc.status === 0, output: output || '(no output)', status: proc.status ?? 1 };
}

function runDependencyAudit(backendDir: string) {
  const script = `
import json
from pathlib import Path

try:
    from packaging.requirements import Requirement
    from packaging.specifiers import SpecifierSet
    from packaging.version import Version, InvalidVersion
except Exception as e:
    print(json.dumps({"ok": False, "error": f"packaging import failed: {e}"}))
    raise SystemExit(0)

root = Path("custom_nodes")
user_dir = Path("user")
user_dir.mkdir(parents=True, exist_ok=True)

report_path = user_dir / "modusnap_dependency_compatibility_report.json"
compatible_path = user_dir / "modusnap_compatible_requirements.txt"
incompatible_path = user_dir / "modusnap_incompatible_requirements.txt"

def parse_requirements_file(path: Path):
    rows = []
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("-r") or line.startswith("--"):
            continue
        line = line.split(" #")[0].strip()
        try:
            req = Requirement(line)
            rows.append((req.name.lower(), str(req.specifier or ""), str(req.marker or ""), line))
        except Exception:
            # keep unparsed references as-is for visibility
            rows.append((f"__unparsed__:{line}", "", "", line))
    return rows

files = []
if root.exists():
    for p in root.rglob("requirements*.txt"):
        if ".disabled" in str(p):
            continue
        files.append(p)
    for p in root.rglob("*requirements*.txt"):
        if ".disabled" in str(p):
            continue
        if p not in files:
            files.append(p)

files = sorted(files)
pkg_map = {}
file_rows = []

for f in files:
    rel = str(f)
    rows = parse_requirements_file(f)
    file_rows.append({"file": rel, "count": len(rows)})
    node_name = f.parent.name
    for pkg, spec, marker, raw in rows:
        if pkg.startswith("__unparsed__:"):
            continue
        pkg_map.setdefault(pkg, []).append({"node": node_name, "file": rel, "spec": spec, "marker": marker, "raw": raw})

def exact_versions(spec: str):
    out = []
    for part in [x.strip() for x in spec.split(",") if x.strip()]:
        if part.startswith("=="):
            out.append(part[2:].strip())
    return out

def _compatible_upper_for(version_text: str):
    try:
        version = Version(version_text)
        release = list(version.release)
        if len(release) <= 1:
            major = release[0] if len(release) == 1 else 0
            return Version(f"{major + 1}")
        prefix = release[:-1]
        prefix[-1] = prefix[-1] + 1
        return Version(".".join(str(x) for x in prefix))
    except Exception:
        return None

def satisfies(version: str, spec: str):
    if not spec:
        return True
    try:
        return Version(version) in SpecifierSet(spec)
    except InvalidVersion:
        return False
    except Exception:
        return True

def specifiers_intersection(specs):
    lower = None
    lower_inclusive = True
    upper = None
    upper_inclusive = True
    exact = None
    not_equals = set()
    unsupported = []

    for spec_text in specs:
        if not spec_text:
            continue
        try:
            spec_set = SpecifierSet(spec_text)
        except Exception:
            unsupported.append(f"unable to parse specifier '{spec_text}'")
            continue

        for sp in spec_set:
            op = sp.operator
            version_text = sp.version

            if op == "==":
                try:
                    v = Version(version_text)
                except Exception:
                    unsupported.append(f"unable to parse exact version '{version_text}'")
                    continue
                if exact is None:
                    exact = v
                elif exact != v:
                    return {"ok": False, "reason": f"multiple exact pins: {exact}, {v}", "normalized": ""}
            elif op == "!=":
                try:
                    not_equals.add(Version(version_text))
                except Exception:
                    unsupported.append(f"unable to parse exclusion '{version_text}'")
            elif op in (">", ">="):
                try:
                    v = Version(version_text)
                except Exception:
                    unsupported.append(f"unable to parse lower bound '{version_text}'")
                    continue
                if lower is None or v > lower or (v == lower and op == ">"):
                    lower = v
                    lower_inclusive = (op == ">=")
                elif v == lower and op == ">":
                    lower_inclusive = False
            elif op in ("<", "<="):
                try:
                    v = Version(version_text)
                except Exception:
                    unsupported.append(f"unable to parse upper bound '{version_text}'")
                    continue
                if upper is None or v < upper or (v == upper and op == "<"):
                    upper = v
                    upper_inclusive = (op == "<=")
                elif v == upper and op == "<":
                    upper_inclusive = False
            elif op == "~=":
                try:
                    low = Version(version_text)
                except Exception:
                    unsupported.append(f"unable to parse compatible lower bound '{version_text}'")
                    continue
                up = _compatible_upper_for(version_text)
                if lower is None or low > lower:
                    lower = low
                    lower_inclusive = True
                if up is not None:
                    if upper is None or up < upper or (up == upper and not upper_inclusive):
                        upper = up
                        upper_inclusive = False
            elif op == "===":
                unsupported.append(f"arbitrary equality '{spec_text}' is not fully analyzable")
            else:
                unsupported.append(f"unsupported operator '{op}'")

    if exact is not None:
        if exact in not_equals:
            return {"ok": False, "reason": f"exact pin {exact} is explicitly excluded", "normalized": ""}
        if lower is not None and (exact < lower or (exact == lower and not lower_inclusive)):
            return {"ok": False, "reason": f"exact pin {exact} is below lower bound", "normalized": ""}
        if upper is not None and (exact > upper or (exact == upper and not upper_inclusive)):
            return {"ok": False, "reason": f"exact pin {exact} is above upper bound", "normalized": ""}
        return {"ok": True, "reason": "", "normalized": f"=={exact}", "unsupported": unsupported}

    if lower is not None and upper is not None:
        if lower > upper:
            return {"ok": False, "reason": f"lower bound {lower} is greater than upper bound {upper}", "normalized": ""}
        if lower == upper and (not lower_inclusive or not upper_inclusive):
            return {"ok": False, "reason": f"bounds collapse to excluded single version {lower}", "normalized": ""}
        if lower == upper and lower in not_equals:
            return {"ok": False, "reason": f"only allowed version {lower} is excluded", "normalized": ""}

    parts = []
    if lower is not None:
        parts.append(f"{'>=' if lower_inclusive else '>'}{lower}")
    if upper is not None:
        parts.append(f"{'<=' if upper_inclusive else '<'}{upper}")
    for v in sorted(not_equals):
        parts.append(f"!={v}")
    normalized = ",".join(parts)
    return {"ok": True, "reason": "", "normalized": normalized, "unsupported": unsupported}

conflicts = []
compatible_requirements = []
incompatible_lines = []

for pkg, entries in sorted(pkg_map.items()):
    specs = sorted(set((e.get("spec") or "").strip() for e in entries if (e.get("spec") or "").strip()))
    markers = sorted(set((e.get("marker") or "").strip() for e in entries if (e.get("marker") or "").strip()))

    if not specs:
        compatible_requirements.append(pkg)
        continue

    intersect = specifiers_intersection(specs)
    if not intersect.get("ok"):
        exacts = []
        for s in specs:
            exacts.extend(exact_versions(s))
        exacts = sorted(set(exacts))
        pin_conflicts = []
        for ev in exacts:
            for s in specs:
                if not satisfies(ev, s):
                    pin_conflicts.append(f"exact pin {ev} not compatible with spec '{s}'")
        reasons = sorted(set([intersect.get("reason", "incompatible specifiers")] + pin_conflicts))
        conflicts.append({
            "package": pkg,
            "specs": specs,
            "markers": markers,
            "reasons": reasons,
            "entries": entries,
        })
        incompatible_lines.append(f"{pkg} :: {' | '.join(specs)} :: {' | '.join(reasons)}")
        continue

    normalized = (intersect.get("normalized") or "").strip()
    unsupported = [x for x in (intersect.get("unsupported") or []) if x]
    if unsupported:
        conflicts.append({
            "package": pkg,
            "specs": specs,
            "markers": markers,
            "reasons": unsupported,
            "entries": entries,
        })
        incompatible_lines.append(f"{pkg} :: {' | '.join(specs)} :: {' | '.join(unsupported)}")
        continue

    compatible_requirements.append(f"{pkg}{normalized}")

compatible_path.write_text("\\n".join(sorted(set(compatible_requirements))) + "\\n", encoding="utf-8")
incompatible_path.write_text("\\n".join(incompatible_lines) + ("\\n" if incompatible_lines else ""), encoding="utf-8")

report = {
    "ok": True,
    "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    "filesScanned": len(files),
    "fileSummary": file_rows,
    "packagesScanned": len(pkg_map),
    "compatibleRequirementCount": len(compatible_requirements),
    "conflictCount": len(conflicts),
    "conflicts": conflicts[:200],
    "compatibleRequirementsPath": str(compatible_path),
    "incompatibleRequirementsPath": str(incompatible_path),
    "reportPath": str(report_path),
}
report_path.write_text(json.dumps(report, indent=2) + "\\n", encoding="utf-8")
print(json.dumps(report))
`.trim();

  const audit = runPython(backendDir, ['-c', script]);
  if (!audit.ok) {
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      filesScanned: 0,
      packagesScanned: 0,
      conflictCount: 0,
      compatibleRequirementCount: 0,
      compatibleRequirementsPath: '',
      incompatibleRequirementsPath: '',
      reportPath: '',
      error: audit.output,
    };
  }

  try {
    const parsed = JSON.parse(audit.output);
    return parsed;
  } catch {
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      filesScanned: 0,
      packagesScanned: 0,
      conflictCount: 0,
      compatibleRequirementCount: 0,
      compatibleRequirementsPath: '',
      incompatibleRequirementsPath: '',
      reportPath: '',
      error: `Invalid audit payload: ${audit.output.slice(0, 500)}`,
    };
  }
}

function runCmd(cwd: string, command: string) {
  const proc = spawnSync('bash', ['-lc', command], {
    cwd,
    encoding: 'utf-8',
    timeout: 15000,
  });
  const output = `${proc.stdout || ''}${proc.stderr || ''}`.trim();
  return { ok: proc.status === 0, output: output || '(no output)', status: proc.status ?? 1 };
}

function extractPipRequiredSpecs(output: string) {
  const specs = new Set<string>();
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const reqMatch = line.match(/has requirement (.+), but you have /i);
    if (reqMatch?.[1]) {
      specs.add(reqMatch[1].trim());
      continue;
    }
    const missingMatch = line.match(/requires (.+), which is not installed\./i);
    if (missingMatch?.[1]) {
      specs.add(missingMatch[1].trim());
    }
  }
  return Array.from(specs);
}

function autoHealPip(backendDir: string, initialOutput: string) {
  const steps: Array<{ command: string; ok: boolean; output: string }> = [];
  let current = initialOutput;
  const seen = new Set<string>();

  for (let round = 1; round <= 6; round++) {
    if (
      current.includes('fastapi') &&
      current.includes('has requirement starlette<0.47.0,>=0.40.0') &&
      current.includes('sse-starlette') &&
      current.includes('has requirement starlette>=0.49.1')
    ) {
      const fix = runPython(backendDir, ['-m', 'pip', 'install', 'sse-starlette<3.0', 'starlette>=0.40.0,<0.47.0']);
      steps.push({
        command: 'python -m pip install sse-starlette<3.0 starlette>=0.40.0,<0.47.0',
        ok: fix.ok,
        output: fix.output,
      });
    } else if (
      current.includes('shaderflow') ||
      current.includes('gradio') ||
      current.includes('depthflow') ||
      current.includes('rembg')
    ) {
      const compat = runPython(backendDir, [
        '-m',
        'pip',
        'install',
        'scipy~=1.15.3',
        'pillow<12',
        'rembg==2.0.69',
        'onnxruntime',
      ]);
      steps.push({
        command: 'python -m pip install scipy~=1.15.3 pillow<12 rembg==2.0.69 onnxruntime',
        ok: compat.ok,
        output: compat.output,
      });
      const depthflowPins = runPython(backendDir, [
        '-m',
        'pip',
        'install',
        '--no-deps',
        'gradio==5.35.0',
        'shaderflow==0.9.1',
      ]);
      steps.push({
        command: 'python -m pip install --no-deps gradio==5.35.0 shaderflow==0.9.1',
        ok: depthflowPins.ok,
        output: depthflowPins.output,
      });
    } else {
      const specs = extractPipRequiredSpecs(current);
      if (specs.length === 0) break;
      const key = specs.slice().sort().join('|');
      if (seen.has(key)) break;
      seen.add(key);
      for (const spec of specs) {
        const installSpec = runPython(backendDir, ['-m', 'pip', 'install', spec]);
        steps.push({ command: `python -m pip install ${spec}`, ok: installSpec.ok, output: installSpec.output });
      }
    }

    const check = runPython(backendDir, ['-m', 'pip', 'check']);
    steps.push({ command: `python -m pip check (round ${round})`, ok: check.ok, output: check.output });
    if (check.ok) {
      return { finalCheck: check, steps };
    }
    current = check.output;
  }

  const finalCheck = runPython(backendDir, ['-m', 'pip', 'check']);
  return { finalCheck, steps };
}

function sanitizeFileSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function collectDependencyLock(backendDir: string) {
  const pipList = runPython(backendDir, ['-m', 'pip', 'list', '--format=json']);
  const pipFreeze = runPython(backendDir, ['-m', 'pip', 'freeze']);
  const pythonVersion = runPython(backendDir, ['-c', 'import platform; print(platform.python_version())']);
  const managerVersion = runPython(backendDir, ['-c', 'import comfyui_manager as m; print(getattr(m, "__version__", "unknown"))']);

  let packages: DependencyItem[] = [];
  if (pipList.ok) {
    try {
      const parsed = JSON.parse(pipList.output);
      if (Array.isArray(parsed)) {
        packages = parsed
          .filter((entry) => typeof entry?.name === 'string' && typeof entry?.version === 'string')
          .map((entry) => ({ name: entry.name, version: entry.version }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    } catch {
      packages = [];
    }
  }

  const comfyUiGit = runCmd(backendDir, 'git rev-parse HEAD');
  const comfyUiDescribe = runCmd(backendDir, 'git describe --always --tags --dirty');

  return {
    pythonVersion: pythonVersion.ok ? pythonVersion.output : 'unknown',
    managerVersion: managerVersion.ok ? managerVersion.output : 'unknown',
    comfyUiGitCommit: comfyUiGit.ok ? comfyUiGit.output : 'unknown',
    comfyUiGitDescribe: comfyUiDescribe.ok ? comfyUiDescribe.output : 'unknown',
    packageCount: packages.length,
    packages,
    pipFreeze: pipFreeze.ok ? pipFreeze.output.split('\n').map((line) => line.trim()).filter(Boolean) : [],
  };
}

function saveCompatibilitySet(backendDir: string, setPayload: any) {
  const filePath = getCompatibilitySetPath(backendDir);
  const historyDir = getCompatibilityHistoryDir(backendDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.mkdirSync(historyDir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(setPayload, null, 2)}\n`, 'utf-8');

  const stamp = setPayload?.createdAt
    ? String(setPayload.createdAt).replace(/[:.]/g, '-')
    : new Date().toISOString().replace(/[:.]/g, '-');
  const profile = sanitizeFileSegment(setPayload?.hardwareProfile || 'unknown');
  const lockId = sanitizeFileSegment(setPayload?.lockId || `${stamp}_${profile}`);
  const historyFileName = `compat_set_${lockId}.json`;
  const historyPath = path.join(historyDir, historyFileName);
  fs.writeFileSync(historyPath, `${JSON.stringify(setPayload, null, 2)}\n`, 'utf-8');

  return { latestPath: filePath, historyPath, historyFileName };
}

function listCompatibilityHistory(backendDir: string) {
  const dir = getCompatibilityHistoryDir(backendDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 50);
}

export async function GET() {
  const backendDir = resolveBackendDir();
  const setPath = getCompatibilitySetPath(backendDir);
  if (!fs.existsSync(setPath)) {
    return NextResponse.json({
      ok: false,
      error: 'Compatible hardware set not found.',
      history: listCompatibilityHistory(backendDir),
    }, { status: 404 });
  }
  const current = JSON.parse(fs.readFileSync(setPath, 'utf-8'));
  return NextResponse.json({ ok: true, compatibilitySet: current, history: listCompatibilityHistory(backendDir) });
}

export async function POST(request: Request) {
  try {
    const backendDir = resolveBackendDir();
    const body = await request.json().catch(() => ({}));
    const items = (Array.isArray(body?.items) ? body.items : []) as CatalogItem[];
    const selectedPackKeys = items.map((item) => (item.__uiKey || item.id || item.title || '').toString()).filter(Boolean);
    const selectedPackIds = items.map((item) => (item.id || item.title || '').toString()).filter(Boolean);

    const steps: Array<{ command: string; ok: boolean; output: string }> = [];
    const coreReq = runPython(backendDir, ['-m', 'pip', 'install', '-r', 'requirements.txt']);
    steps.push({ command: 'python -m pip install -r requirements.txt', ok: coreReq.ok, output: coreReq.output });
    const managerReq = runPython(backendDir, ['-m', 'pip', 'install', '-r', 'manager_requirements.txt']);
    steps.push({ command: 'python -m pip install -r manager_requirements.txt', ok: managerReq.ok, output: managerReq.output });

    const dependencyAudit = runDependencyAudit(backendDir);
    if (dependencyAudit?.ok && dependencyAudit?.compatibleRequirementsPath) {
      const compatInstall = runPython(backendDir, ['-m', 'pip', 'install', '-r', dependencyAudit.compatibleRequirementsPath]);
      steps.push({
        command: `python -m pip install -r ${dependencyAudit.compatibleRequirementsPath}`,
        ok: compatInstall.ok,
        output: compatInstall.output,
      });
    }

    const firstCheck = runPython(backendDir, ['-m', 'pip', 'check']);
    steps.push({ command: 'python -m pip check', ok: firstCheck.ok, output: firstCheck.output });
    const healed = firstCheck.ok ? { finalCheck: firstCheck, steps: [] } : autoHealPip(backendDir, firstCheck.output);
    steps.push(...healed.steps);
    const dependencyLock = collectDependencyLock(backendDir);
    const catalogAudit = runCatalogAudit(backendDir, items);
    const createdAt = new Date().toISOString();
    const lockId = `${createdAt.replace(/[:.]/g, '-')}_${readHardwareProfile(backendDir)}`;

    const payload = {
      lockId,
      createdAt,
      hardwareProfile: readHardwareProfile(backendDir),
      pipHealthy: healed.finalCheck.ok,
      pipCheckOutput: healed.finalCheck.output,
      selectedPackKeys,
      selectedPackIds,
      totalSelected: selectedPackKeys.length,
      dependencyLock,
      dependencyAudit,
      catalogAudit,
    };
    const saved = saveCompatibilitySet(backendDir, payload);
    return NextResponse.json({
      ok: true,
      compatibilitySet: payload,
      savedPath: saved.latestPath,
      historyPath: saved.historyPath,
      historyFileName: saved.historyFileName,
      history: listCompatibilityHistory(backendDir),
      steps,
      autoHealed: healed.steps.length > 0,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to create compatible hardware set', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
