import { NextResponse } from 'next/server';

const BACKEND_URL = 'http://localhost:8188';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'cache';
  const skipUpdate = url.searchParams.get('skip_update') || 'true';

  try {
    const res = await fetch(`${BACKEND_URL}/v2/customnode/getlist?mode=${encodeURIComponent(mode)}&skip_update=${encodeURIComponent(skipUpdate)}`, {
      method: 'GET',
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
      return NextResponse.json({
        error: 'Manager catalog unavailable',
        details: parsed,
        hint: 'ComfyUI-Manager legacy API is required for /v2/customnode/getlist. Start backend with --enable-manager --enable-manager-legacy-ui.',
      }, { status: res.status });
    }

    return NextResponse.json(parsed);
  } catch (error: any) {
    return NextResponse.json({
      error: 'Failed to fetch manager catalog',
      details: error?.message || String(error),
    }, { status: 503 });
  }
}
