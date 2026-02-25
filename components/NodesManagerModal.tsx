import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Clipboard,
  ChevronDown,
  ChevronRight,
  Layers,
  Loader2,
  Package,
  Search,
  ShieldCheck,
  Wrench,
  X,
  Activity,
  FolderTree,
  Filter,
  RotateCcw,
  Save,
  HardDrive,
  Play,
} from 'lucide-react';

interface NodesManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  objectInfo: Record<string, any> | null;
  onNodeCatalogRefresh?: () => Promise<void>;
}

type ManagerDiagnostics = {
  backendUp: boolean;
  backendDir: string;
  diagnosticsMode?: 'fast' | 'deep';
  managerEndpoint: string | null;
  managerRoutesReachable: boolean;
  managerVersion?: string | null;
  managerInstalledInVenv: boolean;
  managerImportRuntimeOk?: boolean;
  managerRuntimeVersion?: string | null;
  venvFound: boolean;
  managerImportCheck: string;
  managerImportRuntimeOutput?: string;
  pipCheckPassed?: boolean;
  pipCheckOutput?: string;
  managerProbeResults?: Array<{ endpoint: string; ok: boolean; status?: number; error?: string }>;
  hardwareProfile?: string | null;
  dependenciesSyncedAt?: string | null;
  torchRuntime?: {
    torchVersion: string;
    cudaAvailable: boolean;
    cudaVersion: string | null;
    mpsAvailable: boolean;
  } | null;
  nodeCount: number;
  hasKSampler: boolean;
  kSamplerHasSeedControl: boolean;
  sslIssue?: boolean;
  pipIssue?: boolean;
  actions: string[];
  issues?: Array<{
    id: string;
    severity: 'error' | 'warning' | 'info';
    title: string;
    cause: string;
    evidence: string;
    fix: string;
  }>;
};

type ExtensionsData = {
  customNodesDir: string;
  localCustomNodeDirs: string[];
  workflowTemplatesByPack: Record<string, string[]>;
};

type ManagerCatalogItem = {
  id?: string;
  title?: string;
  author?: string;
  description?: string;
  state?: string;
  action?: string;
  repository?: string;
  reference?: string;
  files?: string[];
  [key: string]: any;
};

type ManagerCatalogResponse = {
  channel?: string;
  node_packs?: Record<string, ManagerCatalogItem>;
};

type ManagerMappingsResponse = Record<string, [string[], { title_aux?: string }]>;

type ManagerActivityResponse = {
  status?: {
    total_count: number;
    done_count: number;
    in_progress_count: number;
    pending_count?: number;
    is_processing: boolean;
  };
  historyIds?: string[];
  history?: Array<{
    id: string;
    data?: any;
    error?: string;
  }>;
  error?: string;
};

type SnapshotResponse = {
  items: string[];
  current: any;
  currentStatus: number;
};

type BackendLogsResponse = {
  backendUp: boolean;
  comfyLogPath: string;
  restartLogPath: string;
  comfyLogTail: string;
  restartLogTail: string;
};

type PackPreflightResponse = {
  ok: boolean;
  mode: string;
  hardwareProfile: string;
  pipHealthy: boolean;
  pipCheckOutput: string;
  summary: {
    total: number;
    installable: number;
    warning: number;
    blocked: number;
  };
  globalWarnings: string[];
  blockedKeys?: string[];
  warningKeys?: string[];
  compact?: boolean;
  perItem: Array<{
    key: string;
    title: string;
    decision: 'installable' | 'warning' | 'blocked';
    reasons: string[];
  }>;
};

type PackSizeEstimateResponse = {
  ok: boolean;
  total: number;
  knownCount: number;
  unknownCount: number;
  totalKB: number;
  totalGB: number;
  results: Array<{
    key: string;
    title: string;
    repo: string | null;
    status: string;
    sizeKB: number | null;
    sizeGB: number | null;
  }>;
};

type CompatibilitySet = {
  lockId?: string;
  createdAt: string;
  hardwareProfile: string;
  pipHealthy: boolean;
  pipCheckOutput: string;
  selectedPackKeys: string[];
  selectedPackIds: string[];
  totalSelected: number;
  dependencyAudit?: {
    filesScanned?: number;
    packagesScanned?: number;
    conflictCount?: number;
    compatibleRequirementCount?: number;
    compatibleRequirementsPath?: string;
    incompatibleRequirementsPath?: string;
    reportPath?: string;
  };
};

type InstallItemStatus = 'pending' | 'queued' | 'done' | 'failed' | 'skipped';

type InstallSessionItem = {
  key: string;
  title: string;
  selected: boolean;
  status: InstallItemStatus;
  details?: string;
};

type InstallSessionState = {
  running: boolean;
  mode: 'install' | 'uninstall';
  scope: 'selected' | 'all_visible';
  startedAt: string;
  total: number;
  completed: number;
  remaining: number;
  currentChunk: number;
  totalChunks: number;
  logs: string[];
  items: InstallSessionItem[];
};

type TabKey = 'all' | 'categories' | 'packs' | 'install' | 'diagnostics' | 'activity' | 'recovery';
type PackFilter = 'all' | 'installed' | 'updates' | 'not_installed';

const CORE_CATEGORIES = new Set([
  'advanced',
  'conditioning',
  'image',
  'latent',
  'mask',
  'model_patches',
  'sampling',
  'utils',
  '_for_testing',
  'api_node',
  'dataset',
  'audio',
  '3d',
  'uncategorized',
]);

function normalizeRepoKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
}

function getCandidateRepoKeys(item: ManagerCatalogItem) {
  const candidates: string[] = [];
  if (item.repository) candidates.push(item.repository);
  if (item.reference) candidates.push(item.reference);
  if (Array.isArray(item.files)) candidates.push(...item.files.filter((entry) => typeof entry === 'string'));

  return Array.from(new Set(candidates.map(normalizeRepoKey).filter(Boolean)));
}

function summarizeActivityResult(historyEntry: any) {
  const nodepackResult = historyEntry?.nodepack_result || {};
  const modelResult = historyEntry?.model_result || {};
  const failed = Array.isArray(historyEntry?.failed) ? historyEntry.failed : [];

  const nodepackRows = Object.entries(nodepackResult).map(([name, message]) => ({
    name,
    message: String(message ?? ''),
    isError: String(message ?? '').toLowerCase().includes('error'),
  }));

  const modelRows = Object.entries(modelResult).map(([name, message]) => ({
    name,
    message: String(message ?? ''),
    isError: String(message ?? '').toLowerCase().includes('error'),
  }));

  return {
    nodepackRows,
    modelRows,
    failed,
    hasErrors: failed.length > 0 || nodepackRows.some((row) => row.isError) || modelRows.some((row) => row.isError),
  };
}

function toCompatibilityPayload(row: { key: string; item: ManagerCatalogItem }) {
  return {
    __uiKey: row.key,
    id: row.item?.id || row.key,
    title: row.item?.title || row.key,
    author: row.item?.author || '',
    description: row.item?.description || '',
    repository: row.item?.repository || '',
    reference: row.item?.reference || '',
    files: Array.isArray(row.item?.files) ? row.item.files : [],
  };
}

