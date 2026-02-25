import { NextResponse } from 'next/server';

const BACKEND_URL = 'http://localhost:8188';

async function fetchJsonLike(url: string) {
  const res = await fetch(url, { method: 'GET', cache: 'no-store' });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { res, parsed };
}

export async function GET() {
  try {
    const [listResp, currentResp] = await Promise.all([
      fetchJsonLike(`${BACKEND_URL}/v2/snapshot/getlist`),
      fetchJsonLike(`${BACKEND_URL}/v2/snapshot/get_current`),
    ]);

    if (!listResp.res.ok) {
      return NextResponse.json({ error: 'Failed to fetch snapshot list', details: listResp.parsed }, { status: listResp.res.status });
    }

    return NextResponse.json({
      items: listResp.parsed?.items || [],
      current: currentResp.res.ok ? currentResp.parsed : null,
      currentStatus: currentResp.res.status,
    });
  } catch (error: any) {
    return NextResponse.json({ error: 'Snapshot request failed', details: error?.message || String(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body?.action as string | undefined;
    const target = body?.target as string | undefined;

    if (!action) {
      return NextResponse.json({ error: 'Missing snapshot action' }, { status: 400 });
    }

    let endpoint = '';
    if (action === 'save') {
      endpoint = '/v2/snapshot/save';
    } else if (action === 'restore') {
      if (!target) return NextResponse.json({ error: 'Missing snapshot target for restore' }, { status: 400 });
      endpoint = `/v2/snapshot/restore?target=${encodeURIComponent(target)}`;
    } else if (action === 'remove') {
      if (!target) return NextResponse.json({ error: 'Missing snapshot target for remove' }, { status: 400 });
      endpoint = `/v2/snapshot/remove?target=${encodeURIComponent(target)}`;
    } else {
      return NextResponse.json({ error: `Unsupported snapshot action: ${action}` }, { status: 400 });
    }

    const { res, parsed } = await fetchJsonLike(`${BACKEND_URL}${endpoint}`);
    if (!res.ok) {
      return NextResponse.json({ error: `Snapshot action '${action}' failed`, details: parsed }, { status: res.status });
    }

    return NextResponse.json({ ok: true, action, target: target || null, details: parsed });
  } catch (error: any) {
    return NextResponse.json({ error: 'Snapshot action failed', details: error?.message || String(error) }, { status: 500 });
  }
}
