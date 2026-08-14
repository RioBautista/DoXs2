import crypto from 'node:crypto';
import type { DashboardCacheDocument, DashboardSummary } from '@doxs/shared';
import { getAdminFirestore } from './firestore-admin.js';
import type { SessionPayload } from './session.js';

const VIEW_KEY = 'dashboardSummary';
const BUSINESS_RULES_VERSION = '1';
const CACHE_TTL_MS = Number(process.env.DASHBOARD_CACHE_TTL_MS ?? 5 * 60 * 1000);

function stableHash(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
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
  const cachePath = `iDoXs_Clients/${clientId}/scopeCaches/${scopeHash}/viewCaches/${VIEW_KEY}`;

  return { clientId, userId, territories, roles, periodKey, scopeHash, scopeKey, cachePath };
}

export async function writeDashboardCache(summary: DashboardSummary, scope: DashboardScope, options: { sourceWatermark?: string | null } = {}): Promise<DashboardCacheDocument> {
  const generatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  const doc: DashboardCacheDocument = {
    ...summary,
    ok: summary.ok,
    clientSlug: scope.clientId,
    viewKey: VIEW_KEY,
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
      viewKey: VIEW_KEY,
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

  await getAdminFirestore().doc(scope.cachePath).set(doc, { merge: true });
  return doc;
}
