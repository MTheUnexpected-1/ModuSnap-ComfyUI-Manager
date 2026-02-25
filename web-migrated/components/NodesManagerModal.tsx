import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Search, Wrench, X } from 'lucide-react';

interface NodesManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  objectInfo: Record<string, any> | null;
  onNodeCatalogRefresh?: () => Promise<void>;
}

type ManagerStatus = {
  managerRoutesReachable?: boolean;
  managerVersion?: string | null;
  backendDir?: string | null;
  backendUrl?: string | null;
};

type CatalogItem = {
  id?: string;
  name?: string;
  title?: string;
  repo?: string;
  installed?: boolean;
  enabled?: boolean;
  description?: string;
};

function normalizeCatalogItem(raw: unknown): CatalogItem {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  return {
    id: typeof o.id === 'string' ? o.id : typeof o.reference === 'string' ? o.reference : undefined,
    name: typeof o.name === 'string' ? o.name : undefined,
    title:
      typeof o.title === 'string'
        ? o.title
        : typeof o.name === 'string'
          ? o.name
          : typeof o.repository === 'string'
            ? o.repository
            : undefined,
    repo:
      typeof o.repo === 'string'
        ? o.repo
        : typeof o.repository === 'string'
          ? o.repository
          : typeof o.url === 'string'
            ? o.url
            : undefined,
    installed: typeof o.installed === 'boolean' ? o.installed : typeof o.is_installed === 'boolean' ? o.is_installed : undefined,
    enabled: typeof o.enabled === 'boolean' ? o.enabled : typeof o.active === 'boolean' ? o.active : undefined,
    description: typeof o.description === 'string' ? o.description : typeof o.summary === 'string' ? o.summary : undefined,
  };
}

function toArray(value: unknown): CatalogItem[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.map(normalizeCatalogItem);
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    const candidates: unknown[] = [];
    if (Array.isArray(obj.items)) candidates.push(...obj.items);
    if (Array.isArray(obj.data)) candidates.push(...obj.data);
    if (Array.isArray(obj.catalog)) candidates.push(...obj.catalog);
    if (Array.isArray(obj.custom_nodes)) candidates.push(...obj.custom_nodes);
    if (Array.isArray(obj.nodes)) candidates.push(...obj.nodes);

    if (obj.channel && typeof obj.channel === 'object') {
      const ch = obj.channel as Record<string, unknown>;
      if (Array.isArray(ch.items)) candidates.push(...ch.items);
      if (Array.isArray(ch.custom_nodes)) candidates.push(...ch.custom_nodes);
    }

    if (candidates.length > 0) {
      return candidates.map(normalizeCatalogItem);
    }

    return [normalizeCatalogItem(obj)];
  }

  return [];
}

