import { NextResponse } from 'next/server';
import { listTransactions } from '../../../_lib/managerEnvEngine';

export async function GET() {
  try {
    return NextResponse.json({ ok: true, transactions: listTransactions() });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to list env transactions.', details: error?.message || String(error) },
      { status: 500 },
    );
  }
}
