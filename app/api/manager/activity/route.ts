import { NextResponse } from 'next/server';

const BACKEND_URL = 'http://localhost:8188';

async function safeJsonFetch(path: string) {
  const res = await fetch(`${BACKEND_URL}${path}`, { method: 'GET', cache: 'no-store' });
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${path}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
  }

  return parsed;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') || '8');
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 20)) : 8;

  try {
    const [status, historyList] = await Promise.all([
      safeJsonFetch('/v2/manager/queue/status'),
      safeJsonFetch('/v2/manager/queue/history_list'),
    ]);

    const historyIds = Array.isArray(historyList?.ids) ? historyList.ids.slice(0, normalizedLimit) : [];

    const history = await Promise.all(historyIds.map(async (id: string) => {
      try {
        const data = await safeJsonFetch(`/v2/manager/queue/history?id=${encodeURIComponent(id)}`);
        return { id, data };
      } catch (error: any) {
        return { id, error: error?.message || String(error) };
      }
    }));

    return NextResponse.json({
      status,
      historyIds,
      history,
    });
  } catch (error: any) {
    return NextResponse.json({
      error: 'Failed to fetch manager activity',
      details: error?.message || String(error),
    }, { status: 503 });
  }
}
