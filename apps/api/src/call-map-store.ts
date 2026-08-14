import type { DashboardCallMap, DashboardCallMapDay, DashboardCallMapSequence } from '@doxs/shared';
import { getAdminFirestore } from './firestore-admin.js';
import { getDashboardCallMap } from './mssql-dashboard.js';

const CALL_MAP_TTL_MS = Number(process.env.DASHBOARD_CALL_MAP_TTL_MS ?? 5 * 60 * 1000);
const BUSINESS_RULES_VERSION = '1';

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
}

type FirestoreSequence = Omit<DashboardCallMapSequence, 'coordinates'> & {
  coordinates: Array<{ longitude: number; latitude: number }>;
};

type FirestoreDay = Omit<DashboardCallMapDay, 'sequences'> & {
  sequences: FirestoreSequence[];
};

export type CallMapTerritoryDateDocument = {
  ok: boolean;
  clientSlug: string;
  territoryId: string;
  date: string;
  cycle: DashboardCallMap['cycle'];
  day: DashboardCallMapDay;
  generatedAt: string;
  expiresAt: string;
  businessRulesVersion: string;
  source: 'firestore-cache' | 'mssql-refresh';
  cachePath: string;
};

function encodeDay(day: DashboardCallMapDay): FirestoreDay {
  return {
    ...day,
    sequences: day.sequences.map((sequence) => ({
      ...sequence,
      coordinates: sequence.coordinates.map(([longitude, latitude]) => ({ longitude, latitude })),
    })),
  };
}

function decodeDay(day: unknown): DashboardCallMapDay | null {
  if (!day || typeof day !== 'object') return null;
  const raw = day as FirestoreDay;
  return {
    ...raw,
    sequences: (raw.sequences ?? []).map((sequence) => ({
      ...sequence,
      coordinates: sequence.coordinates.map((coordinate) => {
        if (Array.isArray(coordinate)) return coordinate as unknown as [number, number];
        return [coordinate.longitude, coordinate.latitude] as [number, number];
      }),
    })),
  };
}

function callMapDatePath(clientSlug: string, territoryId: string, date: string) {
  const clientId = sanitizePathSegment(clientSlug || 'default');
  const territoryKey = sanitizePathSegment(territoryId || 'unknown');
  const dateKey = sanitizePathSegment(date || 'unknown');
  return `iDoXs_Clients/${clientId}/callMap/${territoryKey}/dates/${dateKey}`;
}

function firestoreSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeCachedDoc(data: FirebaseFirestore.DocumentData, cachePath: string): CallMapTerritoryDateDocument | null {
  const day = decodeDay(data.day);
  if (!day || !data.cycle) return null;
  return {
    ok: Boolean(data.ok),
    clientSlug: String(data.clientSlug ?? ''),
    territoryId: String(data.territoryId ?? ''),
    date: String(data.date ?? day.date),
    cycle: data.cycle as DashboardCallMap['cycle'],
    day,
    generatedAt: String(data.generatedAt ?? ''),
    expiresAt: String(data.expiresAt ?? ''),
    businessRulesVersion: String(data.businessRulesVersion ?? BUSINESS_RULES_VERSION),
    source: 'firestore-cache',
    cachePath,
  };
}

async function readFreshTerritoryDate(clientSlug: string, territoryId: string, date: string) {
  const cachePath = callMapDatePath(clientSlug, territoryId, date);
  const snapshot = await getAdminFirestore().doc(cachePath).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (!data?.expiresAt || Date.parse(String(data.expiresAt)) <= Date.now()) return null;
  return normalizeCachedDoc(data, cachePath);
}

async function writeTerritoryDate(clientSlug: string, territoryId: string, cycle: DashboardCallMap['cycle'], day: DashboardCallMapDay) {
  const generatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CALL_MAP_TTL_MS).toISOString();
  const cachePath = callMapDatePath(clientSlug, territoryId, day.date);
  const doc = firestoreSafe({
    ok: true,
    clientSlug,
    territoryId,
    date: day.date,
    cycle,
    day: encodeDay(day),
    generatedAt,
    expiresAt,
    businessRulesVersion: BUSINESS_RULES_VERSION,
    source: 'mssql-refresh' as const,
    cachePath,
  });
  await getAdminFirestore().doc(cachePath).set(doc);
  return {
    ...doc,
    day,
  } as CallMapTerritoryDateDocument;
}

function emptyTerritoryDay(date: string, territoryId: string): DashboardCallMapDay {
  return {
    date,
    territories: [{
      territoryId,
      color: '#2563eb',
      medRepName: null,
      territoryDescription: null,
      callCount: 0,
      gpsCallCount: 0,
      hasGpsCalls: false,
      faded: true,
      bounds: null,
    }],
    calls: [],
    nodes: [],
    sequences: [],
  };
}

export async function getCallMapTerritoryDate(clientSlug: string, territoryId: string, date: string): Promise<CallMapTerritoryDateDocument> {
  const cached = await readFreshTerritoryDate(clientSlug, territoryId, date);
  if (cached) return cached;

  const result = await getDashboardCallMap(clientSlug, [territoryId]);
  if (!result.ok || !result.callMap) {
    throw new Error(result.message ?? 'Call map is unavailable for this territory.');
  }

  const writes = await Promise.all(Object.values(result.callMap.days).map((day) => writeTerritoryDate(clientSlug, territoryId, result.callMap!.cycle, day)));
  const selected = writes.find((doc) => doc.date === date);
  if (selected) return selected;

  return writeTerritoryDate(clientSlug, territoryId, result.callMap.cycle, emptyTerritoryDay(date, territoryId));
}
