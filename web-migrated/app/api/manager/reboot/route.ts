import { NextResponse } from 'next/server';
import { BACKEND_URL, isBackendUp, restartBackendDetached } from '../../_lib/backendControl';

export async function POST() {
  try {
    if (await isBackendUp()) {
      const res = await fetch(`${BACKEND_URL}/v2/manager/reboot`, {
        method: 'GET',
        cache: 'no-store',
      });

      const text = await res.text();
      if (res.ok) {
        return NextResponse.json({ ok: true, mode: 'manager_reboot', status: res.status, details: text || 'reboot-requested' });
      }
    }

    const started = restartBackendDetached();
    return NextResponse.json({ ok: true, mode: 'detached_start', ...started });
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      error: 'Failed to request manager reboot',
      details: error?.message || String(error),
    }, { status: 503 });
  }
}