function prettifyNodeClassName(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveNodeDisplayName(className: string, def: any) {
  const displayName = String(def?.display_name || '').trim();
  if (displayName && displayName !== className) {
    return displayName;
  }
  const boundaries = (className.match(/[a-z0-9][A-Z]/g) || []).length;
  if (boundaries >= 2 || className.includes('_')) {
    return prettifyNodeClassName(className);
  }
  return displayName || className;
}

export default function NodesManagerModal({ isOpen, onClose, objectInfo, onNodeCatalogRefresh }: NodesManagerModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [packFilter, setPackFilter] = useState<PackFilter>('all');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const [diagnostics, setDiagnostics] = useState<ManagerDiagnostics | null>(null);
  const [extensions, setExtensions] = useState<ExtensionsData | null>(null);
  const [managerCatalog, setManagerCatalog] = useState<ManagerCatalogResponse | null>(null);
  const [managerMappings, setManagerMappings] = useState<ManagerMappingsResponse | null>(null);
  const [managerActivity, setManagerActivity] = useState<ManagerActivityResponse | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotResponse | null>(null);

  const [managerCatalogError, setManagerCatalogError] = useState<string | null>(null);
  const [mappingsError, setMappingsError] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [loadingManagerData, setLoadingManagerData] = useState(false);
  const [busyPackKey, setBusyPackKey] = useState<string | null>(null);
  const [busyBulkAction, setBusyBulkAction] = useState<string | null>(null);
  const [runningPreflight, setRunningPreflight] = useState(false);
  const [preflightReport, setPreflightReport] = useState<PackPreflightResponse | null>(null);
  const [grayOutIncompatible, setGrayOutIncompatible] = useState(false);
  const [incompatiblePackKeys, setIncompatiblePackKeys] = useState<string[]>([]);
  const [compatibilitySet, setCompatibilitySet] = useState<CompatibilitySet | null>(null);
  const [preparingCompatibilitySet, setPreparingCompatibilitySet] = useState(false);
  const [estimatingSize, setEstimatingSize] = useState(false);
  const [sizeEstimate, setSizeEstimate] = useState<PackSizeEstimateResponse | null>(null);
  const [showAdvancedPackActions, setShowAdvancedPackActions] = useState(false);
  const [installSession, setInstallSession] = useState<InstallSessionState | null>(null);
  const installCancelRef = useRef(false);
  const [selectedPackKeys, setSelectedPackKeys] = useState<Record<string, boolean>>({});
  const [expandedPackRows, setExpandedPackRows] = useState<Record<string, boolean>>({});
  const [busyIssueId, setBusyIssueId] = useState<string | null>(null);
  const [openEvidenceIssueId, setOpenEvidenceIssueId] = useState<string | null>(null);
  const [busySnapshotAction, setBusySnapshotAction] = useState<string | null>(null);
  const [backendLogs, setBackendLogs] = useState<BackendLogsResponse | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [showLogs, setShowLogs] = useState(true);

  const allNodes = useMemo(() => {
    if (!objectInfo) return [];

    return Object.entries(objectInfo)
      .map(([className, def]: [string, any]) => ({
        className,
        displayName: resolveNodeDisplayName(className, def),
        category: def?.category || 'uncategorized',
        rootCategory: (def?.category || 'uncategorized').split('/')[0].toLowerCase(),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [objectInfo]);

  const categories = useMemo(() => {
    const map = new Map<string, typeof allNodes>();
    allNodes.forEach((node) => {
      if (!map.has(node.rootCategory)) {
        map.set(node.rootCategory, []);
      }
      map.get(node.rootCategory)!.push(node);
    });

    return Array.from(map.entries())
      .map(([name, nodes]) => ({
        name,
        nodes: nodes.sort((a, b) => a.displayName.localeCompare(b.displayName)),
      }))
      .sort((a, b) => b.nodes.length - a.nodes.length);
  }, [allNodes]);

  useEffect(() => {
    if (!selectedCategory && categories.length > 0) {
      const firstCategory = categories[0];
      if (firstCategory) {
        setSelectedCategory(firstCategory.name);
      }
    }
  }, [categories, selectedCategory]);

  const filteredNodes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return allNodes;

    return allNodes.filter((node) =>
      node.className.toLowerCase().includes(query) ||
      node.displayName.toLowerCase().includes(query) ||
      node.category.toLowerCase().includes(query)
    );
  }, [allNodes, searchQuery]);

  const managerPackRows = useMemo(() => {
    const packs = managerCatalog?.node_packs || {};
    const rows = Object.entries(packs).map(([key, item]) => ({
      key,
      id: item?.id || key,
      title: item?.title || key,
      description: item?.description || '',
      author: item?.author || '',
      state: item?.state || 'unknown',
      action: item?.action || 'not-installed',
      updateState: item?.['update-state'] || 'false',
      item,
    }));

    const q = searchQuery.trim().toLowerCase();

    return rows
      .filter((row) => {
        if (packFilter === 'installed' && !['enabled', 'disabled', 'updatable', 'try-update'].includes(row.action)) {
          return false;
        }
        if (packFilter === 'updates' && row.updateState !== 'true' && row.action !== 'updatable' && row.action !== 'try-update') {
          return false;
        }
        if (packFilter === 'not_installed' && row.action !== 'not-installed' && row.action !== 'try-install') {
          return false;
        }
        return true;
      })
      .filter((row) => {
        if (!q) return true;
        return (
          row.title.toLowerCase().includes(q) ||
          row.id.toLowerCase().includes(q) ||
          row.author.toLowerCase().includes(q) ||
          row.description.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [managerCatalog, searchQuery, packFilter]);

  const selectedPackRows = useMemo(
    () => managerPackRows.filter((row) => Boolean(selectedPackKeys[row.key])),
    [managerPackRows, selectedPackKeys]
  );

  const allVisiblePacksSelected = useMemo(
    () => managerPackRows.length > 0 && managerPackRows.every((row) => Boolean(selectedPackKeys[row.key])),
    [managerPackRows, selectedPackKeys]
  );

  const mappingIndex = useMemo(() => {
    const index = new Map<string, { nodes: string[]; titleAux?: string }>();
    if (!managerMappings) return index;

    Object.entries(managerMappings).forEach(([repoKey, payload]) => {
      const nodes = Array.isArray(payload?.[0]) ? payload[0] : [];
      const meta = payload?.[1] || {};
      index.set(normalizeRepoKey(repoKey), { nodes, titleAux: meta?.title_aux });
    });

    return index;
  }, [managerMappings]);

  const objectInfoNodeNames = useMemo(() => new Set(allNodes.map((node) => node.className)), [allNodes]);

  const resolvePackNodes = (item: ManagerCatalogItem, title: string) => {
    const candidates = getCandidateRepoKeys(item);

    for (const key of candidates) {
      const mapped = mappingIndex.get(key);
      if (mapped) {
        return mapped.nodes;
      }
    }

    const loweredTitle = title.toLowerCase();
    for (const mapped of mappingIndex.values()) {
      if (mapped.titleAux && mapped.titleAux.toLowerCase().includes(loweredTitle)) {
        return mapped.nodes;
      }
    }

    return [];
  };

  const loadManagerData = async () => {
    setLoadingManagerData(true);
    try {
      const [diagnosticsRes, extensionsRes, catalogRes, mappingsRes, activityRes, snapshotsRes, compatibilitySetRes] = await Promise.all([
        fetch('/api/manager/status', { cache: 'no-store' }),
        fetch('/api/manager/extensions', { cache: 'no-store' }),
        fetch('/api/manager/catalog?mode=cache&skip_update=true', { cache: 'no-store' }),
        fetch('/api/manager/mappings?mode=local', { cache: 'no-store' }),
        fetch('/api/manager/activity?limit=8', { cache: 'no-store' }),
        fetch('/api/manager/snapshots', { cache: 'no-store' }),
        fetch('/api/manager/compatibility-set', { cache: 'no-store' }),
      ]);

      if (diagnosticsRes.ok) {
        setDiagnostics(await diagnosticsRes.json());
      }

      if (extensionsRes.ok) {
        setExtensions(await extensionsRes.json());
      }

      if (catalogRes.ok) {
        setManagerCatalog(await catalogRes.json());
        setManagerCatalogError(null);
      } else {
        const err = await catalogRes.json().catch(() => ({}));
        setManagerCatalogError(err?.hint || err?.error || `Manager catalog request failed (${catalogRes.status})`);
      }

      if (mappingsRes.ok) {
        setManagerMappings(await mappingsRes.json());
        setMappingsError(null);
      } else {
        const err = await mappingsRes.json().catch(() => ({}));
        setMappingsError(err?.error || `Mappings request failed (${mappingsRes.status})`);
      }

      if (activityRes.ok) {
        setManagerActivity(await activityRes.json());
        setActivityError(null);
      } else {
        const err = await activityRes.json().catch(() => ({}));
        setActivityError(err?.error || `Activity request failed (${activityRes.status})`);
      }

      if (snapshotsRes.ok) {
        setSnapshots(await snapshotsRes.json());
        setSnapshotError(null);
      } else {
        const err = await snapshotsRes.json().catch(() => ({}));
        setSnapshotError(err?.error || `Snapshots request failed (${snapshotsRes.status})`);
      }

      if (compatibilitySetRes.ok) {
        const payload = await compatibilitySetRes.json();
        setCompatibilitySet(payload?.compatibilitySet || null);
      } else {
        setCompatibilitySet(null);
      }
    } finally {
      setLoadingManagerData(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    loadManagerData();
    if (onNodeCatalogRefresh) {
      onNodeCatalogRefresh();
    }
  }, [isOpen, onNodeCatalogRefresh]);

  useEffect(() => {
    // Keep selection stable only for rows currently visible in this filtered view.
    setSelectedPackKeys((prev) => {
      const next: Record<string, boolean> = {};
      for (const row of managerPackRows) {
        if (prev[row.key]) next[row.key] = true;
      }
      return next;
    });
  }, [managerPackRows]);

  const loadBackendLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await fetch('/api/backend/logs?lines=140', { cache: 'no-store' });
      if (res.ok) {
        setBackendLogs(await res.json());
      }
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (!isOpen || activeTab !== 'diagnostics') return;
    loadBackendLogs();
    const interval = setInterval(() => {
      loadBackendLogs();
    }, 1500);
    return () => clearInterval(interval);
  }, [isOpen, activeTab]);

  const resolveActionMode = (row: { action: string }) => {
    const action = row.action;
    if (action === 'enabled' || action === 'updatable' || action === 'try-update') return 'update';
    if (action === 'disabled') return 'enable';
    if (action === 'invalid-installation') return 'reinstall';
    if (action === 'import-fail') return 'fix';
    if (action === 'unknown' || action === 'try-install') return 'install';
    if (action === 'not-installed') return 'install';
    if (action === 'uninstall') return 'uninstall';
    return 'install';
  };

  const actionLabel = (row: { action: string }) => {
    const mode = resolveActionMode(row);
    if (mode === 'update') return 'Update';
    if (mode === 'enable') return 'Enable';
    if (mode === 'reinstall') return 'Reinstall';
    if (mode === 'fix') return 'Fix';
    if (mode === 'uninstall') return 'Uninstall';
    return 'Install';
  };

  const copyFixToClipboard = async (fix: string) => {
    try {
      await navigator.clipboard.writeText(fix);
      setActivityError('Fix command copied to clipboard.');
    } catch {
      setActivityError('Unable to copy. Please copy the fix command manually.');
    }
  };

  const applyFix = async (issueId: string) => {
    setBusyIssueId(issueId);
    try {
      const res = await fetch('/api/manager/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.ok === false) {
        setActivityError(payload?.error || `Failed to apply fix for ${issueId}`);
      } else {
        setActivityError(`Fix applied for ${issueId}. Running automatic backend apply cycle...`);
        if (payload?.restartTriggered) {
          const waitForBackendReady = async (timeoutMs = 180000) => {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
              await loadBackendLogs();
              const statusRes = await fetch('/api/manager/status', { cache: 'no-store' });
              if (statusRes.ok) {
                const status = await statusRes.json();
                if (status?.backendUp) {
                  return true;
                }
              }
              await new Promise((resolve) => setTimeout(resolve, 1500));
            }
            return false;
          };

          const ready = await waitForBackendReady();
          if (ready && onNodeCatalogRefresh) {
            await onNodeCatalogRefresh();
          }
        }
      }
      await loadManagerData();
      setActivityError(null);
    } finally {
      setBusyIssueId(null);
    }
  };

  const snapshotAction = async (action: 'save' | 'restore' | 'remove', target?: string) => {
    setBusySnapshotAction(`${action}:${target || ''}`);
    try {
      const res = await fetch('/api/manager/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, target }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.ok === false) {
        setSnapshotError(payload?.error || `Snapshot action '${action}' failed`);
      } else {
        setSnapshotError(null);
        if (action === 'restore') {
          setActivityError('Snapshot restore scheduled. Applying reboot cycle...');
          await fetch('/api/manager/reboot', { method: 'POST' });
          await new Promise((resolve) => setTimeout(resolve, 3000));
          if (onNodeCatalogRefresh) {
            await onNodeCatalogRefresh();
          }
          setActivityError(null);
        }
      }
      await loadManagerData();
    } finally {
      setBusySnapshotAction(null);
    }
  };

  const handlePackAction = async (row: { key: string; item: ManagerCatalogItem; action: string }) => {
    const mode = resolveActionMode(row);
    setBusyPackKey(row.key);
    try {
      if (['install', 'update', 'reinstall', 'fix', 'enable'].includes(mode)) {
        await prepareCompatibleHardwareSet([{ key: row.key, item: row.item }], row.item?.title || row.key);
      }
      await runPackBatchAction(mode, [row.item], row.item?.title || row.key);
    } catch (error: any) {
      const msg = error?.message || 'Failed to run pack action';
      setManagerCatalogError(msg);
      setActivityError(msg);
    } finally {
      setBusyPackKey(null);
    }
  };

  const waitForQueueIdle = async (timeoutMs = 120000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const activityRes = await fetch('/api/manager/activity?limit=1', { cache: 'no-store' });
      if (activityRes.ok) {
        const activity = await activityRes.json();
        if (!activity?.status?.is_processing && (activity?.status?.pending_count ?? 0) === 0) {
          return true;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  };

  const waitForBackendReady = async (timeoutMs = 180000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const statusRes = await fetch('/api/manager/status', { cache: 'no-store' });
      if (statusRes.ok) {
        const status = await statusRes.json();
        if (status?.backendUp && status?.managerRoutesReachable) {
          return true;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return false;
  };

  const applyPreflightIncompatibleKeys = (payload: PackPreflightResponse | null) => {
    if (!payload) {
      setIncompatiblePackKeys([]);
      return;
    }
    const warningKeys = Array.isArray(payload.warningKeys) ? payload.warningKeys : [];
    const blockedKeys = Array.isArray(payload.blockedKeys) ? payload.blockedKeys : [];
    const fallbackKeys = Array.isArray(payload.perItem)
      ? payload.perItem.filter((entry) => entry.decision !== 'installable').map((entry) => entry.key)
      : [];
    const keys = Array.from(new Set([...warningKeys, ...blockedKeys, ...fallbackKeys])).filter(Boolean);
    setIncompatiblePackKeys(keys);
  };

  const prepareCompatibleHardwareSet = async (
    rows: Array<{ key: string; item: ManagerCatalogItem }>,
    modeLabel: string,
    options?: { forceRefresh?: boolean }
  ) => {
    const forceRefresh = Boolean(options?.forceRefresh);
    const createdAt = compatibilitySet?.createdAt ? new Date(compatibilitySet.createdAt).getTime() : 0;
    const freshEnough = createdAt > 0 && (Date.now() - createdAt) < 15 * 60 * 1000;
    const hardwareMatch = !compatibilitySet?.hardwareProfile || !diagnostics?.hardwareProfile || compatibilitySet.hardwareProfile === diagnostics.hardwareProfile;
    if (!forceRefresh && compatibilitySet?.pipHealthy && freshEnough && hardwareMatch) {
      return compatibilitySet;
    }

    setPreparingCompatibilitySet(true);
    try {
      const res = await fetch('/api/manager/compatibility-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prepare', items: rows.map((row) => toCompatibilityPayload(row)) }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.ok === false) {
        throw new Error(payload?.error || 'Failed to create compatible hardware set');
      }
      setCompatibilitySet(payload?.compatibilitySet || null);
      const audit = payload?.compatibilitySet?.dependencyAudit || payload?.dependencyAudit;
      const conflicts = Number(audit?.conflictCount || 0);
      const scanned = Number(audit?.filesScanned || 0);
      if (!payload?.compatibilitySet?.pipHealthy) {
        setActivityError('Compatibility set saved with warnings. Install will continue, but check Diagnostics for dependency issues.');
      } else {
        setActivityError(
          conflicts > 0
            ? `Compatibility set refreshed for ${modeLabel}. Scanned ${scanned} requirement file(s); ${conflicts} dependency conflict(s) logged.`
            : `Compatible hardware set refreshed for ${modeLabel}.`
        );
      }
      return payload?.compatibilitySet as CompatibilitySet;
    } finally {
      setPreparingCompatibilitySet(false);
    }
  };

  const estimatePackSizes = async (rows: Array<{ key: string; item: ManagerCatalogItem }>) => {
    if (rows.length === 0) {
      setActivityError('No packs available for size estimate.');
      return;
    }
    setEstimatingSize(true);
    try {
      const res = await fetch('/api/manager/size-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: rows.map((row) => toCompatibilityPayload(row)) }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.ok === false) {
        setActivityError(payload?.error || 'Failed to estimate pack sizes.');
        return;
      }
      setSizeEstimate(payload);
      setActivityError(`Estimated visible repository footprint: ${payload.totalGB} GB (${payload.knownCount}/${payload.total} known).`);
    } finally {
      setEstimatingSize(false);
    }
  };

  const pushInstallLog = (message: string) => {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    setInstallSession((prev) => {
      if (!prev) return prev;
      const logs = [...prev.logs, line].slice(-300);
      return { ...prev, logs };
    });
  };

  const updateInstallItems = (keys: string[], status: InstallItemStatus, details?: string) => {
    const keySet = new Set(keys);
    setInstallSession((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((item) => (
        keySet.has(item.key) ? { ...item, status, details } : item
      ));
      const completed = items.filter((item) => ['done', 'failed', 'skipped'].includes(item.status)).length;
      return {
        ...prev,
        items,
        completed,
        remaining: Math.max(0, items.length - completed),
      };
    });
  };

  const openInstallCenter = async (scope: 'selected' | 'all_visible') => {
    const sourceRows = scope === 'selected' ? selectedPackRows : managerPackRows;
    const rows = getInstallCandidates(sourceRows);
    if (rows.length === 0) {
      setActivityError('No install candidates in selected scope.');
      return;
    }

    const preflightRes = await fetch('/api/manager/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'install', items: rows.map((row) => toCompatibilityPayload({ key: row.key, item: row.item })) }),
    });
    if (!preflightRes.ok) {
      const err = await preflightRes.json().catch(() => ({}));
      setActivityError(err?.error || 'Compatibility preflight failed.');
      return;
    }
    const preflight = await preflightRes.json();
    setPreflightReport(preflight);
    applyPreflightIncompatibleKeys(preflight);

    const incompatibleKeys = new Set(
      (Array.isArray(preflight?.perItem) ? preflight.perItem : [])
        .filter((entry: any) => entry?.decision !== 'installable')
        .map((entry: any) => String(entry?.key || ''))
        .filter(Boolean)
    );
    const installableRows = rows.filter((row) => !incompatibleKeys.has(row.key));
    const removedCount = rows.length - installableRows.length;
    if (installableRows.length === 0) {
      setActivityError('All visible candidates are incompatible for this hardware/runtime profile.');
      return;
    }

    setInstallSession({
      running: false,
      mode: 'install',
      scope,
      startedAt: new Date().toISOString(),
      total: installableRows.length,
      completed: 0,
      remaining: installableRows.length,
      currentChunk: 0,
      totalChunks: 0,
      logs: [
        `[${new Date().toLocaleTimeString()}] Install plan prepared for ${installableRows.length} installable pack(s).`,
        ...(removedCount > 0 ? [`[${new Date().toLocaleTimeString()}] Removed ${removedCount} incompatible pack(s) from download list.`] : []),
      ],
      items: installableRows.map((row) => ({
        key: row.key,
        title: row.title,
        selected: true,
        status: 'pending',
      })),
    });
    setActiveTab('install');
  };

  const executeInstallSession = async () => {
    if (!installSession || installSession.running) return;
    installCancelRef.current = false;

    const selectedKeySet = new Set(
      installSession.items.filter((item) => item.selected).map((item) => item.key)
    );
    const candidateRows = managerPackRows
      .filter((row) => selectedKeySet.has(row.key))
      .filter((row) => !isInstalledPackAction(row.action));

    if (candidateRows.length === 0) {
      setActivityError('No selected install candidates to run.');
      return;
    }

    setInstallSession((prev) => prev ? { ...prev, running: true, total: candidateRows.length, remaining: candidateRows.length, completed: 0 } : prev);
    try {
      pushInstallLog(`Starting smart install for ${candidateRows.length} selected pack(s).`);
      const preflightRes = await fetch('/api/manager/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'install', items: candidateRows.map((row) => toCompatibilityPayload({ key: row.key, item: row.item })) }),
      });
      if (!preflightRes.ok) {
        const err = await preflightRes.json().catch(() => ({}));
        throw new Error(err?.error || 'Preflight failed.');
      }
      const preflight = await preflightRes.json();
      setPreflightReport(preflight);
      applyPreflightIncompatibleKeys(preflight);

      const incompatibleKeys = (Array.isArray(preflight?.perItem) ? preflight.perItem : [])
        .filter((entry: any) => entry?.decision !== 'installable')
        .map((entry: any) => String(entry?.key || ''));
      if (incompatibleKeys.length > 0) {
        updateInstallItems(incompatibleKeys, 'skipped', 'removed by compatibility preflight');
        pushInstallLog(`Skipped ${incompatibleKeys.length} incompatible pack(s).`);
      }

      const installableRows = candidateRows.filter((row) => !incompatibleKeys.includes(row.key));
      if (installableRows.length === 0) {
        pushInstallLog('No installable packs remain after compatibility filtering.');
        return;
      }

      await prepareCompatibleHardwareSet(installableRows.map((row) => ({ key: row.key, item: row.item })), `${installableRows.length} pack(s)`);
      await fetch('/api/manager/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save' }),
      });

      const chunkSize = installableRows.length > 200 ? 20 : 40;
      const totalChunks = Math.ceil(installableRows.length / chunkSize);
      setInstallSession((prev) => prev ? { ...prev, totalChunks } : prev);

      for (let i = 0; i < installableRows.length; i += chunkSize) {
        if (installCancelRef.current) {
          pushInstallLog('Install canceled by user.');
          break;
        }

        const chunk = installableRows.slice(i, i + chunkSize);
        const chunkKeys = chunk.map((row) => row.key);
        const chunkIndex = Math.floor(i / chunkSize) + 1;
        setInstallSession((prev) => prev ? { ...prev, currentChunk: chunkIndex } : prev);
        updateInstallItems(chunkKeys, 'queued', `queued in chunk ${chunkIndex}`);
        pushInstallLog(`Queueing chunk ${chunkIndex}/${totalChunks}: ${chunk.map((row) => row.title).join(', ')}`);

        try {
          await runPackBatchAction(
            'install',
            chunk.map((row) => row.item),
            `${chunk.length} pack(s)`,
            { skipSnapshot: true, skipApplyCycle: true, skipWaitForQueue: true, keepCurrentTab: true }
          );
          updateInstallItems(chunkKeys, 'done', `queued successfully in chunk ${chunkIndex}`);
        } catch (chunkError: any) {
          updateInstallItems(chunkKeys, 'failed', chunkError?.message || 'chunk failed');
          pushInstallLog(`Chunk ${chunkIndex} failed: ${chunkError?.message || 'unknown error'}`);
        }
      }

      if (!installCancelRef.current) {
        const waitTimeout = Math.max(300000, totalChunks * 45000);
        const idle = await waitForQueueIdle(waitTimeout);
        if (!idle) {
          throw new Error('Bulk queue did not become idle in time.');
        }
        pushInstallLog('Queue drained. Applying backend refresh...');
        const rebootRes = await fetch('/api/manager/reboot', { method: 'POST' });
        if (!rebootRes.ok) {
          const rebootErr = await rebootRes.json().catch(() => ({}));
          throw new Error(rebootErr?.error || 'Automatic apply failed after queue.');
        }
        const ready = await waitForBackendReady();
        if (!ready) {
          throw new Error('Backend did not become ready after apply cycle.');
        }
        if (onNodeCatalogRefresh) {
          await onNodeCatalogRefresh();
        }
        try {
          pushInstallLog('Running post-install dependency reconciliation...');
          const fixRes = await fetch('/api/manager/fix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ issueId: 'pip_check_failed' }),
          });
          const fixPayload = await fixRes.json().catch(() => ({}));
          if (fixRes.ok && fixPayload?.ok) {
            const removedCount = Array.isArray(fixPayload?.removedConflictingPackages)
              ? fixPayload.removedConflictingPackages.length
              : 0;
            pushInstallLog(`Dependency reconciliation complete${removedCount > 0 ? ` (removed ${removedCount} conflicting package(s))` : ''}.`);
          } else {
            pushInstallLog(`Dependency reconciliation reported issues: ${fixPayload?.error || 'unknown error'}`);
          }
        } catch (fixError: any) {
          pushInstallLog(`Dependency reconciliation failed: ${fixError?.message || 'unknown error'}`);
        }
        await loadManagerData();
        pushInstallLog('Install session finished successfully.');
      }
    } catch (error: any) {
      pushInstallLog(`Install session failed: ${error?.message || 'unknown error'}`);
      setActivityError(error?.message || 'Install session failed');
    } finally {
      setInstallSession((prev) => prev ? { ...prev, running: false } : prev);
    }
  };

  const runPackBatchAction = async (
    mode: string,
    items: ManagerCatalogItem[],
    label: string,
    options?: { skipSnapshot?: boolean; skipApplyCycle?: boolean; skipWaitForQueue?: boolean; keepCurrentTab?: boolean }
  ) => {
    if (items.length === 0) return;
    const skipSnapshot = Boolean(options?.skipSnapshot);
    const skipApplyCycle = Boolean(options?.skipApplyCycle);
    const skipWaitForQueue = Boolean(options?.skipWaitForQueue);
    const keepCurrentTab = Boolean(options?.keepCurrentTab);
    setActivityError(null);

    const needsApplyCycle = ['install', 'update', 'reinstall', 'fix', 'enable', 'uninstall'].includes(mode);
    if (needsApplyCycle && !skipSnapshot) {
      await fetch('/api/manager/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save' }),
      });
    }

    const res = await fetch('/api/manager/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        channel: managerCatalog?.channel || 'default',
        sourceMode: 'cache',
        items,
      }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload?.error || 'Manager action failed');
    }

    const skippedCount = Array.isArray(payload?.skipped) ? payload.skipped.length : 0;
    if (skippedCount > 0) {
      const firstReason = payload?.skipped?.[0]?.reason;
      setActivityError(`Manager queued ${items.length - skippedCount}/${items.length} item(s). ${skippedCount} skipped${firstReason ? ` (${firstReason})` : ''}.`);
    }

    if (!skipWaitForQueue) {
      const idle = await waitForQueueIdle();
      if (!idle) {
        throw new Error('Manager queue did not become idle in time.');
      }
      await loadManagerData();
    }

    if (needsApplyCycle && !skipApplyCycle) {
      const rebootRes = await fetch('/api/manager/reboot', { method: 'POST' });
      if (rebootRes.ok) {
        setActivityError(`Applying ${label} changes and refreshing node catalog...`);
        const ready = await waitForBackendReady();
        if (ready && onNodeCatalogRefresh) {
          await onNodeCatalogRefresh();
        }
        await loadManagerData();
        setActivityError(null);
      } else {
        const rebootErr = await rebootRes.json().catch(() => ({}));
        throw new Error(rebootErr?.error || 'Batch action completed, but automatic apply failed. Use Refresh and retry.');
      }
    }

    if (!keepCurrentTab) {
      setActiveTab('activity');
    }
  };

  const isInstalledPackAction = (action: string) =>
    ['enabled', 'disabled', 'updatable', 'try-update', 'uninstall', 'import-fail', 'invalid-installation'].includes(action);

  const getInstallCandidates = (rows: typeof managerPackRows) =>
    rows.filter((row) => !isInstalledPackAction(row.action));

  const getUninstallCandidates = (rows: typeof managerPackRows) =>
    rows.filter((row) => isInstalledPackAction(row.action));

  const runBulkPackAction = async (bulkMode: 'install' | 'uninstall', scope: 'selected' | 'all_visible') => {
    const sourceRows = scope === 'selected' ? selectedPackRows : managerPackRows;
    const rows = bulkMode === 'install' ? getInstallCandidates(sourceRows) : getUninstallCandidates(sourceRows);

    if (rows.length === 0) {
      setActivityError(`No ${bulkMode} candidates found in ${scope === 'selected' ? 'selected packs' : 'visible list'}.`);
      return;
    }

    setBusyBulkAction(`${bulkMode}:${scope}`);
    try {
      if (bulkMode === 'install') {
        const preflightRes = await fetch('/api/manager/preflight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: bulkMode, items: rows.map((row) => toCompatibilityPayload(row)) }),
        });
        if (preflightRes.ok) {
          const preflight = await preflightRes.json();
          setPreflightReport(preflight);
          applyPreflightIncompatibleKeys(preflight);
          const warningCount = Number(preflight?.summary?.warning || 0);
          const blockedCount = Number(preflight?.summary?.blocked || 0);
          const globalWarningCount = Array.isArray(preflight?.globalWarnings) ? preflight.globalWarnings.length : 0;
          const blockedKeys = Array.isArray(preflight?.blockedKeys)
            ? new Set(preflight.blockedKeys.map((key: string) => String(key)))
            : new Set<string>();
          const installableRows = rows.filter((row) => !blockedKeys.has(row.key));

          if (warningCount > 0 || blockedCount > 0 || globalWarningCount > 0) {
            setActivityError(`Smart install continuing with ${warningCount} warning(s), ${blockedCount} blocked pack(s), ${globalWarningCount} global warning(s).`);
          }

          if (installableRows.length === 0) {
            setActivityError('No compatible packs available after compatibility filtering.');
            return;
          }

          await prepareCompatibleHardwareSet(installableRows.map((row) => ({ key: row.key, item: row.item })), `${installableRows.length} pack(s)`);
          if (blockedCount > 0) {
            setActivityError(`${blockedCount} blocked pack(s) were skipped due to hardware/runtime incompatibility.`);
          }

          await fetch('/api/manager/snapshots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save' }),
          });

          const chunkSize = installableRows.length > 200 ? 20 : 40;
          const totalChunks = Math.ceil(installableRows.length / chunkSize);
          const failedChunks: string[] = [];
          for (let i = 0; i < installableRows.length; i += chunkSize) {
            const chunk = installableRows.slice(i, i + chunkSize);
            const chunkIndex = Math.floor(i / chunkSize) + 1;
            setActivityError(`Installing chunk ${chunkIndex}/${totalChunks} (${chunk.length} packs)...`);
            try {
              await runPackBatchAction(
                bulkMode,
                chunk.map((row) => row.item),
                `${chunk.length} pack(s)`,
                { skipSnapshot: true, skipApplyCycle: true, skipWaitForQueue: true }
              );
            } catch (chunkError: any) {
              failedChunks.push(`chunk ${chunkIndex}: ${chunkError?.message || 'failed'}`);
            }
          }

          const waitTimeout = Math.max(300000, totalChunks * 45000);
          const idle = await waitForQueueIdle(waitTimeout);
          if (!idle) {
            throw new Error('Bulk queue did not become idle in time.');
          }
          await loadManagerData();
          const rebootRes = await fetch('/api/manager/reboot', { method: 'POST' });
          if (rebootRes.ok) {
            const ready = await waitForBackendReady();
            if (ready && onNodeCatalogRefresh) {
              await onNodeCatalogRefresh();
            }
            await loadManagerData();
          } else {
            const rebootErr = await rebootRes.json().catch(() => ({}));
            throw new Error(rebootErr?.error || 'Automatic apply failed after bulk queue.');
          }

          if (failedChunks.length > 0) {
            setActivityError(`Installed with warnings. ${failedChunks.length} chunk(s) failed: ${failedChunks.slice(0, 3).join(' | ')}`);
          } else {
            setActivityError(`Installed ${installableRows.length} compatible pack(s).`);
          }
          if (scope === 'selected') {
            setSelectedPackKeys({});
          }
          return;
        }
      }

      await fetch('/api/manager/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save' }),
      });

      const chunkSize = rows.length > 200 ? 20 : 40;
      const totalChunks = Math.ceil(rows.length / chunkSize);
      const failedChunks: string[] = [];
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const chunkIndex = Math.floor(i / chunkSize) + 1;
        setActivityError(`${bulkMode === 'install' ? 'Installing' : 'Uninstalling'} chunk ${chunkIndex}/${totalChunks} (${chunk.length} packs)...`);
        try {
          await runPackBatchAction(
            bulkMode,
            chunk.map((row) => row.item),
            `${chunk.length} pack(s)`,
            { skipSnapshot: true, skipApplyCycle: true, skipWaitForQueue: true }
          );
        } catch (chunkError: any) {
          failedChunks.push(`chunk ${chunkIndex}: ${chunkError?.message || 'failed'}`);
        }
      }
      const waitTimeout = Math.max(300000, totalChunks * 45000);
      const idle = await waitForQueueIdle(waitTimeout);
      if (!idle) {
        throw new Error('Bulk queue did not become idle in time.');
      }
      await loadManagerData();
      const rebootRes = await fetch('/api/manager/reboot', { method: 'POST' });
      if (rebootRes.ok) {
        const ready = await waitForBackendReady();
        if (ready && onNodeCatalogRefresh) {
          await onNodeCatalogRefresh();
        }
        await loadManagerData();
      } else {
        const rebootErr = await rebootRes.json().catch(() => ({}));
        throw new Error(rebootErr?.error || 'Automatic apply failed after bulk queue.');
      }

      if (failedChunks.length > 0) {
        setActivityError(`${bulkMode === 'install' ? 'Install' : 'Uninstall'} finished with warnings. ${failedChunks.length} chunk(s) failed.`);
      } else {
        setActivityError(`${bulkMode === 'install' ? 'Installed' : 'Uninstalled'} ${rows.length} pack(s).`);
      }
      if (scope === 'selected') {
        setSelectedPackKeys({});
      }
    } catch (error: any) {
      setManagerCatalogError(error?.message || 'Failed to run bulk action');
    } finally {
      setBusyBulkAction(null);
    }
  };

  const runPreflight = async (scope: 'selected' | 'all_visible') => {
    const sourceRows = scope === 'selected' ? selectedPackRows : managerPackRows;
    if (sourceRows.length === 0) {
      setActivityError(`No packs in ${scope === 'selected' ? 'selected list' : 'visible list'} for compatibility check.`);
      return;
    }

    setRunningPreflight(true);
    try {
      const res = await fetch('/api/manager/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'install', items: sourceRows.map((row) => toCompatibilityPayload(row)) }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.ok === false) {
        setActivityError(payload?.error || 'Compatibility check failed.');
      } else {
        setPreflightReport(payload);
        applyPreflightIncompatibleKeys(payload);
        const set = await prepareCompatibleHardwareSet(
          sourceRows.map((row) => ({ key: row.key, item: row.item })),
          `${sourceRows.length} selected pack(s)`,
          { forceRefresh: true }
        );
        const audit = set?.dependencyAudit;
        const catalogAudit = (set as any)?.catalogAudit;
        const conflicts = Number(audit?.conflictCount || 0);
        const scanned = Number(audit?.filesScanned || 0);
        const catalogTotal = Number(catalogAudit?.totalCatalogItems || sourceRows.length);
        const catalogIncompatible = Number(catalogAudit?.incompatibleCount || 0);
        if (conflicts > 0) {
          setActivityError(`Compatibility check complete. Catalog audited: ${catalogTotal} pack(s), incompatible: ${catalogIncompatible}. Dependency conflicts: ${conflicts} across ${scanned} requirement file(s).`);
        } else {
          setActivityError(`Compatibility check complete. Catalog audited: ${catalogTotal} pack(s), incompatible: ${catalogIncompatible}. Compatible set saved.`);
        }
      }
    } finally {
      setRunningPreflight(false);
    }
  };

  if (!isOpen) return null;

  const selectedCategoryNodes = categories.find((entry) => entry.name === selectedCategory)?.nodes || [];
  const filteredCategoryNodes = selectedCategoryNodes.filter((node) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      node.className.toLowerCase().includes(q) ||
      node.displayName.toLowerCase().includes(q) ||
      node.category.toLowerCase().includes(q)
    );
  });

  const managerStatusClass = diagnostics?.managerRoutesReachable
    ? 'bg-green-500/10 border-green-500/20 text-green-300'
    : 'bg-amber-500/10 border-amber-500/20 text-amber-300';
  const displayedNodeCount = diagnostics?.nodeCount ?? allNodes.length;
  const incompatibleKeySet = new Set(incompatiblePackKeys);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#050510]/80 backdrop-blur-md p-6">
      <div className="w-full max-w-7xl h-[88vh] rounded-3xl border border-purple-500/30 bg-gradient-to-b from-[#0a0f1a]/95 to-[#000000]/95 backdrop-blur-3xl shadow-[0_30px_100px_rgba(168,85,247,0.25),inset_0_1px_0_rgba(255,255,255,0.05)] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-purple-500/20 bg-gradient-to-r from-purple-900/30 via-transparent to-transparent flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-600 border border-purple-400/50 flex items-center justify-center shadow-[0_0_15px_rgba(217,70,239,0.5)]">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight text-white drop-shadow-[0_0_10px_rgba(168,85,247,0.4)]">Modusnap ComfyUI Manager</h2>
              <p className="text-xs text-purple-200/60 font-medium tracking-wide border-l-2 border-purple-500/50 pl-2">COMFYUI CATALOG // PACK MAPPINGS // DIAGNOSTICS</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-11 h-11 rounded-full bg-black/40 hover:bg-purple-900/60 border border-white/10 hover:border-purple-500/60 text-gray-300 hover:text-white hover:shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-white/5 bg-black/20 flex flex-wrap items-center gap-2 text-xs">
          <span className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300">{displayedNodeCount} total nodes</span>
          <span className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300">{categories.length} category roots</span>
          <span className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300">{categories.filter((entry) => !CORE_CATEGORIES.has(entry.name)).length} custom packs</span>
          <span className={`px-3 py-1.5 rounded-lg border ${managerStatusClass}`}>
            manager {diagnostics?.managerRoutesReachable ? 'active' : 'not detected'}
          </span>
          {managerActivity?.status?.is_processing && (
            <span className="px-3 py-1.5 rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-300">install queue running</span>
          )}
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-64 border-r border-purple-500/10 bg-black/40 p-4 overflow-y-auto custom-scrollbar">
            <div className="space-y-2">
              <TabButton active={activeTab === 'all'} onClick={() => setActiveTab('all')} icon={<Layers className="w-4 h-4" />} label="All Nodes" />
              <TabButton active={activeTab === 'categories'} onClick={() => setActiveTab('categories')} icon={<FolderTree className="w-4 h-4" />} label="Categories" />
              <TabButton active={activeTab === 'packs'} onClick={() => setActiveTab('packs')} icon={<Package className="w-4 h-4" />} label="Node Packs" />
              <TabButton active={activeTab === 'install'} onClick={() => setActiveTab('install')} icon={<Play className="w-4 h-4" />} label="Install Center" />
              <TabButton active={activeTab === 'diagnostics'} onClick={() => setActiveTab('diagnostics')} icon={<Wrench className="w-4 h-4" />} label="Diagnostics" />
              <TabButton active={activeTab === 'activity'} onClick={() => setActiveTab('activity')} icon={<Activity className="w-4 h-4" />} label="Activity" />
              <TabButton active={activeTab === 'recovery'} onClick={() => setActiveTab('recovery')} icon={<HardDrive className="w-4 h-4" />} label="Recovery" />
            </div>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between gap-4">
              <div className="relative w-full max-w-lg">
                <Search className="w-4 h-4 absolute text-gray-400 left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={activeTab === 'packs' ? 'Search pack, id, author...' : 'Search class, label, category...'}
                  className="w-full bg-black/40 border border-white/10 rounded-xl py-2.5 pl-9 pr-4 text-sm text-gray-200 focus:outline-none focus:border-blue-500/60 focus:bg-white/5 transition-all"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {activeTab === 'packs' && (
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-gray-500" />
                  <select
                    className="bg-black/40 border border-white/10 rounded-lg py-2 px-2 text-xs text-gray-200 focus:outline-none"
                    value={packFilter}
                    onChange={(e) => setPackFilter(e.target.value as PackFilter)}
                  >
                    <option value="all">All packs</option>
                    <option value="installed">Installed</option>
                    <option value="updates">Updates available</option>
                    <option value="not_installed">Not installed</option>
                  </select>
                </div>
              )}
              <button
                onClick={loadManagerData}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-purple-900/30 border border-purple-500/30 text-purple-200 hover:text-white hover:bg-purple-600/50 hover:shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-all"
              >
                {loadingManagerData ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {activeTab === 'all' && (
              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                <div className="text-xs text-gray-400 mb-4">Showing {filteredNodes.length} / {allNodes.length} nodes from `object_info`.</div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {filteredNodes.map((node) => (
                    <div key={node.className} className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 hover:border-blue-500/30 hover:from-blue-500/[0.08] transition-all p-4">
                      <div className="text-sm font-semibold text-gray-100 truncate" title={node.displayName}>{node.displayName}</div>
                      <div className="text-[11px] text-gray-400 font-mono truncate mt-1" title={node.className}>{node.className}</div>
                      <div className="text-[11px] text-blue-300/80 mt-2 truncate" title={node.category}>{node.category}</div>
                    </div>
                  ))}
                </div>
                {filteredNodes.length === 0 && <div className="text-sm text-gray-500 text-center py-16">No nodes match your search.</div>}
              </div>
            )}

            {activeTab === 'categories' && (
              <div className="flex-1 overflow-hidden p-6 grid grid-cols-[260px,1fr] gap-4">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3 overflow-y-auto custom-scrollbar">
                  <div className="text-xs text-gray-400 px-2 pb-2">Category roots</div>
                  <div className="space-y-1">
                    {categories.map((entry) => (
                      <button
                        key={entry.name}
                        onClick={() => setSelectedCategory(entry.name)}
                        className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${selectedCategory === entry.name
                            ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                            : 'bg-white/0 border-transparent text-gray-300 hover:bg-white/5 hover:border-white/10'
                          }`}
                      >
                        <div className="font-semibold capitalize">{entry.name.replace(/_/g, ' ')}</div>
                        <div className="text-[11px] text-gray-400">{entry.nodes.length} nodes</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-4 overflow-y-auto custom-scrollbar">
                  <div className="text-sm text-gray-300 mb-3">
                    {selectedCategory ? (
                      <>
                        <span className="text-white font-semibold capitalize">{selectedCategory.replace(/_/g, ' ')}</span> · {filteredCategoryNodes.length} shown
                      </>
                    ) : (
                      'Select a category root'
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredCategoryNodes.map((node) => (
                      <div key={node.className} className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <div className="text-sm font-semibold text-gray-100 truncate" title={node.displayName}>{node.displayName}</div>
                        <div className="text-[11px] text-gray-400 font-mono truncate mt-1" title={node.className}>{node.className}</div>
                        <div className="text-[11px] text-blue-300/80 mt-2 truncate" title={node.category}>{node.category}</div>
                      </div>
                    ))}
                  </div>

                  {selectedCategory && filteredCategoryNodes.length === 0 && (
                    <div className="text-sm text-gray-500 text-center py-16">No nodes found in this category for the current search.</div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'packs' && (
              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-4">
                {managerCatalogError && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 px-4 py-3 text-xs">{managerCatalogError}</div>
                )}
                {mappingsError && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 px-4 py-3 text-xs">{mappingsError}</div>
                )}

                <div className="text-xs text-gray-400">
                  {loadingManagerData
                    ? 'Loading manager catalog and mappings...'
                    : `${managerPackRows.length} packs shown${managerCatalog?.channel ? ` (channel: ${managerCatalog.channel})` : ''}`}
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/25 p-3 flex flex-wrap items-center gap-2 text-xs">
                  <label className="inline-flex items-center gap-2 text-gray-200">
                    <input
                      type="checkbox"
                      checked={allVisiblePacksSelected}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelectedPackKeys((prev) => {
                          const next = { ...prev };
                          for (const row of managerPackRows) {
                            if (checked) next[row.key] = true;
                            else delete next[row.key];
                          }
                          return next;
                        });
                      }}
                      className="rounded border-white/30 bg-black/50"
                    />
                    Select all visible
                  </label>
                  <span className="text-gray-400">{selectedPackRows.length} selected</span>
                  <label className="inline-flex items-center gap-2 text-gray-300 px-2 py-1 rounded-md border border-white/10 bg-white/5">
                    <input
                      type="checkbox"
                      checked={grayOutIncompatible}
                      onChange={(e) => setGrayOutIncompatible(e.target.checked)}
                      className="rounded border-white/30 bg-black/50"
                    />
                    Gray out incompatible
                  </label>
                  {compatibilitySet && (
                    <span className={`px-2 py-1 rounded-md border ${compatibilitySet.pipHealthy ? 'border-green-500/20 bg-green-500/10 text-green-300' : 'border-amber-500/20 bg-amber-500/10 text-amber-300'}`}>
                      set: {compatibilitySet.pipHealthy ? 'ready' : 'issues'} • {compatibilitySet.hardwareProfile}
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      await openInstallCenter('selected');
                    }}
                    disabled={busyBulkAction !== null || selectedPackRows.length === 0 || preparingCompatibilitySet || installSession?.running === true}
                    className="px-2.5 py-1.5 rounded-md border border-blue-500/30 bg-blue-500/20 text-blue-200 hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busyBulkAction === 'install:selected' ? 'Installing...' : 'Smart Install Selected'}
                  </button>
                  <button
                    onClick={async () => {
                      await openInstallCenter('all_visible');
                    }}
                    disabled={busyBulkAction !== null || managerPackRows.length === 0 || preparingCompatibilitySet || installSession?.running === true}
                    className="px-2.5 py-1.5 rounded-md border border-blue-500/30 bg-blue-500/20 text-blue-200 hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busyBulkAction === 'install:all_visible' ? 'Installing...' : 'Smart Install All Visible'}
                  </button>
                  <button
                    onClick={() => setShowAdvancedPackActions((prev) => !prev)}
                    className="px-2.5 py-1.5 rounded-md border border-white/20 bg-white/10 text-gray-200 hover:bg-white/20"
                  >
                    {showAdvancedPackActions ? 'Hide Advanced' : 'Show Advanced'}
                  </button>
                  {showAdvancedPackActions && (
                    <>
                      <button
                        onClick={() => runPreflight('selected')}
                        disabled={runningPreflight || selectedPackRows.length === 0}
                        className="px-2.5 py-1.5 rounded-md border border-white/20 bg-white/10 text-gray-200 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {runningPreflight ? 'Checking...' : 'Compatibility Check (Selected)'}
                      </button>
                      <button
                        onClick={() => runPreflight('all_visible')}
                        disabled={runningPreflight || managerPackRows.length === 0}
                        className="px-2.5 py-1.5 rounded-md border border-white/20 bg-white/10 text-gray-200 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {runningPreflight ? 'Checking...' : 'Compatibility Check (All Visible)'}
                      </button>
                      <button
                        onClick={() => estimatePackSizes(managerPackRows.map((row) => ({ key: row.key, item: row.item })))}
                        disabled={estimatingSize || managerPackRows.length === 0}
                        className="px-2.5 py-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {estimatingSize ? 'Estimating...' : 'Estimate Size (Visible)'}
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => runBulkPackAction('uninstall', 'selected')}
                    disabled={busyBulkAction !== null || selectedPackRows.length === 0}
                    className="px-2.5 py-1.5 rounded-md border border-red-500/30 bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busyBulkAction === 'uninstall:selected' ? 'Uninstalling...' : 'Uninstall Selected'}
                  </button>
                  <button
                    onClick={() => runBulkPackAction('uninstall', 'all_visible')}
                    disabled={busyBulkAction !== null || managerPackRows.length === 0}
                    className="px-2.5 py-1.5 rounded-md border border-red-500/30 bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busyBulkAction === 'uninstall:all_visible' ? 'Uninstalling...' : 'Uninstall All Visible'}
                  </button>
                </div>

                {preflightReport && (
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-3 space-y-2 text-xs">
                    <div className="text-white font-semibold">Compatibility Check</div>
                    <div className="text-gray-300">
                      hardware: <span className="text-white">{preflightReport.hardwareProfile}</span> • total: <span className="text-white">{preflightReport.summary.total}</span> • installable: <span className="text-green-300">{preflightReport.summary.installable}</span> • warnings: <span className="text-amber-300">{preflightReport.summary.warning}</span> • blocked: <span className="text-red-300">{preflightReport.summary.blocked}</span>
                    </div>
                    {!preflightReport.pipHealthy && (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-200 px-2 py-1">
                        Environment has existing pip conflicts. Fix Diagnostics first for safest bulk install.
                      </div>
                    )}
                    {preflightReport.globalWarnings.length > 0 && (
                      <div className="space-y-1">
                        {preflightReport.globalWarnings.map((warning) => (
                          <div key={warning} className="rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-200 px-2 py-1">{warning}</div>
                        ))}
                      </div>
                    )}
                    {preflightReport.summary.warning > 0 && (
                      <div className="rounded-lg border border-white/10 bg-black/30 p-2 max-h-36 overflow-auto custom-scrollbar space-y-1">
                        {preflightReport.perItem.filter((row) => row.decision === 'warning').slice(0, 40).map((row) => (
                          <div key={row.key} className="text-amber-200">
                            <span className="font-semibold">{row.title}</span>
                            {row.reasons.map((reason) => (
                              <div key={reason} className="text-[11px] text-amber-100/90">{reason}</div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                    {preflightReport.summary.blocked > 0 && (
                      <div className="rounded-lg border border-white/10 bg-black/30 p-2 max-h-36 overflow-auto custom-scrollbar space-y-1">
                        {preflightReport.perItem.filter((row) => row.decision === 'blocked').slice(0, 40).map((row) => (
                          <div key={`blocked-${row.key}`} className="text-red-200">
                            <span className="font-semibold">{row.title}</span>
                            {row.reasons.map((reason) => (
                              <div key={reason} className="text-[11px] text-red-100/90">{reason}</div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {sizeEstimate && (
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-3 space-y-2 text-xs">
                    <div className="text-white font-semibold">Repository Size Estimate</div>
                    <div className="text-gray-300">
                      visible: <span className="text-white">{sizeEstimate.total}</span> • known: <span className="text-cyan-300">{sizeEstimate.knownCount}</span> • unknown: <span className="text-amber-300">{sizeEstimate.unknownCount}</span> • total: <span className="text-cyan-300">{sizeEstimate.totalGB} GB</span>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/30 p-2 max-h-36 overflow-auto custom-scrollbar space-y-1">
                      {sizeEstimate.results.slice(0, 25).map((row) => (
                        <div key={`size-${row.key}`} className="text-gray-200 flex items-center justify-between gap-2">
                          <span className="truncate">{row.title}</span>
                          <span className="font-mono text-[11px] text-cyan-200">{row.sizeGB !== null ? `${row.sizeGB} GB` : row.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {managerPackRows.map((row) => {
                  const mappedNodes = resolvePackNodes(row.item, row.title);
                  const matchedNodes = mappedNodes.filter((name) => objectInfoNodeNames.has(name));
                  const missingNodes = mappedNodes.filter((name) => !objectInfoNodeNames.has(name));
                  const isExpanded = !!expandedPackRows[row.key];
                  const isIncompatible = incompatibleKeySet.has(row.key);
                  const actionDisabled = (busyPackKey === row.key) || preparingCompatibilitySet || (grayOutIncompatible && isIncompatible);

                  return (
                    <div
                      key={row.key}
                      className={`rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-4 ${grayOutIncompatible && isIncompatible ? 'opacity-45 saturate-50' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-white font-semibold truncate">{row.title}</div>
                          <div className="text-[11px] text-gray-400 font-mono truncate mt-1">{row.id}</div>
                          <div className="text-xs text-gray-400 mt-1">{row.description || 'No description'}</div>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                            <span className="px-2 py-1 rounded-md border border-white/10 bg-black/30 text-blue-300">state: {row.state}</span>
                            <span className="px-2 py-1 rounded-md border border-white/10 bg-black/30 text-gray-300">action: {row.action}</span>
                            <span className="px-2 py-1 rounded-md border border-white/10 bg-black/30 text-gray-300">mapped nodes: {mappedNodes.length}</span>
                            <span className="px-2 py-1 rounded-md border border-white/10 bg-black/30 text-gray-300">active in object_info: {matchedNodes.length}</span>
                            {missingNodes.length > 0 && (
                              <span className="px-2 py-1 rounded-md border border-amber-500/20 bg-amber-500/10 text-amber-300">missing after install: {missingNodes.length}</span>
                            )}
                            {isIncompatible && (
                              <span className="px-2 py-1 rounded-md border border-red-500/20 bg-red-500/10 text-red-300">compatibility: flagged</span>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <label className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(selectedPackKeys[row.key])}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setSelectedPackKeys((prev) => {
                                  const next = { ...prev };
                                  if (checked) next[row.key] = true;
                                  else delete next[row.key];
                                  return next;
                                });
                              }}
                              className="rounded border-white/30 bg-black/50"
                            />
                          </label>
                          <button
                            onClick={() => setExpandedPackRows((prev) => ({ ...prev, [row.key]: !prev[row.key] }))}
                            className="px-3 py-2 rounded-lg text-xs bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                          >
                            <span className="inline-flex items-center gap-1">
                              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              Nodes
                            </span>
                          </button>
                          <button
                            onClick={() => handlePackAction(row)}
                            disabled={actionDisabled}
                            className="px-3 py-2 rounded-lg text-xs font-semibold bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {busyPackKey === row.key ? (
                              <span className="inline-flex items-center"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Working</span>
                            ) : (grayOutIncompatible && isIncompatible) ? (
                              'Blocked'
                            ) : actionLabel(row)}
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3">
                          <div className="text-xs text-gray-300 mb-2">Pack node classes</div>
                          {mappedNodes.length === 0 ? (
                            <div className="text-xs text-gray-500">No mapping list found for this pack. Install/update can still work, but mapping metadata is missing.</div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                              {mappedNodes.slice(0, 180).map((nodeName) => (
                                <div key={nodeName} className={`text-[11px] rounded-lg border px-2 py-1 font-mono truncate ${objectInfoNodeNames.has(nodeName) ? 'border-green-500/20 bg-green-500/10 text-green-300' : 'border-white/10 bg-black/30 text-gray-300'}`} title={nodeName}>
                                  {nodeName}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {managerPackRows.length === 0 && !managerCatalogError && (
                  <div className="text-sm text-gray-500 text-center py-16">No packs available. Check Diagnostics for manager API status.</div>
                )}

                <div className="rounded-2xl border border-white/10 bg-black/25 p-4 text-xs text-gray-300">
                  <div className="font-semibold text-white mb-2">Local Custom Node Folders</div>
                  <div className="text-gray-400 mb-3 break-all">{extensions?.customNodesDir || 'Not found'}</div>
                  <div className="flex flex-wrap gap-2">
                    {(extensions?.localCustomNodeDirs || []).map((dir) => (
                      <span key={dir} className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 text-gray-200 font-mono text-[11px]">{dir}</span>
                    ))}
                    {(extensions?.localCustomNodeDirs || []).length === 0 && <span className="text-gray-500">No custom node folders detected.</span>}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'install' && (
              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-4">
                {!installSession && (
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-8 text-center text-sm text-gray-500">
                    Start from Node Packs using Smart Install to open a tracked install session here.
                  </div>
                )}

                {installSession && (
                  <>
                    <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-white font-semibold">Smart Install Session</div>
                          <div className="text-xs text-gray-400">
                            scope: {installSession.scope === 'all_visible' ? 'all visible' : 'selected'} • mode: {installSession.mode}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setInstallSession((prev) => prev ? ({
                              ...prev,
                              items: prev.items.map((item) => ({ ...item, selected: true })),
                            }) : prev)}
                            disabled={installSession.running}
                            className="px-2.5 py-1.5 rounded-md border border-white/20 bg-white/10 text-gray-200 hover:bg-white/20 disabled:opacity-50 text-xs"
                          >
                            Select All
                          </button>
                          <button
                            onClick={() => setInstallSession((prev) => prev ? ({
                              ...prev,
                              items: prev.items.map((item) => ({ ...item, selected: false })),
                            }) : prev)}
                            disabled={installSession.running}
                            className="px-2.5 py-1.5 rounded-md border border-white/20 bg-white/10 text-gray-200 hover:bg-white/20 disabled:opacity-50 text-xs"
                          >
                            Unselect All
                          </button>
                          <button
                            onClick={executeInstallSession}
                            disabled={installSession.running || installSession.items.filter((item) => item.selected).length === 0}
                            className="px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/20 text-blue-200 hover:bg-blue-500/30 disabled:opacity-50 text-xs font-semibold"
                          >
                            {installSession.running ? 'Installing...' : 'Start Smart Install'}
                          </button>
                          <button
                            onClick={() => {
                              installCancelRef.current = true;
                              pushInstallLog('Cancel requested by user.');
                            }}
                            disabled={!installSession.running}
                            className="px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 disabled:opacity-50 text-xs font-semibold"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                        <StatBox title="Selected" value={String(installSession.items.filter((item) => item.selected).length)} />
                        <StatBox title="Downloaded" value={String(installSession.items.filter((item) => item.status === 'done').length)} />
                        <StatBox title="Failed" value={String(installSession.items.filter((item) => item.status === 'failed').length)} />
                        <StatBox title="Skipped" value={String(installSession.items.filter((item) => item.status === 'skipped').length)} />
                        <StatBox title="Remaining" value={String(installSession.remaining)} />
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs text-gray-300">
                          <span>Progress</span>
                          <span>{Math.min(100, Math.round(((installSession.completed || 0) / Math.max(1, installSession.total)) * 100))}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all"
                            style={{ width: `${Math.min(100, Math.round(((installSession.completed || 0) / Math.max(1, installSession.total)) * 100))}%` }}
                          />
                        </div>
                        <div className="text-[11px] text-gray-400">
                          chunk: {installSession.currentChunk}/{installSession.totalChunks || 0}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                        <div className="text-xs text-gray-300 mb-2">Install Queue Plan</div>
                        <div className="max-h-80 overflow-auto custom-scrollbar space-y-1">
                          {installSession.items.map((item) => (
                            <label key={`install-item-${item.key}`} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs">
                              <span className="inline-flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={item.selected}
                                  disabled={installSession.running}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setInstallSession((prev) => prev ? ({
                                      ...prev,
                                      items: prev.items.map((entry) => entry.key === item.key ? { ...entry, selected: checked } : entry),
                                    }) : prev);
                                  }}
                                  className="rounded border-white/30 bg-black/50"
                                />
                                <span className="truncate text-gray-200" title={item.title}>{item.title}</span>
                              </span>
                              <span className={`text-[11px] font-mono ${item.status === 'done'
                                  ? 'text-green-300'
                                  : item.status === 'failed'
                                    ? 'text-red-300'
                                    : item.status === 'skipped'
                                      ? 'text-amber-300'
                                      : item.status === 'queued'
                                        ? 'text-blue-300'
                                        : 'text-gray-400'
                                }`}>
                                {item.status}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                        <div className="text-xs text-gray-300 mb-2">Live Install Logs</div>
                        <pre className="h-80 overflow-auto text-[11px] text-gray-300 font-mono whitespace-pre-wrap rounded-lg border border-white/10 bg-black/40 p-2">
                          {(installSession.logs || []).join('\n') || '(no logs yet)'}
                        </pre>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'diagnostics' && (
              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-4 text-sm">
                {loadingManagerData && <div className="text-gray-400">Running diagnostics...</div>}

                {diagnostics && (
                  <>
                    <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-4">
                      <div className="font-semibold text-white mb-3">Runtime Health</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-300">
                        <div>Backend: <span className={diagnostics.backendUp ? 'text-green-400' : 'text-red-400'}>{diagnostics.backendUp ? 'up' : 'down'}</span></div>
                        <div>Manager route: <span className={diagnostics.managerRoutesReachable ? 'text-green-400' : 'text-amber-400'}>{diagnostics.managerRoutesReachable ? diagnostics.managerEndpoint : 'not reachable'}</span></div>
                        <div>Manager version: <span className={diagnostics.managerVersion ? 'text-green-400' : 'text-amber-400'}>{diagnostics.managerVersion || 'unknown'}</span></div>
                        <div>Python venv: <span className={diagnostics.venvFound ? 'text-green-400' : 'text-amber-400'}>{diagnostics.venvFound ? 'found' : 'missing'}</span></div>
                        <div>Manager backend: <span className={diagnostics.managerRoutesReachable ? 'text-green-400' : 'text-amber-400'}>{diagnostics.managerRoutesReachable ? 'active' : 'not detected'}</span></div>
                        <div>Manager package/import check: <span className={diagnostics.managerImportRuntimeOk ? 'text-green-400' : 'text-amber-400'}>{diagnostics.managerImportRuntimeOk ? 'ok' : (diagnostics.diagnosticsMode === 'fast' ? 'deferred (fast mode)' : 'failed')}</span></div>
                        <div>pip check: <span className={diagnostics.pipCheckPassed ? 'text-green-400' : 'text-amber-400'}>{diagnostics.pipCheckPassed ? 'clean' : 'issues detected'}</span></div>
                        <div>Hardware profile: <span className="text-white">{diagnostics.hardwareProfile || 'unknown'}</span></div>
                        <div>Torch runtime: <span className="text-white">{diagnostics.torchRuntime?.torchVersion || 'not detected'}</span></div>
                        <div>CUDA/MPS: <span className="text-white">{diagnostics.torchRuntime?.cudaAvailable ? `CUDA ${diagnostics.torchRuntime.cudaVersion || ''}` : diagnostics.torchRuntime?.mpsAvailable ? 'MPS' : 'CPU'}</span></div>
                        <div>object_info node count: <span className="text-white">{diagnostics.nodeCount}</span></div>
                        <div>KSampler seed mode metadata: <span className={diagnostics.kSamplerHasSeedControl ? 'text-green-400' : 'text-amber-400'}>{diagnostics.kSamplerHasSeedControl ? 'present' : 'missing'}</span></div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-4">
                      <div className="font-semibold text-white mb-2">Dependency and Compatibility Signals</div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className={`px-2 py-1 rounded-md border ${diagnostics.sslIssue ? 'border-amber-500/20 bg-amber-500/10 text-amber-300' : 'border-green-500/20 bg-green-500/10 text-green-300'}`}>SSL checks: {diagnostics.sslIssue ? 'issues detected' : 'clean'}</span>
                        <span className={`px-2 py-1 rounded-md border ${diagnostics.pipIssue ? 'border-amber-500/20 bg-amber-500/10 text-amber-300' : 'border-green-500/20 bg-green-500/10 text-green-300'}`}>pip install health: {diagnostics.pipIssue ? 'issues detected' : 'clean'}</span>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="font-semibold text-white">Live Backend Logs</div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setShowLogs((prev) => !prev)}
                            className="px-2 py-1 rounded-md border border-white/20 bg-white/10 text-gray-200 hover:bg-white/20 text-xs"
                          >
                            {showLogs ? 'Hide' : 'Show'}
                          </button>
                          <button
                            onClick={loadBackendLogs}
                            className="px-2 py-1 rounded-md border border-white/20 bg-white/10 text-gray-200 hover:bg-white/20 text-xs"
                          >
                            {loadingLogs ? 'Loading...' : 'Refresh Logs'}
                          </button>
                        </div>
                      </div>
                      <div className="text-[11px] text-gray-400 mb-2">
                        backend: {backendLogs?.backendUp ? 'up' : 'down'} • restart log: <span className="font-mono">{backendLogs?.restartLogPath || 'n/a'}</span>
                      </div>
                      {showLogs && (
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                          <div>
                            <div className="text-xs text-gray-300 mb-1">ComfyUI Log Tail</div>
                            <pre className="h-44 overflow-auto text-[11px] text-gray-300 font-mono whitespace-pre-wrap rounded-lg border border-white/10 bg-black/40 p-2">{backendLogs?.comfyLogTail || '(no log output yet)'}</pre>
                          </div>
                          <div>
                            <div className="text-xs text-gray-300 mb-1">Restart Worker Log Tail</div>
                            <pre className="h-44 overflow-auto text-[11px] text-gray-300 font-mono whitespace-pre-wrap rounded-lg border border-white/10 bg-black/40 p-2">{backendLogs?.restartLogTail || '(no restart log output yet)'}</pre>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-4">
                      <div className="font-semibold text-white mb-2">Root Cause Analysis</div>
                      <div className="space-y-3">
                        {(diagnostics.issues || []).length === 0 ? (
                          <div className="flex items-center text-green-400 text-xs"><ShieldCheck className="w-4 h-4 mr-2" />No blocking issues detected.</div>
                        ) : (
                          (diagnostics.issues || []).map((issue) => (
                            <div key={issue.id} className={`rounded-xl border p-3 text-xs ${issue.severity === 'error' ? 'border-red-500/20 bg-red-500/10 text-red-200' : issue.severity === 'warning' ? 'border-amber-500/20 bg-amber-500/10 text-amber-200' : 'border-blue-500/20 bg-blue-500/10 text-blue-200'}`}>
                              <div className="font-semibold">{issue.title}</div>
                              <div className="mt-1"><span className="text-white/80">Cause:</span> {issue.cause}</div>
                              <div className="mt-1"><span className="text-white/80">Evidence:</span> <span className="font-mono break-words">{issue.evidence}</span></div>
                              <div className="mt-2"><span className="text-white/80">Fix:</span></div>
                              <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-black/30 border border-white/10 p-2 font-mono text-[11px]">{issue.fix}</pre>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  onClick={() => applyFix(issue.id)}
                                  disabled={busyIssueId === issue.id}
                                  className="px-2 py-1 rounded-md border border-blue-500/30 bg-blue-500/20 text-blue-200 hover:bg-blue-500/30 disabled:opacity-50"
                                >
                                  {busyIssueId === issue.id ? 'Applying...' : 'Apply Fix'}
                                </button>
                                <button
                                  onClick={() => copyFixToClipboard(issue.fix)}
                                  className="px-2 py-1 rounded-md border border-white/20 bg-white/10 text-gray-200 hover:bg-white/20 inline-flex items-center gap-1"
                                >
                                  <Clipboard className="w-3 h-3" />
                                  Copy Fix
                                </button>
                                <button
                                  onClick={() => setOpenEvidenceIssueId((prev) => prev === issue.id ? null : issue.id)}
                                  className="px-2 py-1 rounded-md border border-white/20 bg-white/10 text-gray-200 hover:bg-white/20"
                                >
                                  {openEvidenceIssueId === issue.id ? 'Hide Evidence' : 'View Evidence'}
                                </button>
                              </div>
                              {openEvidenceIssueId === issue.id && (
                                <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-black/40 border border-white/10 p-2 font-mono text-[11px] text-gray-200">{issue.evidence}</pre>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/25 p-4 space-y-3">
                      <div>
                        <div className="font-semibold text-white mb-2">Manager Package Check</div>
                        <div className="text-xs text-gray-300 font-mono break-words">{diagnostics.managerImportCheck}</div>
                      </div>
                      <div>
                        <div className="font-semibold text-white mb-2">Manager Runtime Import Output</div>
                        <div className="text-xs text-gray-300 font-mono break-words">{diagnostics.managerImportRuntimeOutput || 'N/A'}</div>
                      </div>
                      <div>
                        <div className="font-semibold text-white mb-2">pip Check Output</div>
                        <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-words">{diagnostics.pipCheckOutput || 'N/A'}</pre>
                      </div>
                      <div>
                        <div className="font-semibold text-white mb-2">Manager Endpoint Probes</div>
                        <div className="space-y-1 text-xs">
                          {(diagnostics.managerProbeResults || []).map((probe) => (
                            <div key={probe.endpoint} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-1">
                              <span className="font-mono text-gray-300">{probe.endpoint}</span>
                              <span className={probe.ok ? 'text-green-400' : 'text-amber-300'}>
                                {probe.ok ? `ok (${probe.status})` : probe.error ? `error (${probe.error})` : `status ${probe.status ?? 'n/a'}`}
                              </span>
                            </div>
                          ))}
                          {(diagnostics.managerProbeResults || []).length === 0 && <div className="text-gray-500">No probes collected.</div>}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {!loadingManagerData && !diagnostics && <div className="text-gray-500 text-xs">Diagnostics unavailable.</div>}
              </div>
            )}

            {activeTab === 'activity' && (
              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-4">
                {activityError && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 px-4 py-3 text-xs">{activityError}</div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <StatBox title="Queue Total" value={String(managerActivity?.status?.total_count ?? 0)} />
                  <StatBox title="Queue Done" value={String(managerActivity?.status?.done_count ?? 0)} />
                  <StatBox title="In Progress" value={String(managerActivity?.status?.in_progress_count ?? 0)} />
                  <StatBox title="Processor" value={managerActivity?.status?.is_processing ? 'running' : 'idle'} />
                </div>

                <div className="text-xs text-gray-400">Recent operations</div>

                {(managerActivity?.history || []).map((entry) => {
                  if (entry.error) {
                    return (
                      <div key={entry.id} className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
                        <div className="font-mono">{entry.id}</div>
                        <div className="mt-1">{entry.error}</div>
                      </div>
                    );
                  }

                  const summary = summarizeActivityResult(entry.data);
                  const batch = entry.data?.batch || {};
                  const batchModes = Object.keys(batch).filter((key) => key !== 'batch_id');

                  return (
                    <div key={entry.id} className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div>
                          <div className="text-xs text-gray-400 font-mono">{entry.id}</div>
                          <div className="text-[11px] text-gray-500">modes: {batchModes.length ? batchModes.join(', ') : 'unknown'}</div>
                        </div>
                        <div className={`px-2 py-1 rounded-md border text-xs ${summary.hasErrors ? 'border-amber-500/20 bg-amber-500/10 text-amber-300' : 'border-green-500/20 bg-green-500/10 text-green-300'}`}>
                          {summary.hasErrors ? 'with errors' : 'ok'}
                        </div>
                      </div>

                      <div className="space-y-2 text-xs">
                        {summary.nodepackRows.map((row) => (
                          <div key={row.name} className={`rounded-lg border px-3 py-2 ${row.isError ? 'border-amber-500/20 bg-amber-500/10 text-amber-200' : 'border-green-500/20 bg-green-500/10 text-green-200'}`}>
                            <div className="font-mono break-all">{row.name}</div>
                            <div className="mt-1 break-words">{row.message}</div>
                          </div>
                        ))}

                        {summary.modelRows.map((row) => (
                          <div key={row.name} className={`rounded-lg border px-3 py-2 ${row.isError ? 'border-amber-500/20 bg-amber-500/10 text-amber-200' : 'border-green-500/20 bg-green-500/10 text-green-200'}`}>
                            <div className="font-mono break-all">{row.name}</div>
                            <div className="mt-1 break-words">{row.message}</div>
                          </div>
                        ))}

                        {summary.failed.length > 0 && (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-amber-200">
                            <div className="font-semibold">failed:</div>
                            <div className="font-mono break-words mt-1">{JSON.stringify(summary.failed)}</div>
                          </div>
                        )}

                        {summary.nodepackRows.length === 0 && summary.modelRows.length === 0 && summary.failed.length === 0 && (
                          <div className="text-gray-500">No detailed logs captured for this operation.</div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {(managerActivity?.history || []).length === 0 && (
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-8 text-center text-sm text-gray-500">
                    No install/update history yet. Trigger an action from Node Packs to see full operation logs.
                  </div>
                )}
              </div>
            )}

            {activeTab === 'recovery' && (
              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-4">
                {snapshotError && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 px-4 py-3 text-xs">{snapshotError}</div>
                )}
                <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">Recovery Time Machine</div>
                      <div className="text-xs text-gray-400 mt-1">Automatic snapshot is taken before node pack mutations. Use restore points to roll back.</div>
                    </div>
                    <button
                      onClick={() => snapshotAction('save')}
                      disabled={busySnapshotAction === 'save:'}
                      className="px-3 py-2 rounded-lg text-xs font-semibold bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 disabled:opacity-50"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Save className="w-3.5 h-3.5" />
                        {busySnapshotAction === 'save:' ? 'Saving...' : 'Create Snapshot'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="text-xs text-gray-400">{(snapshots?.items || []).length} restore points</div>
                {(snapshots?.items || []).map((item) => {
                  const restoreKey = `restore:${item}`;
                  const removeKey = `remove:${item}`;
                  return (
                    <div key={item} className="rounded-xl border border-white/10 bg-black/30 p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-white font-semibold truncate">{item}</div>
                        <div className="text-[11px] text-gray-400">Snapshot restore point</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => snapshotAction('restore', item)}
                          disabled={busySnapshotAction === restoreKey}
                          className="px-2.5 py-1.5 rounded-md border border-green-500/30 bg-green-500/15 text-green-300 hover:bg-green-500/25 text-xs disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" />
                          {busySnapshotAction === restoreKey ? 'Restoring...' : 'Restore'}
                        </button>
                        <button
                          onClick={() => snapshotAction('remove', item)}
                          disabled={busySnapshotAction === removeKey}
                          className="px-2.5 py-1.5 rounded-md border border-white/20 bg-white/10 text-gray-200 hover:bg-white/20 text-xs disabled:opacity-50"
                        >
                          {busySnapshotAction === removeKey ? 'Removing...' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {(snapshots?.items || []).length === 0 && (
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-8 text-center text-sm text-gray-500">
                    No snapshots found. Snapshots are created automatically before install/update operations.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
      <div className="text-[11px] text-gray-400 uppercase tracking-wide">{title}</div>
      <div className="text-lg font-semibold text-white mt-1">{value}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${active
          ? 'bg-blue-500/15 border-blue-500/30 text-blue-300 shadow-[0_0_20px_rgba(59,130,246,0.15)]'
          : 'bg-white/0 border-transparent text-gray-400 hover:text-white hover:bg-white/5 hover:border-white/10'
        }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
