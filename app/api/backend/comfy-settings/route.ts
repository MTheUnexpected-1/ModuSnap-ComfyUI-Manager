import { NextResponse } from 'next/server';
import { COMFY_DEFAULT_CATALOG } from '../../../../lib/settings/comfyDefaultCatalog';

const BACKEND_URL = 'http://localhost:8188';
const SETTINGS_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

type SettingCatalogEntry = {
  id?: string;
  name?: string;
  type?: string;
  category?: string[];
  defaultValue?: unknown;
  tooltip?: string;
  options?: unknown[];
  experimental?: boolean;
  [key: string]: unknown;
};

let settingsCatalogCache: { at: number; catalog: Record<string, SettingCatalogEntry> } | null = null;

async function fetchJson(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadSettingsCatalogFromFrontend(): Promise<Record<string, SettingCatalogEntry>> {
  const now = Date.now();
  if (settingsCatalogCache && now - settingsCatalogCache.at < SETTINGS_CATALOG_CACHE_TTL_MS) {
    return settingsCatalogCache.catalog;
  }

  // Optional runtime dependency: avoid hard type/module resolution failure when playwright is not installed.
  const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
  const playwrightModule = await dynamicImport('playwright').catch(() => null);
  if (!playwrightModule?.chromium) {
    return {};
  }
  const { chromium } = playwrightModule as { chromium: { launch: (opts: { headless: boolean }) => Promise<any> } };
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(BACKEND_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(
      () => Boolean((window as any)?.app?.extensionManager?.setting?.settings),
      { timeout: 15000 }
    );
    const catalog = await page.evaluate(() => {
      const map = (window as any)?.app?.extensionManager?.setting?.settings || {};
      const out: Record<string, any> = {};
      for (const [key, value] of Object.entries(map)) {
        if (value && typeof value === 'object') {
          out[key] = value;
        }
      }
      return out;
    });
    settingsCatalogCache = { at: now, catalog };
    return catalog;
  } finally {
    await browser.close();
  }
}

export async function GET() {
  try {
    const primary = await fetchJson(`${BACKEND_URL}/settings`);
    const fallback = primary.ok ? null : await fetchJson(`${BACKEND_URL}/api/settings`);
    const currentSettings = (primary.ok ? primary.data : fallback?.ok ? fallback.data : {}) as Record<string, unknown>;

    if (!primary.ok && !fallback?.ok) {
      return NextResponse.json(
        { ok: false, error: `Comfy settings fetch failed (${primary.status})`, settings: {} },
        { status: 502 }
      );
    }

    let catalog: Record<string, SettingCatalogEntry> = {};
    try {
      catalog = await loadSettingsCatalogFromFrontend();
    } catch {
      catalog = {};
    }

    // Fallback: if Playwright scraping returned nothing, use the static catalog
    if (Object.keys(catalog).length === 0) {
      for (const [key, entry] of Object.entries(COMFY_DEFAULT_CATALOG)) {
        catalog[key] = entry as SettingCatalogEntry;
      }
    }

    const merged: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(catalog)) {
      if (def?.type === 'hidden') continue;
      if (Object.prototype.hasOwnProperty.call(currentSettings, key)) {
        merged[key] = currentSettings[key];
      } else if (Object.prototype.hasOwnProperty.call(def, 'defaultValue')) {
        merged[key] = def.defaultValue;
      } else {
        merged[key] = null;
      }
    }

    for (const [key, value] of Object.entries(currentSettings)) {
      if (!Object.prototype.hasOwnProperty.call(merged, key)) {
        merged[key] = value;
      }
    }

    return NextResponse.json({
      ok: true,
      settings: merged,
      catalog,
      totals: {
        current: Object.keys(currentSettings).length,
        catalog: Object.keys(catalog).length,
        merged: Object.keys(merged).length,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Failed to fetch Comfy settings', settings: {} }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const saveTo = async (path: string) => {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, payload };
    };

    const primary = await saveTo('/settings');
    if (primary.ok) return NextResponse.json({ ok: true, result: primary.payload });

    const fallback = await saveTo('/api/settings');
    if (fallback.ok) return NextResponse.json({ ok: true, result: fallback.payload });

    return NextResponse.json({ ok: false, error: `Comfy settings save failed (${primary.status})` }, { status: 502 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Failed to save Comfy settings' }, { status: 500 });
  }
}
