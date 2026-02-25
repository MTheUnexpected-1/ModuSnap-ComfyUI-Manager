import { NextResponse } from 'next/server';

const BACKEND_URL = 'http://localhost:8188';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'local';

  try {
    const res = await fetch(`${BACKEND_URL}/v2/customnode/getmappings?mode=${encodeURIComponent(mode)}`, {
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
        error: 'Manager mappings unavailable',
        details: parsed,
      }, { status: res.status });
    }

    return NextResponse.json(parsed);
  } catch (error: any) {
    return NextResponse.json({
      error: 'Failed to fetch manager mappings',
      details: error?.message || String(error),
    }, { status: 503 });
  }
}
