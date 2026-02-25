import fs from 'node:fs';
import path from 'node:path';
import { resolveBackendDir } from './backendControl';

export type ModusnapSettings = {
  modelsRoot?: string;
  huggingFaceToken?: string;
  civitaiApiKey?: string;
  modusnapUsername?: string;
  modusnapPassword?: string;
  comfyuiUsername?: string;
  comfyuiPassword?: string;
  showTelemetryOverlay?: boolean;
  telemetryShowCpu?: boolean;
  telemetryShowMemory?: boolean;
  telemetryShowDisk?: boolean;
  telemetryShowGpu?: boolean;
  telemetryShowTemperature?: boolean;
  allowExplicitContent?: boolean;
};

const DEFAULT_MODELS_ROOT = path.join(resolveBackendDir(), 'models');

function getSettingsPath() {
  return path.join(resolveBackendDir(), 'user', 'modusnap_settings.json');
}

export function readModusnapSettings(): ModusnapSettings {
  const settingsPath = getSettingsPath();
  if (!fs.existsSync(settingsPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return {};
    return {
      modelsRoot: typeof parsed.modelsRoot === 'string' ? parsed.modelsRoot : undefined,
      huggingFaceToken: typeof parsed.huggingFaceToken === 'string' ? parsed.huggingFaceToken : undefined,
      civitaiApiKey: typeof parsed.civitaiApiKey === 'string' ? parsed.civitaiApiKey : undefined,
      modusnapUsername: typeof parsed.modusnapUsername === 'string' ? parsed.modusnapUsername : undefined,
      modusnapPassword: typeof parsed.modusnapPassword === 'string' ? parsed.modusnapPassword : undefined,
      comfyuiUsername: typeof parsed.comfyuiUsername === 'string' ? parsed.comfyuiUsername : undefined,
      comfyuiPassword: typeof parsed.comfyuiPassword === 'string' ? parsed.comfyuiPassword : undefined,
      showTelemetryOverlay: typeof parsed.showTelemetryOverlay === 'boolean' ? parsed.showTelemetryOverlay : undefined,
      telemetryShowCpu: typeof parsed.telemetryShowCpu === 'boolean' ? parsed.telemetryShowCpu : undefined,
      telemetryShowMemory: typeof parsed.telemetryShowMemory === 'boolean' ? parsed.telemetryShowMemory : undefined,
      telemetryShowDisk: typeof parsed.telemetryShowDisk === 'boolean' ? parsed.telemetryShowDisk : undefined,
      telemetryShowGpu: typeof parsed.telemetryShowGpu === 'boolean' ? parsed.telemetryShowGpu : undefined,
      telemetryShowTemperature: typeof parsed.telemetryShowTemperature === 'boolean' ? parsed.telemetryShowTemperature : undefined,
      allowExplicitContent: typeof parsed.allowExplicitContent === 'boolean' ? parsed.allowExplicitContent : undefined,
    };
  } catch {
    return {};
  }
}

export function writeModusnapSettings(next: ModusnapSettings) {
  const current = readModusnapSettings();
  const merged: ModusnapSettings = {
    ...current,
    ...next,
  };
  const settingsPath = getSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  return merged;
}

export function resolveModelsRootFromSettings() {
  const roots = resolveModelsRootsFromSettings();
  return roots[0] || DEFAULT_MODELS_ROOT;
}

export function resolveModelsRootsFromSettings() {
  const configured = readModusnapSettings().modelsRoot?.trim();
  if (!configured) return [DEFAULT_MODELS_ROOT];

  const parsePath = (value: string) => {
    if (path.isAbsolute(value)) return value;
    return path.resolve(resolveBackendDir(), value);
  };

  if (configured.startsWith('[') && configured.endsWith(']')) {
    try {
      const parsed = JSON.parse(configured);
      if (Array.isArray(parsed)) {
        const roots = parsed
          .map((entry) => String(entry || '').trim())
          .filter(Boolean)
          .map(parsePath);
        if (roots.length > 0) return Array.from(new Set(roots));
      }
    } catch {
      // fallback below
    }
  }

  const roots = configured
    .split(/\r?\n|;|,/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parsePath);

  if (roots.length > 0) return Array.from(new Set(roots));
  return [DEFAULT_MODELS_ROOT];
}
