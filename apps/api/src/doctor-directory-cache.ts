import crypto from 'node:crypto';
import type { DoctorDirectoryResponse, DoctorDirectoryRow } from '@doxs/shared';
import { getAdminFirestore } from './firestore-admin.js';
import { listDoctors } from './doctor-directory.js';

const PAGE_SIZE = 100;
const CACHE_TTL_MS = Number(process.env.DOCTOR_DIRECTORY_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000);

type Totals = NonNullable<DoctorDirectoryResponse['totals']>;
type MetaDocument = {
  territoryId: string;
  doctorCount: number;
  pageCount: number;
  totals: Totals;
  generatedAt: string;
  expiresAt: string;
};

type StoredMetaDocument = Omit<MetaDocument, 'totals'> & {
  totals: Omit<Totals, 'byWeekDay'> & { byWeekDayFlat: number[] };
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

function storeMeta(meta: MetaDocument): StoredMetaDocument {
  const { byWeekDay, ...totals } = meta.totals;
  return { ...meta, totals: { ...totals, byWeekDayFlat: byWeekDay.flat() } };
}

function restoreMeta(meta: StoredMetaDocument): MetaDocument | null {
  const flat = meta.totals?.byWeekDayFlat;
  if (!Array.isArray(flat) || flat.length !== 25) return null;
  const byWeekDay = Array.from({ length: 5 }, (_, weekIndex) => flat.slice(weekIndex * 5, weekIndex * 5 + 5));
  const { byWeekDayFlat: _flat, ...totals } = meta.totals;
  return { ...meta, totals: { ...totals, byWeekDay } };
}

async function readCachedRows(clientSlug: string | null, territoryId: string) {
  const db = getAdminFirestore();
  const path = directoryPath(clientSlug, territoryId);
  const metaSnapshot = await db.doc(path).get();
  if (!metaSnapshot.exists) return null;
  const meta = restoreMeta(metaSnapshot.data() as StoredMetaDocument);
  if (!meta) return null;
  if (!meta.expiresAt || Date.parse(meta.expiresAt) <= Date.now()) return null;
  const pages = await Promise.all(Array.from({ length: meta.pageCount }, (_, index) => db.doc(`${path}/pages/${String(index + 1).padStart(4, '0')}`).get()));
  if (pages.some((page) => !page.exists)) return null;
  return { meta, rows: pages.flatMap((page) => (page.data()?.rows ?? []) as DoctorDirectoryRow[]) };
}

async function loadRowsFromMssql(clientSlug: string | null, territoryId: string) {
  const rows: DoctorDirectoryRow[] = [];
  let cursor: string | undefined;
  do {
    const result = await listDoctors(clientSlug, [territoryId], { territory: territoryId, limit: PAGE_SIZE, cursor });
    rows.push(...result.doctors);
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  return rows;
}

async function writeCache(clientSlug: string | null, territoryId: string, rows: DoctorDirectoryRow[]) {
  const db = getAdminFirestore();
  const path = directoryPath(clientSlug, territoryId);
  const generatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  const pageCount = Math.ceil(rows.length / PAGE_SIZE);
  await Promise.all(Array.from({ length: pageCount }, (_, index) => db.doc(`${path}/pages/${String(index + 1).padStart(4, '0')}`).set({
    territoryId,
    page: index + 1,
    rows: rows.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE),
    generatedAt,
  })));
  const meta: MetaDocument = { territoryId, doctorCount: rows.length, pageCount, totals: totalsFor(rows), generatedAt, expiresAt };
  await db.doc(path).set(storeMeta(meta));
  return meta;
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
    const rows = await loadRowsFromMssql(clientSlug, territoryId);
    const meta = await writeCache(clientSlug, territoryId, rows);
    cached = { rows, meta };
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
    generatedAt: cached.meta.generatedAt,
    source,
    territoryCount: 1,
    territoryId,
    totals: cached.meta.totals,
  };
}
