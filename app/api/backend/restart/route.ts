import { NextResponse } from 'next/server';
import { BACKEND_URL, isBackendUp, restartBackendDetached } from '../../_lib/backendControl';

export async function POST() {
  try {
    if (await isBackendUp()) {
      try {
        const rebootRes = await fetch(`${BACKEND_URL}/v2/manager/reboot`, { method: 'GET', cache: 'no-store' });
        const text = await rebootRes.text();
        if (rebootRes.ok) {
          return NextResponse.json({ ok: true, mode: 'manager_reboot', details: text || 'reboot-requested' });
        }
      } catch {
        // Fall back to detached restart.
      }
    }

    const started = restartBackendDetached();
    return NextResponse.json({ ok: true, mode: 'detached_start', ...started });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: 'Failed to restart backend', details: error?.message || String(error) }, { status: 500 });
  }
}
