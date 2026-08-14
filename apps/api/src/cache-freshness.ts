import type { FastifyBaseLogger } from 'fastify';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from './firestore-admin.js';
import { getDashboardSummary, getItineraryTerritoryWatermarks } from './mssql-dashboard.js';
import { type DashboardScope, writeDashboardCache } from './dashboard-cache.js';

const DEFAULT_CLIENTS = ['wert'];
const DEFAULT_INTERVAL_MS = 60_000;
const LEASE_TTL_MS = Number(process.env.DASHBOARD_CACHE_LEASE_TTL_MS ?? 120_000);
const CHECK_TIMEOUT_MS = Number(process.env.DASHBOARD_CACHE_WATCH_TIMEOUT_MS ?? 45_000);
const VIEW_KEY = 'dashboardSummary';

type FreshnessState = {
  territoryWatermarks?: Record<string, string>;
  lastCheckedAt?: string;
  lastGlobalWatermark?: string | null;
};

type ScopeCacheDoc = {
  scopeHash?: string;
  scopeKey?: string;
  periodKey?: string;
  businessRulesVersion?: string;
  scopeDefinition?: {
    clientId?: string;
    userId?: string;
    territories?: string[];
    roles?: string[];
  };
};

function configuredClients() {
  return (process.env.DASHBOARD_CACHE_WATCH_CLIENTS ?? DEFAULT_CLIENTS.join(','))
    .split(',')
    .map((client) => client.trim().toLowerCase())
    .filter(Boolean);
}

function freshnessChecksEnabled() {
  return process.env.DASHBOARD_CACHE_FRESHNESS_ENABLED !== 'false';
}

function shouldRunInProcessWatcher() {
  return process.env.DASHBOARD_CACHE_WATCH_ENABLED === 'true';
}

function maxIso(values: string[]) {
  return values.reduce<string | null>((latest, value) => (!latest || value > latest ? value : latest), null);
}

function intersects(left: string[], right: Set<string>) {
  return left.some((value) => right.has(value));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error) => { clearTimeout(timeout); reject(error); },
    );
  });
}

async function acquireLease(instanceId: string) {
  const db = getAdminFirestore();
  const leaseRef = db.doc('systemRuntime/dashboardCacheFreshnessLease');
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(Date.now() + LEASE_TTL_MS);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(leaseRef);
    const data = snap.data() as { expiresAt?: Timestamp; holder?: string } | undefined;
    if (data?.expiresAt && data.expiresAt.toMillis() > Date.now() && data.holder !== instanceId) {
      return false;
    }
    tx.set(leaseRef, { holder: instanceId, acquiredAt: now, expiresAt }, { merge: true });
    return true;
  });
}

async function refreshDashboardScopeCaches(clientId: string, changedTerritories: string[], sourceWatermark: string | null, logger: FastifyBaseLogger) {
  const db = getAdminFirestore();
  const changed = new Set(changedTerritories);
  const scopeCaches = await db.collection(`iDoXs_Clients/${clientId}/scopeCaches`).listDocuments();
  let staleCount = 0;
  let refreshedCount = 0;
  let skippedCount = 0;

  for (const scopeRef of scopeCaches) {
    const viewRef = scopeRef.collection('viewCaches').doc(VIEW_KEY);
    const snap = await viewRef.get();
    if (!snap.exists) continue;

    const data = snap.data() as ScopeCacheDoc & { stale?: boolean; expiresAt?: string };
    const territories = data.scopeDefinition?.territories ?? [];
    const affectedTerritories = territories.filter((territory) => changed.has(territory));
    const changedScope = affectedTerritories.length > 0;

    if (changedScope) {
      staleCount += 1;
      await viewRef.set({
        stale: true,
        staleReason: 'itinerary-territory-watermark-advanced',
        staleDetectedAt: new Date().toISOString(),
        affectedTerritories,
        sourceWatermark,
        cache: {
          ...(snap.data()?.cache ?? {}),
          stale: true,
          staleReason: 'itinerary-territory-watermark-advanced',
          staleDetectedAt: new Date().toISOString(),
        },
      }, { merge: true });
    }

    try {
      const scopeHash = data.scopeHash ?? scopeRef.id;
      const scope: DashboardScope = {
        clientId,
        userId: data.scopeDefinition?.userId ?? 'system',
        territories,
        roles: data.scopeDefinition?.roles ?? [],
        periodKey: data.periodKey ?? 'current',
        scopeHash,
        scopeKey: data.scopeKey ?? `territory:${scopeHash}`,
        cachePath: viewRef.path,
      };
      const summary = await getDashboardSummary(clientId, territories);
      await writeDashboardCache(summary, scope, { sourceWatermark });
      refreshedCount += 1;
    } catch (error) {
      skippedCount += 1;
      logger.warn({ error, clientId, scopePath: viewRef.path }, 'Failed to refresh dashboard cache from scheduled freshness check.');
    }
  }

  return { staleCount, refreshedCount, skippedCount };
}

