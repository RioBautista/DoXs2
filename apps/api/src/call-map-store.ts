import type { DashboardCallMap, DashboardCallMapDay, DashboardCallMapSequence } from '@doxs/shared';
import { getAdminFirestore } from './firestore-admin.js';
import { getDashboardCallMap } from './mssql-dashboard.js';

const CALL_MAP_TTL_MS = Number(process.env.DASHBOARD_CALL_MAP_TTL_MS ?? 24 * 60 * 60 * 1000);
const CALL_MAP_TODAY_TTL_MS = Number(process.env.DASHBOARD_CALL_MAP_TODAY_TTL_MS ?? 5 * 60 * 1000);
const BUSINESS_RULES_VERSION = '1';

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
}

function manilaToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

function isCurrentManilaDate(date: string) {
  return date === manilaToday();
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

function isZeroGps(latitude: unknown, longitude: unknown) {
  return Number(latitude) === 0 && Number(longitude) === 0;
}

function sanitizeZeroGpsDay(day: DashboardCallMapDay): DashboardCallMapDay {
  const calls = (day.calls ?? []).map((call) => {
    if (!isZeroGps(call.latitude, call.longitude) && !isZeroGps(call.displayLatitude, call.displayLongitude)) return call;
    return {
      ...call,
      latitude: isZeroGps(call.latitude, call.longitude) ? null : call.latitude,
      longitude: isZeroGps(call.latitude, call.longitude) ? null : call.longitude,
      displayLatitude: isZeroGps(call.displayLatitude, call.displayLongitude) ? null : call.displayLatitude,
      displayLongitude: isZeroGps(call.displayLatitude, call.displayLongitude) ? null : call.displayLongitude,
      gpsStatus: 'missing' as const,
      nodeId: null,
    };
  });

  const nodes = (day.nodes ?? []).filter((node) => !isZeroGps(node.latitude, node.longitude));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const normalizedCalls = calls.map((call) => call.nodeId && !nodeIds.has(call.nodeId) ? { ...call, nodeId: null } : call);
  const sequences = (day.sequences ?? [])
    .map((sequence) => ({
      ...sequence,
      coordinates: sequence.coordinates.filter(([longitude, latitude]) => !isZeroGps(latitude, longitude)),
    }))
    .filter((sequence) => sequence.coordinates.length > 1);

  const territories = (day.territories ?? []).map((territory) => {
    const territoryNodes = nodes.filter((node) => node.territoryId === territory.territoryId);
    const lngs = territoryNodes.map((node) => node.longitude);
    const lats = territoryNodes.map((node) => node.latitude);
    return {
      ...territory,
      gpsCallCount: normalizedCalls.filter((call) => call.territoryId === territory.territoryId && call.gpsStatus === 'actual' && call.latitude !== null && call.longitude !== null).length,
      hasGpsCalls: territoryNodes.length > 0,
      faded: territoryNodes.length === 0,
      bounds: territoryNodes.length ? [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)] as [number, number, number, number] : null,
    };
  });

  return { ...day, calls: normalizedCalls, nodes, sequences, territories };
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
  const sanitizedDay = sanitizeZeroGpsDay(day);
  return {
    ok: Boolean(data.ok),
    clientSlug: String(data.clientSlug ?? ''),
    territoryId: String(data.territoryId ?? ''),
    date: String(data.date ?? sanitizedDay.date),
    cycle: data.cycle as DashboardCallMap['cycle'],
    day: sanitizedDay,
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
  if (!data?.expiresAt) return null;
  if (isCurrentManilaDate(date) && Date.parse(String(data.expiresAt)) <= Date.now()) return null;
  return normalizeCachedDoc(data, cachePath);
}

async function writeTerritoryDate(clientSlug: string, territoryId: string, cycle: DashboardCallMap['cycle'], day: DashboardCallMapDay) {
  const generatedAt = new Date().toISOString();
  const ttlMs = isCurrentManilaDate(day.date) ? CALL_MAP_TODAY_TTL_MS : CALL_MAP_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
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

  const result = await getDashboardCallMap(clientSlug, [territoryId], date);
  if (!result.ok || !result.callMap) {
    throw new Error(result.message ?? 'Call map is unavailable for this territory.');
  }

  const selectedDay = result.callMap.days[date];
  if (selectedDay) return writeTerritoryDate(clientSlug, territoryId, result.callMap.cycle, selectedDay);

  return writeTerritoryDate(clientSlug, territoryId, result.callMap.cycle, emptyTerritoryDay(date, territoryId));
}
