import { NextResponse } from 'next/server';
import { getTransaction } from '../../../../_lib/managerEnvEngine';

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: Params) {
  try {
    const { id } = await context.params;
    const tx = getTransaction(String(id || '').trim());
    if (!tx) {
      return NextResponse.json({ ok: false, error: 'Transaction not found.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, transaction: tx });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to get env transaction.', details: error?.message || String(error) },
      { status: 500 },
    );
  }
}
