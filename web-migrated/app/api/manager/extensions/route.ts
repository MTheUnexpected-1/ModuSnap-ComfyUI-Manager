import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { BACKEND_URL, resolveBackendDir } from '../../_lib/backendControl';

function resolveCustomNodesDir() {
  return path.join(resolveBackendDir(), 'custom_nodes');
}

function listLocalCustomNodeDirs(customNodesDir: string) {
  if (!fs.existsSync(customNodesDir)) return [] as string[];

  return fs.readdirSync(customNodesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.endsWith('.disabled'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function GET() {
  try {
    const customNodesDir = resolveCustomNodesDir();
    const localCustomNodeDirs = listLocalCustomNodeDirs(customNodesDir);

    let workflowTemplatesByPack: Record<string, string[]> = {};
    try {
      const response = await fetch(`${BACKEND_URL}/workflow_templates`, { cache: 'no-store' });
      if (response.ok) {
        workflowTemplatesByPack = await response.json();
      }
    } catch {
      // Backend might be down; return local filesystem results only.
    }

    return NextResponse.json({
      customNodesDir,
      localCustomNodeDirs,
      workflowTemplatesByPack,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: 'Failed to resolve backend custom nodes directory',
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
