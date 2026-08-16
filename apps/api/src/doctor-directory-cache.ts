import crypto from 'node:crypto';
import type { DoctorDirectoryResponse, DoctorDirectoryRow } from '@doxs/shared';
import { getAdminFirestore } from './firestore-admin.js';
import { listDoctors } from './doctor-directory.js';

const MSSQL_PAGE_SIZE = 100;
const CACHE_TTL_MS = Number(process.env.DOCTOR_DIRECTORY_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000);

type Totals = NonNullable<DoctorDirectoryResponse['totals']>;
type StoredWeekSummary = {
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  total: number;
};
type StoredCacheDocument = {
  territory: {
    id: string;
    summaries: {
      doctorCount: number;
      grandTotal: number;
      weeks: Record<string, StoredWeekSummary>;
    };
  };
  doctors: DoctorDirectoryRow[];
  generatedAt: string;
  expiresAt: string;
};

function pathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
}

function directoryPath(clientSlug: string | null, territoryId: string) {
  return `iDoXs_Clients/${pathSegment(clientSlug || 'default')}/doctorDirectory/${pathSegment(territoryId)}`;
}

function totalsFor(rows: DoctorDirectoryRow[]): Totals {
  const byWeekDay = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]);
  let grandTotal = 0;
  for (const row of rows) {
    row.visitDays.forEach((day, weekIndex) => {
      if (day && day >= 1 && day <= 5) {
        byWeekDay[weekIndex][day - 1] += 1;
        grandTotal += 1;
      }
    });
  }
  return { byWeekDay, byWeek: byWeekDay.map((days) => days.reduce((sum, count) => sum + count, 0)), grandTotal, doctorCount: rows.length };
}

function storeSummaries(totals: Totals): StoredCacheDocument['territory']['summaries'] {
  const weeks = Object.fromEntries(totals.byWeekDay.map((days, index) => [`week${index + 1}`, {
    monday: days[0] ?? 0,
    tuesday: days[1] ?? 0,
    wednesday: days[2] ?? 0,
    thursday: days[3] ?? 0,
    friday: days[4] ?? 0,
    total: totals.byWeek[index] ?? 0,
  }]));
  return { doctorCount: totals.doctorCount, grandTotal: totals.grandTotal, weeks };
}

function restoreTotals(summaries: StoredCacheDocument['territory']['summaries']): Totals | null {
  if (!summaries?.weeks) return null;
  const byWeekDay = Array.from({ length: 5 }, (_, index) => {
    const week = summaries.weeks[`week${index + 1}`];
    return week ? [week.monday, week.tuesday, week.wednesday, week.thursday, week.friday].map((value) => Number(value ?? 0)) : [0, 0, 0, 0, 0];
  });
  return {
    byWeekDay,
    byWeek: byWeekDay.map((days) => days.reduce((sum, count) => sum + count, 0)),
    grandTotal: Number(summaries.grandTotal ?? 0),
    doctorCount: Number(summaries.doctorCount ?? 0),
  };
}

async function readCachedRows(clientSlug: string | null, territoryId: string) {
  const snapshot = await getAdminFirestore().doc(directoryPath(clientSlug, territoryId)).get();
  if (!snapshot.exists) return null;
  const doc = snapshot.data() as StoredCacheDocument;
  if (!doc.expiresAt || Date.parse(doc.expiresAt) <= Date.now() || !Array.isArray(doc.doctors)) return null;
  const totals = restoreTotals(doc.territory?.summaries);
  if (!totals) return null;
  return { rows: doc.doctors, totals, generatedAt: doc.generatedAt };
}

async function loadRowsFromMssql(clientSlug: string | null, territoryId: string) {
  const rows: DoctorDirectoryRow[] = [];
  let cursor: string | undefined;
  do {
    const result = await listDoctors(clientSlug, [territoryId], { territory: territoryId, limit: MSSQL_PAGE_SIZE, cursor });
    rows.push(...result.doctors);
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  return rows;
}

async function removeLegacyPages(path: string) {
  const db = getAdminFirestore();
  const refs = await db.collection(`${path}/pages`).listDocuments();
  for (let offset = 0; offset < refs.length; offset += 500) {
    const batch = db.batch();
    refs.slice(offset, offset + 500).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

async function writeCache(clientSlug: string | null, territoryId: string, rows: DoctorDirectoryRow[]) {
  const db = getAdminFirestore();
  const path = directoryPath(clientSlug, territoryId);
  const generatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  const totals = totalsFor(rows);
  const doc: StoredCacheDocument = {
    territory: { id: territoryId, summaries: storeSummaries(totals) },
    doctors: rows,
    generatedAt,
    expiresAt,
  };
  await db.doc(path).set(doc);
  await removeLegacyPages(path);
  return { rows, totals, generatedAt };
}

function cursorFor(offset: number, letter: string, search: string) {
  const checksum = crypto.createHash('sha1').update(`${letter}|${search}`).digest('hex').slice(0, 10);
  return Buffer.from(JSON.stringify({ offset, checksum })).toString('base64url');
}

function cursorOffset(cursor: string | undefined, letter: string, search: string) {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: number; checksum?: string };
    const checksum = crypto.createHash('sha1').update(`${letter}|${search}`).digest('hex').slice(0, 10);
    return value.checksum === checksum && Number.isInteger(value.offset) && Number(value.offset) >= 0 ? Number(value.offset) : 0;
  } catch {
    return 0;
  }
}

export async function getDoctorTerritoryDirectory(clientSlug: string | null, territoryId: string, query: { letter?: string; search?: string; cursor?: string; limit: number }): Promise<DoctorDirectoryResponse> {
  let cached = await readCachedRows(clientSlug, territoryId);
  let source: DoctorDirectoryResponse['source'] = 'firestore-cache';
  if (!cached) {
    source = 'mssql';
    cached = await writeCache(clientSlug, territoryId, await loadRowsFromMssql(clientSlug, territoryId));
  }

  const letter = (query.letter ?? '').toUpperCase();
  const search = (query.search ?? '').toUpperCase();
  const filtered = cached.rows.filter((row) => {
    if (letter && !row.lastName.toUpperCase().startsWith(letter)) return false;
    if (!search) return true;
    return row.lastName.toUpperCase().startsWith(search) || row.firstName.toUpperCase().startsWith(search) || row.doctorId.toUpperCase().startsWith(search);
  });
  const offset = cursorOffset(query.cursor, letter, search);
  const doctors = filtered.slice(offset, offset + query.limit);
  const nextOffset = offset + doctors.length;
  const hasMore = nextOffset < filtered.length;
  return {
    ok: true,
    doctors,
    nextCursor: hasMore ? cursorFor(nextOffset, letter, search) : null,
    hasMore,
    generatedAt: cached.generatedAt,
    source,
    territoryCount: 1,
    territoryId,
    totals: cached.totals,
  };
}
