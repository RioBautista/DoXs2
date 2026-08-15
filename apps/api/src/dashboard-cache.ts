import crypto from 'node:crypto';
import type { DashboardActivityOverview, DashboardCacheDocument, DashboardSummary } from '@doxs/shared';
import { getAdminFirestore } from './firestore-admin.js';
import type { SessionPayload } from './session.js';

const DASHBOARD_SUMMARY_VIEW_KEY = 'dashboardSummary';
const DASHBOARD_ACTIVITY_OVERVIEW_VIEW_KEY = 'activityOverview';
const BUSINESS_RULES_VERSION = '1';
const CACHE_TTL_MS = Number(process.env.DASHBOARD_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000);

function stableHash(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}


function toFirestoreJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
}

export type DashboardScope = {
  clientId: string;
  userId: string;
  territories: string[];
  roles: string[];
  periodKey: string;
  scopeHash: string;
  scopeKey: string;
  cachePath: string;
};

export function resolveDashboardScope(session: SessionPayload, clientSlug?: string | null, assignedTerritories: string[] = []): DashboardScope {
  const clientId = sanitizePathSegment(clientSlug || session.clientSlug || 'default');
  const userId = sanitizePathSegment(session.username);
  const roles = [...session.roles].sort();
  const territories = assignedTerritories.length > 0 ? [...assignedTerritories].sort() : [`user:${userId}`];
  const periodKey = 'current';
  const scopeBasis = { clientId, territories, roles, periodKey, businessRulesVersion: BUSINESS_RULES_VERSION };
  const scopeHash = stableHash(scopeBasis);
  const scopeKey = `territory:${scopeHash}`;
  const cachePath = viewCachePathFor(clientId, scopeHash, DASHBOARD_SUMMARY_VIEW_KEY);

  return { clientId, userId, territories, roles, periodKey, scopeHash, scopeKey, cachePath };
}


function containsOnlyUserScopeSentinel(territories: string[] = []) {
  return territories.length > 0 && territories.every((territory) => territory.startsWith('user:'));
}

function hasZeroMetrics(metrics: DashboardSummary['metrics'] | undefined) {
  return Boolean(metrics)
    && (metrics?.targetCalls ?? null) === 0
    && (metrics?.actualCalls ?? null) === 0
    && (metrics?.doctorsReached ?? null) === 0
    && (metrics?.doctorsPlanned ?? null) === 0;
}

function hasZeroActivityOverview(activityOverview: DashboardActivityOverview | null | undefined) {
  const points = activityOverview?.points ?? [];
  return points.length > 0 && points.every((point) => point.targetCalls === 0 && point.actualCalls === 0);
}

function viewCachePathFor(clientId: string, scopeHash: string, viewKey: string) {
  return `iDoXs_Clients/${clientId}/scopeCaches/${scopeHash}/viewCaches/${viewKey}`;
}

export function viewCachePath(scope: DashboardScope, viewKey: string) {
  return viewCachePathFor(scope.clientId, scope.scopeHash, viewKey);
}

export const DASHBOARD_VIEW_KEYS = {
  summary: DASHBOARD_SUMMARY_VIEW_KEY,
  activityOverview: DASHBOARD_ACTIVITY_OVERVIEW_VIEW_KEY,
} as const;


export async function readFreshDashboardCache(scope: DashboardScope): Promise<DashboardCacheDocument | null> {
  const snapshot = await getAdminFirestore().doc(scope.cachePath).get();
  if (!snapshot.exists) return null;

  const data = snapshot.data() as (DashboardCacheDocument & {
    stale?: boolean;
    staleReason?: string | null;
    staleDetectedAt?: string | null;
    cache?: DashboardCacheDocument['cache'] & { stale?: boolean; staleReason?: string | null; staleDetectedAt?: string | null };
  }) | undefined;
  if (!data) return null;
  if (data.stale || data.cache?.stale) return null;
  if (!data.expiresAt || Date.parse(data.expiresAt) <= Date.now()) return null;
  if (containsOnlyUserScopeSentinel(data.scopeDefinition?.territories ?? []) && hasZeroMetrics(data.metrics)) return null;

  const { callMap: _legacyCallMap, activityOverview: _legacyActivityOverview, ...summaryOnlyData } = data as DashboardCacheDocument & { callMap?: unknown; activityOverview?: unknown };

  return {
    ...summaryOnlyData,
    cache: {
      ...(data.cache ?? {
        cachePath: scope.cachePath,
        scopeHash: scope.scopeHash,
        scopeKey: scope.scopeKey,
        viewKey: DASHBOARD_SUMMARY_VIEW_KEY,
        periodKey: scope.periodKey,
        businessRulesVersion: BUSINESS_RULES_VERSION,
        generatedAt: data.generatedAt,
        expiresAt: data.expiresAt,
        source: 'firestore-cache' as const,
      }),
      source: 'firestore-cache' as const,
    },
  };
}


