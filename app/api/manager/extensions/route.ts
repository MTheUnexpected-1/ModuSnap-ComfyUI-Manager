import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { resolveBackendDir } from '../../_lib/backendControl';

const BACKEND_URL = 'http://localhost:8188';

function resolveCustomNodesDir() {
  try {
    const backendDir = resolveBackendDir();
    return path.join(backendDir, 'custom_nodes');
  } catch {
    return path.resolve(process.cwd(), 'backend-comfyui', 'custom_nodes');
  }
}

function listLocalCustomNodeDirs(customNodesDir: string) {
  if (!fs.existsSync(customNodesDir)) return [] as string[];

  return fs.readdirSync(customNodesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.endsWith('.disabled'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function GET() {
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
}
