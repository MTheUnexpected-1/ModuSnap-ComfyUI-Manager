import { NextResponse } from 'next/server';

const BACKEND_URL = 'http://localhost:8188';

type Params = { params: Promise<{ path: string[] }> };

async function forward(request: Request, pathSegments: string[]) {
  const targetPath = pathSegments.join('/');
  const incomingUrl = new URL(request.url);
  const targetUrl = `${BACKEND_URL}/${targetPath}${incomingUrl.search}`;

  const init: RequestInit = {
    method: request.method,
    headers: {
      'Content-Type': request.headers.get('content-type') || 'application/json',
    },
    cache: 'no-store',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const body = await request.text();
    init.body = body;
  }

  const response = await fetch(targetUrl, init);
  const text = await response.text();

  try {
    return NextResponse.json(JSON.parse(text), { status: response.status });
  } catch {
    return NextResponse.json({ raw: text }, { status: response.status });
  }
}

export async function GET(request: Request, { params }: Params) {
  const { path } = await params;
  return forward(request, path);
}

export async function POST(request: Request, { params }: Params) {
  const { path } = await params;
  return forward(request, path);
}

export async function PUT(request: Request, { params }: Params) {
  const { path } = await params;
  return forward(request, path);
}

export async function DELETE(request: Request, { params }: Params) {
  const { path } = await params;
  return forward(request, path);
}
