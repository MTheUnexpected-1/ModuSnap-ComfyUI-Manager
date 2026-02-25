import { NextResponse } from 'next/server';

type CatalogItem = {
  id?: string;
  title?: string;
  repository?: string;
  reference?: string;
  files?: string[];
  __uiKey?: string;
};

function toRepoSlug(value: string) {
  const trimmed = value.trim();
  const ghUrl = trimmed.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (ghUrl?.[1] && ghUrl?.[2]) {
    return `${ghUrl[1]}/${ghUrl[2].replace(/\.git$/i, '')}`;
  }
  const slug = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (slug?.[1] && slug?.[2]) {
    return `${slug[1]}/${slug[2].replace(/\.git$/i, '')}`;
  }
  return null;
}

function findRepoSlug(item: CatalogItem) {
  const candidates = [
    item.repository,
    item.reference,
    ...(Array.isArray(item.files) ? item.files : []),
  ].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);

  for (const candidate of candidates) {
    const slug = toRepoSlug(candidate);
    if (slug) return slug;
  }
  return null;
}

async function estimateOne(item: CatalogItem) {
  const key = item.__uiKey || item.id || item.title || `item_${Date.now()}`;
  const title = item.title || item.id || 'Unknown pack';
  const repo = findRepoSlug(item);
  if (!repo) {
    return { key, title, repo: null, status: 'unknown', sizeKB: null, sizeGB: null };
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'modusnap-size-estimator',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://api.github.com/repos/${repo}`, { headers, signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      return { key, title, repo, status: `http_${res.status}`, sizeKB: null, sizeGB: null };
    }
    const json = await res.json();
    const sizeKB = Number(json?.size || 0);
    return {
      key,
      title,
      repo,
      status: 'ok',
      sizeKB,
      sizeGB: Number((sizeKB / (1024 * 1024)).toFixed(3)),
    };
  } catch {
    return { key, title, repo, status: 'error', sizeKB: null, sizeGB: null };
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const items = Array.isArray(body?.items) ? (body.items as CatalogItem[]) : [];
    if (items.length === 0) {
      return NextResponse.json({ error: 'No items provided.' }, { status: 400 });
    }

    const capped = items.slice(0, 1200);
    const results: any[] = [];
    const chunkSize = 20;
    for (let i = 0; i < capped.length; i += chunkSize) {
      const chunk = capped.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(chunk.map((item) => estimateOne(item)));
      results.push(...chunkResults);
    }

    const known = results.filter((row) => typeof row.sizeKB === 'number');
    const totalKB = known.reduce((sum, row) => sum + Number(row.sizeKB || 0), 0);
    return NextResponse.json({
      ok: true,
      total: capped.length,
      knownCount: known.length,
      unknownCount: capped.length - known.length,
      totalKB,
      totalGB: Number((totalKB / (1024 * 1024)).toFixed(3)),
      results: results.sort((a, b) => Number(b.sizeKB || 0) - Number(a.sizeKB || 0)),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to estimate repository sizes', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
