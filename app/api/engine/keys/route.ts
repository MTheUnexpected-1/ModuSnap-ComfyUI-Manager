import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveBackendDir } from '../../_lib/backendControl';

type ApiKeyRecord = {
  id: string;
  label: string;
  key: string;
  createdAt: string;
  revoked: boolean;
};

function getKeyStorePath() {
  const backendDir = resolveBackendDir();
  return path.join(backendDir, 'user', 'modusnap_engine_api_keys.json');
}

function readStore(): ApiKeyRecord[] {
  const storePath = getKeyStorePath();
  if (!fs.existsSync(storePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(keys: ApiKeyRecord[]) {
  const storePath = getKeyStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(keys, null, 2)}\n`, 'utf-8');
}

function maskKey(raw: string) {
  if (!raw || raw.length < 10) return '****';
  return `${raw.slice(0, 8)}...${raw.slice(-4)}`;
}

export async function GET() {
  const keys = readStore();
  const active = keys.filter((entry) => !entry.revoked);
  return NextResponse.json({
    ok: true,
    activeCount: active.length,
    keys: active.map((entry) => ({
      id: entry.id,
      label: entry.label,
      createdAt: entry.createdAt,
      maskedKey: maskKey(entry.key),
    })),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = (body?.action as string | undefined) || 'create';

    const store = readStore();

    if (action === 'revoke') {
      const keyId = (body?.keyId as string | undefined) || '';
      if (!keyId) {
        return NextResponse.json({ ok: false, error: 'Missing keyId for revoke' }, { status: 400 });
      }
      const updated = store.map((entry) => (entry.id === keyId ? { ...entry, revoked: true } : entry));
      writeStore(updated);
      return NextResponse.json({ ok: true });
    }

    const label = (body?.label as string | undefined) || 'ComfyUI Custom Manager';
    const rawKey = `msnp_${crypto.randomBytes(24).toString('hex')}`;
    const record: ApiKeyRecord = {
      id: crypto.randomUUID(),
      label,
      key: rawKey,
      createdAt: new Date().toISOString(),
      revoked: false,
    };

    const next = [record, ...store].slice(0, 100);
    writeStore(next);

    return NextResponse.json({
      ok: true,
      apiKey: rawKey,
      keyInfo: {
        id: record.id,
        label: record.label,
        createdAt: record.createdAt,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to manage engine API keys', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
