import { NextResponse } from 'next/server';
import { applyTransaction } from '../../../_lib/managerEnvEngine';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body?.id || body?.transactionId || '').trim();
    if (!id) {
      return NextResponse.json(
        { ok: false, error: 'Missing transaction id.' },
        { status: 400 },
      );
    }
    const result = applyTransaction(id);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to apply env transaction.', details: error?.message || String(error) },
      { status: 500 },
    );
  }
}
