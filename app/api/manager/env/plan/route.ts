import { NextResponse } from 'next/server';
import { createPlan } from '../../../_lib/managerEnvEngine';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const tx = createPlan({
      mode: body?.mode,
      packages: body?.packages,
    });
    return NextResponse.json({ ok: true, transaction: tx });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to create env plan.', details: error?.message || String(error) },
      { status: 500 },
    );
  }
}
