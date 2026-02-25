import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

export const BACKEND_URL = 'http://localhost:8188';

export function resolveWorkspaceRoot() {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), '..', '..'),
    path.resolve(process.cwd(), '..', '..', '..'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'start-backend.sh'))) {
      return candidate;
    }
  }

  return path.resolve(process.cwd(), '..', '..');
}

export function resolveBackendDir() {
  const root = resolveWorkspaceRoot();
  return path.join(root, 'backend-comfyui');
}

export function getRestartLogPath() {
  return path.join(resolveBackendDir(), 'user', 'modusnap_backend_restart.log');
}

export async function isBackendUp() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(`${BACKEND_URL}/system_stats`, {
      cache: 'no-store',
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    return res.ok;
  } catch {
    return false;
  }
}

export async function isBackendPortListening(host = 'localhost', port = 8188, timeoutMs = 2000) {
  return await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

export function restartBackendDetached() {
  const root = resolveWorkspaceRoot();
  const scriptPath = path.join(root, 'start-backend.sh');
  const logPath = getRestartLogPath();

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const command = `cd "${root}" && "${scriptPath}" >> "${logPath}" 2>&1`;

  const child = spawn('bash', ['-lc', command], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return {
    started: true,
    pid: child.pid,
    logPath,
  };
}

export function tailFile(filePath: string, maxLines = 120) {
  if (!fs.existsSync(filePath)) return '';
  let fd: number | null = null;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) return '';
    fd = fs.openSync(filePath, 'r');

    const linesNeeded = Math.max(20, Math.min(maxLines, 1000));
    const chunkSize = 64 * 1024;
    const maxBytesToRead = 4 * 1024 * 1024;
    let totalBytesRead = 0;
    let position = stat.size;
    let chunks: string[] = [];
    let newlineCount = 0;

    while (position > 0 && newlineCount <= linesNeeded + 2 && totalBytesRead < maxBytesToRead) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;

      const buffer = Buffer.allocUnsafe(readSize);
      const bytesRead = fs.readSync(fd, buffer, 0, readSize, position);
      if (bytesRead <= 0) break;
      totalBytesRead += bytesRead;

      const chunk = buffer.subarray(0, bytesRead).toString('utf-8');
      chunks.unshift(chunk);
      newlineCount += (chunk.match(/\n/g) || []).length;
    }

    const text = chunks.join('');
    const lines = text.split('\n');
    return lines.slice(Math.max(0, lines.length - linesNeeded)).join('\n');
  } catch {
    return '';
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close errors.
      }
    }
  }
}
