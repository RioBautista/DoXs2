import { createHash } from 'node:crypto';
import { FieldValue, WriteBatch } from 'firebase-admin/firestore';
import { getAdminFirestore } from './firestore-admin.js';
import { getClientUserTerritories, listClientUserTerritoryAssignments } from './mssql-dashboard.js';

function safePathSegment(value: string | null | undefined, fallback = 'unknown') {
  return String(value || fallback).replace(/[^a-zA-Z0-9_-]/g, '_') || fallback;
}

function normalizeUserId(userId: string) {
  return userId.trim();
}

function normalizeTerritories(territories: string[] = []) {
  return [...new Set(territories.map((territory) => territory.trim()).filter(Boolean))].sort();
}

function hashTerritories(territories: string[]) {
  return createHash('sha1').update(JSON.stringify(territories)).digest('hex');
}

function userTerritoryDocPath(clientSlug: string | null | undefined, userId: string) {
  return `iDoXs_Clients/${safePathSegment((clientSlug ?? 'default').toLowerCase())}/userTerritories/${safePathSegment(userId)}`;
}

async function commitBatch(batch: WriteBatch, writes: number) {
  if (writes > 0) await batch.commit();
}

export async function readUserTerritoriesReplica(clientSlug: string | null | undefined, userId: string) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;
  const path = userTerritoryDocPath(clientSlug, normalizedUserId);
  const snap = await getAdminFirestore().doc(path).get();
  const data = snap.data() as { territories?: string[]; disabled?: boolean } | undefined;
  if (!snap.exists || data?.disabled || !Array.isArray(data?.territories)) return null;
  return { territories: normalizeTerritories(data.territories), source: 'firestore-replica' as const, cachePath: path };
}

export async function getUserTerritoriesFirestoreFirst(clientSlug: string | null | undefined, userId: string) {
  const replica = await readUserTerritoriesReplica(clientSlug, userId);
  if (replica) return replica;

  const territories = normalizeTerritories(await getClientUserTerritories(clientSlug, userId));
  await upsertUserTerritoriesReplica(clientSlug, userId, territories, 'lazy-mssql-seed');
  return { territories, source: 'mssql-fallback' as const, cachePath: userTerritoryDocPath(clientSlug, userId) };
}

export async function upsertUserTerritoriesReplica(clientSlug: string | null | undefined, userId: string, territories: string[], source = 'mssql-replica') {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return false;
  const normalizedTerritories = normalizeTerritories(territories);
  const territoryHash = hashTerritories(normalizedTerritories);
  const ref = getAdminFirestore().doc(userTerritoryDocPath(clientSlug, normalizedUserId));
  const existing = await ref.get();
  const existingHash = (existing.data() as { territoryHash?: string } | undefined)?.territoryHash;
  if (existing.exists && existingHash === territoryHash) {
    await ref.set({ lastSeenAt: FieldValue.serverTimestamp(), source }, { merge: true });
    return false;
  }
  await ref.set({
    clientId: safePathSegment((clientSlug ?? 'default').toLowerCase()),
    userId: normalizedUserId,
    territories: normalizedTerritories,
    territoryCount: normalizedTerritories.length,
    territoryHash,
    disabled: false,
    source,
    cachePath: ref.path,
    replicatedAt: FieldValue.serverTimestamp(),
    lastSeenAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return true;
}

export async function replicateUserTerritoriesForClient(clientSlug: string) {
  const db = getAdminFirestore();
  const clientId = safePathSegment(clientSlug.toLowerCase());
  const assignments = await listClientUserTerritoryAssignments(clientSlug);
  const byUser = new Map<string, string[]>();

  for (const assignment of assignments) {
    const userId = normalizeUserId(assignment.userId);
    const territoryId = assignment.territoryId.trim();
    if (!userId || !territoryId) continue;
    const territories = byUser.get(userId) ?? [];
    territories.push(territoryId);
    byUser.set(userId, territories);
  }

  let usersSeen = 0;
  let updatedUsers = 0;
  let disabledUsers = 0;
  let writes = 0;
  let batch = db.batch();
  const seenUserDocIds = new Set<string>();

  for (const [userId, territories] of byUser.entries()) {
    const normalizedTerritories = normalizeTerritories(territories);
    const territoryHash = hashTerritories(normalizedTerritories);
    const ref = db.doc(userTerritoryDocPath(clientSlug, userId));
    seenUserDocIds.add(ref.id);
    usersSeen += 1;

    const existing = await ref.get();
    const existingHash = (existing.data() as { territoryHash?: string } | undefined)?.territoryHash;
    if (existing.exists && existingHash === territoryHash) {
      batch.set(ref, { lastSeenAt: FieldValue.serverTimestamp(), source: 'mssql-replica' }, { merge: true });
    } else {
      batch.set(ref, {
        clientId,
        userId,
        territories: normalizedTerritories,
        territoryCount: normalizedTerritories.length,
        territoryHash,
        disabled: false,
        source: 'mssql-replica',
        cachePath: ref.path,
        replicatedAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      updatedUsers += 1;
    }
    writes += 1;
    if (writes >= 450) {
      await commitBatch(batch, writes);
      batch = db.batch();
      writes = 0;
    }
  }

  const existingDocs = await db.collection(`iDoXs_Clients/${clientId}/userTerritories`).listDocuments();
  for (const ref of existingDocs) {
    if (seenUserDocIds.has(ref.id)) continue;
    const snap = await ref.get();
    const data = snap.data() as { preserveOnReplicaSync?: boolean } | undefined;
    if (data?.preserveOnReplicaSync) {
      batch.set(ref, {
        lastSeenAt: FieldValue.serverTimestamp(),
        preservedAt: FieldValue.serverTimestamp(),
        preservedReason: 'manual-admin-scope',
      }, { merge: true });
      writes += 1;
      if (writes >= 450) {
        await commitBatch(batch, writes);
        batch = db.batch();
        writes = 0;
      }
      continue;
    }
    batch.set(ref, {
      disabled: true,
      territories: [],
      territoryCount: 0,
      source: 'mssql-replica',
      disabledAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    disabledUsers += 1;
    writes += 1;
    if (writes >= 450) {
      await commitBatch(batch, writes);
      batch = db.batch();
      writes = 0;
    }
  }

  await commitBatch(batch, writes);
  return { clientId, assignmentCount: assignments.length, usersSeen, updatedUsers, disabledUsers };
}


export function configuredUserTerritoryReplicaClients() {
  return (process.env.USER_TERRITORY_REPLICA_CLIENTS ?? process.env.DASHBOARD_CACHE_WATCH_CLIENTS ?? 'wert,oxford,demo')
    .split(',')
    .map((client) => client.trim().toLowerCase())
    .filter(Boolean);
}

export async function runUserTerritoryReplicaRefresh(logger?: { info?: (obj: unknown, msg?: string) => void; warn?: (obj: unknown, msg?: string) => void }) {
  const clients = configuredUserTerritoryReplicaClients();
  const results = [] as Awaited<ReturnType<typeof replicateUserTerritoriesForClient>>[];
  logger?.info?.({ clients }, 'User territory replica refresh started.');
  for (const clientId of clients) {
    try {
      const result = await replicateUserTerritoriesForClient(clientId);
      results.push(result);
      logger?.info?.({ result }, 'User territory replica client refresh completed.');
    } catch (error) {
      logger?.warn?.({ error, clientId }, 'User territory replica client refresh failed.');
      results.push({ clientId, assignmentCount: 0, usersSeen: 0, updatedUsers: 0, disabledUsers: 0 });
    }
  }
  return { clients, results };
}