export type DashboardActivityOverviewCacheDocument = {
  ok: boolean;
  clientSlug?: string | null;
  activityOverview: DashboardActivityOverview | null;
  message?: string;
  viewKey: string;
  scopeHash: string;
  scopeKey: string;
  scopeDefinition: {
    clientId: string;
    userId?: string;
    territories: string[];
    roles: string[];
  };
  periodKey: string;
  businessRulesVersion: string;
  generatedAt: string;
  expiresAt: string;
  stale?: boolean;
  staleReason?: string | null;
  staleDetectedAt?: string | null;
  cache: {
    cachePath: string;
    scopeHash: string;
    scopeKey: string;
    viewKey: string;
    periodKey: string;
    businessRulesVersion: string;
    generatedAt: string;
    expiresAt: string;
    source: 'firestore-cache' | 'mssql-refresh' | 'api-fallback';
    stale?: boolean;
    staleReason?: string | null;
    staleDetectedAt?: string | null;
  };
};

export async function readFreshDashboardActivityOverviewCache(scope: DashboardScope): Promise<DashboardActivityOverviewCacheDocument | null> {
  const cachePath = viewCachePath(scope, DASHBOARD_ACTIVITY_OVERVIEW_VIEW_KEY);
  const snapshot = await getAdminFirestore().doc(cachePath).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as (DashboardActivityOverviewCacheDocument & { cache?: DashboardActivityOverviewCacheDocument['cache'] }) | undefined;
  if (!data) return null;
  if (data.stale || data.cache?.stale) return null;
  if (!data.expiresAt || Date.parse(data.expiresAt) <= Date.now()) return null;
  if (containsOnlyUserScopeSentinel(data.scopeDefinition?.territories ?? []) && hasZeroActivityOverview(data.activityOverview)) return null;
  return {
    ...data,
    cache: {
      ...(data.cache ?? {
        cachePath,
        scopeHash: scope.scopeHash,
        scopeKey: scope.scopeKey,
        viewKey: DASHBOARD_ACTIVITY_OVERVIEW_VIEW_KEY,
        periodKey: scope.periodKey,
        businessRulesVersion: BUSINESS_RULES_VERSION,
        generatedAt: data.generatedAt,
        expiresAt: data.expiresAt,
        source: 'firestore-cache' as const,
      }),
      source: 'firestore-cache' as const,
    },
  };
}

export async function writeDashboardActivityOverviewCache(result: { ok: boolean; clientSlug?: string | null; activityOverview?: DashboardActivityOverview | null; message?: string }, scope: DashboardScope): Promise<DashboardActivityOverviewCacheDocument> {
  const generatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  const cachePath = viewCachePath(scope, DASHBOARD_ACTIVITY_OVERVIEW_VIEW_KEY);
  const doc: DashboardActivityOverviewCacheDocument = {
    ok: result.ok,
    clientSlug: result.clientSlug ?? scope.clientId,
    activityOverview: result.activityOverview ?? null,
    message: result.message,
    viewKey: DASHBOARD_ACTIVITY_OVERVIEW_VIEW_KEY,
    scopeHash: scope.scopeHash,
    scopeKey: scope.scopeKey,
    scopeDefinition: {
      clientId: scope.clientId,
      userId: scope.userId,
      territories: scope.territories,
      roles: scope.roles,
    },
    periodKey: scope.periodKey,
    businessRulesVersion: BUSINESS_RULES_VERSION,
    generatedAt,
    expiresAt,
    stale: false,
    staleReason: null,
    staleDetectedAt: null,
    cache: {
      cachePath,
      scopeHash: scope.scopeHash,
      scopeKey: scope.scopeKey,
      viewKey: DASHBOARD_ACTIVITY_OVERVIEW_VIEW_KEY,
      periodKey: scope.periodKey,
      businessRulesVersion: BUSINESS_RULES_VERSION,
      generatedAt,
      expiresAt,
      source: 'mssql-refresh',
      stale: false,
      staleReason: null,
      staleDetectedAt: null,
    },
  };
  const sanitizedDoc = toFirestoreJson(doc);
  await getAdminFirestore().doc(cachePath).set(sanitizedDoc);
  return sanitizedDoc;
}

export async function writeDashboardCache(summary: DashboardSummary, scope: DashboardScope, options: { sourceWatermark?: string | null } = {}): Promise<DashboardCacheDocument> {
    const generatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  const doc: DashboardCacheDocument = {
    ...summary,
    ok: summary.ok,
    clientSlug: scope.clientId,
    viewKey: DASHBOARD_SUMMARY_VIEW_KEY,
    scopeHash: scope.scopeHash,
    scopeKey: scope.scopeKey,
    scopeDefinition: {
      clientId: scope.clientId,
      userId: scope.userId,
      territories: scope.territories,
      roles: scope.roles,
    },
    periodKey: scope.periodKey,
    businessRulesVersion: BUSINESS_RULES_VERSION,
    generatedAt,
    expiresAt,
    sourceWatermark: options.sourceWatermark ?? null,
    stale: false,
    staleReason: null,
    staleDetectedAt: null,
    cache: {
      cachePath: scope.cachePath,
      scopeHash: scope.scopeHash,
      scopeKey: scope.scopeKey,
      viewKey: DASHBOARD_SUMMARY_VIEW_KEY,
      periodKey: scope.periodKey,
      businessRulesVersion: BUSINESS_RULES_VERSION,
      generatedAt,
      expiresAt,
      source: 'mssql-refresh',
      stale: false,
      staleReason: null,
      staleDetectedAt: null,
    },
  };

  const sanitizedDoc = toFirestoreJson(doc);
  await getAdminFirestore().doc(scope.cachePath).set(sanitizedDoc);
  return sanitizedDoc;
}