export default function NodesManagerModal({ isOpen, onClose, onNodeCatalogRefresh }: NodesManagerModalProps) {
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [fixingDeps, setFixingDeps] = useState(false);
  const [status, setStatus] = useState<ManagerStatus | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((item) => {
      const haystack = `${item.title || ''} ${item.name || ''} ${item.repo || ''} ${item.description || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [catalog, query]);

  async function loadStatus() {
    setLoadingStatus(true);
    setError(null);
    try {
      const res = await fetch('/api/manager/status', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Failed to load manager status.');
      }
      setStatus(data || null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load manager status.');
    } finally {
      setLoadingStatus(false);
    }
  }

  async function loadCatalog() {
    setLoadingCatalog(true);
    setError(null);
    try {
      const res = await fetch('/api/manager/catalog', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Failed to load manager catalog.');
        setCatalog([]);
      } else {
        setCatalog(toArray(data));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load manager catalog.');
      setCatalog([]);
    } finally {
      setLoadingCatalog(false);
    }
  }

  async function refreshAll() {
    await Promise.all([loadStatus(), loadCatalog()]);
    if (onNodeCatalogRefresh) {
      await onNodeCatalogRefresh().catch(() => undefined);
    }
  }

  async function runDependencyAutoFix() {
    setFixingDeps(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/manager/fix', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(data?.message || data?.error || 'Dependency auto-fix failed.');
      } else {
        const restartMode = data?.restart?.mode || 'unknown';
        setInfo(`Dependency auto-fix completed. Backend restart mode: ${restartMode}.`);
      }
      await refreshAll();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Dependency auto-fix failed.');
    } finally {
      setFixingDeps(false);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    void refreshAll();
  }, [isOpen]);

  if (!isOpen) return null;

  const managerOnline = Boolean(status?.managerRoutesReachable);

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">ModuSnap ComfyUI Manager</h2>
            <p className="mt-1 text-xs text-zinc-400">Integrated manager panel (separate backend/API, native app UI).</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void runDependencyAutoFix()}
              className="inline-flex items-center gap-2 rounded-md border border-amber-400/30 px-3 py-2 text-xs text-amber-200 hover:bg-amber-500/10 disabled:opacity-60"
              aria-label="Run dependency auto-fix"
              disabled={fixingDeps}
            >
              {fixingDeps ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
              {fixingDeps ? 'Fixing...' : 'Auto-Fix Dependencies'}
            </button>
            <button
              onClick={() => void refreshAll()}
              className="inline-flex items-center gap-2 rounded-md border border-white/15 px-3 py-2 text-xs text-zinc-300 hover:bg-white/10"
              aria-label="Refresh manager"
              disabled={loadingStatus || loadingCatalog}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingStatus || loadingCatalog ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={onClose}
              className="rounded-md border border-white/15 p-2 text-zinc-300 hover:bg-white/10"
              aria-label="Close manager"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 border-b border-white/10 bg-zinc-900/40 px-5 py-4 md:grid-cols-4">
          <div className="rounded-lg border border-white/10 bg-zinc-900/60 p-3">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Manager API</p>
            <p className={`mt-2 text-sm font-semibold ${managerOnline ? 'text-emerald-300' : 'text-amber-300'}`}>
              {managerOnline ? 'Online' : 'Unavailable'}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-zinc-900/60 p-3">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Manager Version</p>
            <p className="mt-2 text-sm font-semibold text-zinc-100">{status?.managerVersion || 'Unknown'}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-zinc-900/60 p-3 md:col-span-2">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Catalog</p>
            <p className="mt-2 text-sm font-semibold text-zinc-100">{catalog.length} entries loaded</p>
          </div>
        </div>

        {error ? (
          <div className="border-b border-rose-500/20 bg-rose-500/10 px-5 py-3 text-sm text-rose-200">{error}</div>
        ) : null}
        {info ? (
          <div className="border-b border-emerald-500/20 bg-emerald-500/10 px-5 py-3 text-sm text-emerald-200">{info}</div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-white/10 px-5 py-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search nodes by name, title, repo, or description"
                className="w-full rounded-lg border border-white/10 bg-zinc-900/70 py-2 pl-9 pr-3 text-sm text-zinc-100 outline-none ring-cyan-500/30 placeholder:text-zinc-500 focus:ring"
              />
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            {loadingCatalog ? (
              <div className="flex items-center gap-2 text-sm text-zinc-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading manager catalog...
              </div>
            ) : filteredCatalog.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-zinc-900/40 p-4 text-sm text-zinc-400">
                No catalog entries available yet.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredCatalog.map((item, index) => {
                  const title = item.title || item.name || item.id || `Node ${index + 1}`;
                  return (
                    <article key={`${item.id || item.repo || title}-${index}`} className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
                      <p className="text-sm font-semibold text-zinc-100">{title}</p>
                      {item.repo ? <p className="mt-1 text-xs text-zinc-400 break-all">{item.repo}</p> : null}
                      {item.description ? <p className="mt-2 line-clamp-3 text-xs text-zinc-400">{item.description}</p> : null}
                      <div className="mt-3 flex items-center gap-2 text-[11px]">
                        <span className={`rounded-full px-2 py-0.5 ${item.installed ? 'bg-emerald-500/20 text-emerald-200' : 'bg-zinc-700 text-zinc-300'}`}>
                          {item.installed ? 'Installed' : 'Not Installed'}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 ${item.enabled ? 'bg-cyan-500/20 text-cyan-200' : 'bg-zinc-700 text-zinc-300'}`}>
                          {item.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
