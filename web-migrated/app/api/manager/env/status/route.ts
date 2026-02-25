import { NextResponse } from 'next/server';
import { getEnvStatus } from '../../../_lib/managerEnvEngine';

export async function GET() {
  try {
    return NextResponse.json(getEnvStatus());
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to fetch env status.', details: error?.message || String(error) },
      { status: 500 },
    );
  }
}
