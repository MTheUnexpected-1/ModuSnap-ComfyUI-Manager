import { NextResponse } from 'next/server';
import { BACKEND_URL } from '../../_lib/backendControl';

export async function GET() {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${BACKEND_URL}/system_stats`, {
            cache: 'no-store',
            signal: controller.signal,
        }).finally(() => clearTimeout(timer));

        if (!res.ok) {
            return NextResponse.json({ ok: false, error: `Backend returned ${res.status}` }, { status: 502 });
        }

        const data = await res.json();
        return NextResponse.json({ ok: true, data });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err?.message || 'Backend unreachable' }, { status: 502 });
    }
}