export async function runDashboardCacheFreshnessCheck(logger: FastifyBaseLogger) {
  if (!freshnessChecksEnabled()) return { skipped: true, reason: 'disabled' };

  const instanceId = process.env.K_REVISION || process.env.HOSTNAME || `${process.pid}`;
  if (!(await acquireLease(instanceId))) return { skipped: true, reason: 'lease-held' };
  logger.info({ instanceId, clients: configuredClients() }, 'Dashboard cache freshness check started.');

  const db = getAdminFirestore();
  const results = [] as Array<{ clientId: string; changedTerritories: number; staleCount: number; refreshedCount: number; skippedCount: number }>;

  for (const clientId of configuredClients()) {
    logger.info({ clientId }, 'Checking itinerary territory watermarks.');
    const stateRef = db.doc(`iDoXs_Clients/${clientId}/systemState/itineraryFreshness`);
    const stateSnap = await stateRef.get();
    const state = (stateSnap.data() ?? {}) as FreshnessState;
    const previous = state.territoryWatermarks ?? {};
    const changedSinceIso = state.lastGlobalWatermark ?? null;
    const current = await withTimeout(getItineraryTerritoryWatermarks(clientId, changedSinceIso), CHECK_TIMEOUT_MS, `Timed out reading itinerary watermarks for ${clientId}.`);

    const changedTerritories = current
      .filter((row) => !previous[row.territoryId] || row.latestVisitDate > previous[row.territoryId])
      .map((row) => row.territoryId);

    const currentDeltaMap = Object.fromEntries(current.map((row) => [row.territoryId, row.latestVisitDate]));
    const currentMap = { ...previous, ...currentDeltaMap };
    const sourceWatermark = maxIso(current.filter((row) => changedTerritories.includes(row.territoryId)).map((row) => row.latestVisitDate));
    const lastGlobalWatermark = maxIso([state.lastGlobalWatermark ?? '', ...Object.values(currentMap)].filter(Boolean));

    if (changedTerritories.length > 0) {
      logger.info({ clientId, changedTerritories: changedTerritories.length, sampleTerritories: changedTerritories.slice(0, 10), sourceWatermark }, 'Itinerary changes detected; marking affected dashboard caches stale before refresh.');
    }

    const refreshed = await refreshDashboardScopeCaches(clientId, changedTerritories, sourceWatermark, logger);
    const staleCount = refreshed.staleCount;
    const refreshedCount = refreshed.refreshedCount;
    const skippedCount = refreshed.skippedCount;

    await stateRef.set({
      clientId,
      lastCheckedAt: new Date().toISOString(),
      territoryWatermarks: currentMap,
      lastChangedTerritories: changedTerritories,
      lastSourceWatermark: sourceWatermark,
      lastGlobalWatermark,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    logger.info({ clientId, changedSinceIso, watermarkCount: current.length, changedTerritories: changedTerritories.length, staleCount, refreshedCount, skippedCount, lastGlobalWatermark }, 'Itinerary freshness client check completed.');
    results.push({ clientId, changedTerritories: changedTerritories.length, staleCount, refreshedCount, skippedCount });
  }

  return { skipped: false, results };
}

export function startDashboardCacheFreshnessCron(logger: FastifyBaseLogger) {
  if (!shouldRunInProcessWatcher()) {
    logger.info('Dashboard cache freshness watcher disabled.');
    return;
  }

  const intervalMs = Number(process.env.DASHBOARD_CACHE_WATCH_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runDashboardCacheFreshnessCheck(logger);
      logger.info({ result }, 'Dashboard cache freshness check completed.');
    } catch (error) {
      logger.warn({ error }, 'Dashboard cache freshness check failed.');
    } finally {
      running = false;
    }
  };

  setTimeout(() => void tick(), Number(process.env.DASHBOARD_CACHE_WATCH_INITIAL_DELAY_MS ?? 1_000));
  setInterval(() => void tick(), intervalMs);
  logger.info({ intervalMs, clients: configuredClients() }, 'Dashboard cache freshness watcher started.');
}
