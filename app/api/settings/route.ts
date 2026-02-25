import { NextResponse } from 'next/server';
import fs from 'node:fs';
import { readModusnapSettings, resolveModelsRootFromSettings, resolveModelsRootsFromSettings, writeModusnapSettings } from '../_lib/modusnapSettings';

function maskSecret(value?: string) {
  if (!value) return '';
  if (value.length < 8) return '****';
  return `${value.slice(0, 4)}...${value.slice(-2)}`;
}

export async function GET() {
  try {
    const settings = readModusnapSettings();
    const modelsRoot = resolveModelsRootFromSettings();
    const modelsRoots = resolveModelsRootsFromSettings();
    const exists = fs.existsSync(modelsRoot);
    return NextResponse.json({
      ok: true,
      settings: {
        modelsRoot,
        modelsRoots,
        modelsRootExists: exists,
        huggingFaceTokenMasked: maskSecret(settings.huggingFaceToken),
        civitaiApiKeyMasked: maskSecret(settings.civitaiApiKey),
        modusnapUsername: settings.modusnapUsername || '',
        modusnapPasswordMasked: maskSecret(settings.modusnapPassword),
        comfyuiUsername: settings.comfyuiUsername || '',
        comfyuiPasswordMasked: maskSecret(settings.comfyuiPassword),
        showTelemetryOverlay: settings.showTelemetryOverlay ?? true,
        telemetryShowCpu: settings.telemetryShowCpu ?? true,
        telemetryShowMemory: settings.telemetryShowMemory ?? true,
        telemetryShowDisk: settings.telemetryShowDisk ?? true,
        telemetryShowGpu: settings.telemetryShowGpu ?? true,
        telemetryShowTemperature: settings.telemetryShowTemperature ?? true,
        allowExplicitContent: settings.allowExplicitContent ?? false,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Failed to read settings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const patch = (body?.settings || {}) as Record<string, unknown>;

    const next: {
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
    } = {};

    if (typeof patch.modelsRoot === 'string') {
      const value = patch.modelsRoot.trim();
      if (!value) {
        next.modelsRoot = '';
      } else {
        next.modelsRoot = value;
      }
    }
    if (typeof patch.huggingFaceToken === 'string') {
      next.huggingFaceToken = patch.huggingFaceToken.trim();
    }
    if (typeof patch.civitaiApiKey === 'string') {
      next.civitaiApiKey = patch.civitaiApiKey.trim();
    }
    if (typeof patch.modusnapUsername === 'string') {
      next.modusnapUsername = patch.modusnapUsername.trim();
    }
    if (typeof patch.modusnapPassword === 'string') {
      next.modusnapPassword = patch.modusnapPassword.trim();
    }
    if (typeof patch.comfyuiUsername === 'string') {
      next.comfyuiUsername = patch.comfyuiUsername.trim();
    }
    if (typeof patch.comfyuiPassword === 'string') {
      next.comfyuiPassword = patch.comfyuiPassword.trim();
    }
    if (typeof patch.showTelemetryOverlay === 'boolean') {
      next.showTelemetryOverlay = patch.showTelemetryOverlay;
    }
    if (typeof patch.telemetryShowCpu === 'boolean') {
      next.telemetryShowCpu = patch.telemetryShowCpu;
    }
    if (typeof patch.telemetryShowMemory === 'boolean') {
      next.telemetryShowMemory = patch.telemetryShowMemory;
    }
    if (typeof patch.telemetryShowDisk === 'boolean') {
      next.telemetryShowDisk = patch.telemetryShowDisk;
    }
    if (typeof patch.telemetryShowGpu === 'boolean') {
      next.telemetryShowGpu = patch.telemetryShowGpu;
    }
    if (typeof patch.telemetryShowTemperature === 'boolean') {
      next.telemetryShowTemperature = patch.telemetryShowTemperature;
    }
    if (typeof patch.allowExplicitContent === 'boolean') {
      next.allowExplicitContent = patch.allowExplicitContent;
    }

    const updated = writeModusnapSettings(next);
    const modelsRoot = resolveModelsRootFromSettings();
    const modelsRoots = resolveModelsRootsFromSettings();
    modelsRoots.forEach((rootPath) => fs.mkdirSync(rootPath, { recursive: true }));

    return NextResponse.json({
      ok: true,
      settings: {
        modelsRoot,
        modelsRoots,
        modelsRootExists: fs.existsSync(modelsRoot),
        huggingFaceTokenMasked: maskSecret(updated.huggingFaceToken),
        civitaiApiKeyMasked: maskSecret(updated.civitaiApiKey),
        modusnapUsername: updated.modusnapUsername || '',
        modusnapPasswordMasked: maskSecret(updated.modusnapPassword),
        comfyuiUsername: updated.comfyuiUsername || '',
        comfyuiPasswordMasked: maskSecret(updated.comfyuiPassword),
        showTelemetryOverlay: updated.showTelemetryOverlay ?? true,
        telemetryShowCpu: updated.telemetryShowCpu ?? true,
        telemetryShowMemory: updated.telemetryShowMemory ?? true,
        telemetryShowDisk: updated.telemetryShowDisk ?? true,
        telemetryShowGpu: updated.telemetryShowGpu ?? true,
        telemetryShowTemperature: updated.telemetryShowTemperature ?? true,
        allowExplicitContent: updated.allowExplicitContent ?? false,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Failed to save settings' }, { status: 500 });
  }
}
