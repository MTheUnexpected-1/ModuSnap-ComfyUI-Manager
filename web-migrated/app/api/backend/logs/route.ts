import { NextResponse } from 'next/server';
import path from 'node:path';
import { getRestartLogPath, isBackendUp, resolveBackendDir, tailFile } from '../../_lib/backendControl';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const linesParam = Number(url.searchParams.get('lines') || '120');
    const lines = Number.isFinite(linesParam) ? Math.max(20, Math.min(linesParam, 500)) : 120;

    const backendDir = resolveBackendDir();
    const comfyLogPath = path.join(backendDir, 'user', 'comfyui.log');
    const restartLogPath = getRestartLogPath();

    return NextResponse.json({
      backendUp: await isBackendUp(),
      comfyLogPath,
      restartLogPath,
      comfyLogTail: tailFile(comfyLogPath, lines),
      restartLogTail: tailFile(restartLogPath, lines),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: 'Failed to resolve backend directory',
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
