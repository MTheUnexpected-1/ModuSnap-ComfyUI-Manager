import { NextResponse } from 'next/server';

const BACKEND_URL = 'http://localhost:8188';

function normalizeRepoUrl(raw: unknown) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  return value;
}

function parseCnrIdFromReference(reference: unknown) {
  if (typeof reference !== 'string' || !reference.trim()) return null;
  const value = reference.trim();
  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/nodes\/([^/?#]+)/i);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  } catch {
    const match = value.match(/\/nodes\/([^/?#]+)/i);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { mode, item, items, channel = 'default', sourceMode = 'cache' } = body || {};

    if (!mode || (!item && !Array.isArray(items))) {
      return NextResponse.json({ error: 'Missing mode and item(s)' }, { status: 400 });
    }

    const sourceItems = Array.isArray(items) && items.length > 0 ? items : [item];
    const invalidItems: Array<{ index: number; reason: string; title?: string; id?: string; reference?: string; repository?: string }> = [];
    const payloadItems = sourceItems.flatMap((entry: any, index: number) => {
      const installType = String(entry?.install_type || '').toLowerCase();
      const uiId = entry?.id || entry?.key || entry?.title || `node_${Date.now()}_${index}`;
      const normalized = {
        ...entry,
        channel,
        mode: sourceMode,
        selected_version: entry?.selected_version || 'latest',
        skip_post_install: mode === 'enable',
        ui_id: uiId,
      };

      if (installType === 'cnr') {
        const resolvedId =
          (typeof normalized.id === 'string' && normalized.id.trim()) ||
          parseCnrIdFromReference(normalized.reference) ||
          null;
        if (!resolvedId) {
          const fallbackRepository =
            normalizeRepoUrl(normalized.repository) ||
            (Array.isArray(normalized.files)
              ? normalizeRepoUrl(normalized.files.find((value: unknown) => typeof value === 'string'))
              : null);
          if (fallbackRepository) {
            normalized.install_type = 'git-clone';
            normalized.repository = fallbackRepository;
            delete normalized.id;
            return [normalized];
          }
          invalidItems.push({
            index,
            reason: 'Missing CNR package id and no git fallback repository is available',
            title: normalized.title,
            id: normalized.id,
            reference: normalized.reference,
          });
          return [];
        }
        normalized.id = resolvedId;
      }

      if (String(normalized.install_type || '').toLowerCase() === 'git-clone') {
        const repository =
          normalizeRepoUrl(normalized.repository) ||
          normalizeRepoUrl(normalized.reference) ||
          (Array.isArray(normalized.files) ? normalizeRepoUrl(normalized.files.find((value: unknown) => typeof value === 'string')) : null);
        if (!repository) {
          invalidItems.push({
            index,
            reason: 'Missing git repository url',
            title: normalized.title,
            id: normalized.id,
            repository: normalized.repository,
            reference: normalized.reference,
          });
          return [];
        }
        normalized.repository = repository;
      }

      return [normalized];
    });

    if (payloadItems.length === 0) {
      return NextResponse.json(
        {
          error: 'No valid manager items found for requested action.',
          invalidItems,
        },
        { status: 400 }
      );
    }

    let apiMode = mode;
    if (mode === 'enable') apiMode = 'install';
    if (mode === 'switch') apiMode = 'install';
    if (mode === 'try-update') apiMode = 'update';
    if (mode === 'try-install') apiMode = 'install';

    const batchPayload: Record<string, any> = {
      batch_id: `batch_${Date.now()}`,
      [apiMode]: payloadItems,
    };

    const res = await fetch(`${BACKEND_URL}/v2/manager/queue/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batchPayload),
      cache: 'no-store',
    });

    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    if (!res.ok) {
      return NextResponse.json({ error: 'Manager batch call failed', details: parsed }, { status: res.status });
    }

    // Ensure queued tasks begin processing immediately.
    let queueStartStatus: number | null = null;
    try {
      const startRes = await fetch(`${BACKEND_URL}/v2/manager/queue/start`, {
        method: 'GET',
        cache: 'no-store',
      });
      queueStartStatus = startRes.status;
    } catch {
      // Queue may already be active; keep batch success response.
    }

    return NextResponse.json({ ok: true, result: parsed, queueStartStatus, skipped: invalidItems });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
