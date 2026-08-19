import crypto from 'node:crypto';
import type { ReportColumnDefinition, ReportDefinitionSummary, ReportFilterDefinition, ReportRunResult } from '@doxs/shared';
import sql from 'mssql';
import { z } from 'zod';
import { getAdminFirestore } from './firestore-admin.js';
import { connectClientMSSQL, getClientMSSQLConfig } from './mssql-dashboard.js';

type SessionContext = {
  username: string;
  roles: string[];
  clientSlug: string | null;
  territories: string[];
};

const filterSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string().min(1),
  type: z.enum(['date', 'text', 'number', 'boolean', 'select']),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
});

const columnSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'number', 'date', 'datetime', 'boolean']).optional(),
  align: z.enum(['left', 'right', 'center']).optional(),
  format: z.string().optional(),
});

const reportDefinitionSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  clientSlugs: z.array(z.string()).optional(),
  allowedRoles: z.array(z.string()).optional(),
  outputs: z.array(z.enum(['html', 'csv', 'xlsx', 'pdf'])).default(['html', 'csv']),
  filters: z.array(filterSchema).default([]),
  columns: z.array(columnSchema).default([]),
  source: z.object({
    type: z.literal('mssql'),
    sql: z.string().min(1),
    maxRows: z.number().int().positive().max(10_000).default(500),
    territoryScope: z.object({
      mode: z.enum(['none', 'optional', 'required']).default('optional'),
      predicateToken: z.string().optional(),
    }).optional(),
  }),
});

type ReportDefinition = z.infer<typeof reportDefinitionSchema> & { id: string };

const REPORTS_COLLECTION = process.env.REPORTS_COLLECTION || 'reportDefinitions';
const REPORT_RESULT_CACHE_COLLECTION = process.env.REPORT_RESULT_CACHE_COLLECTION || 'reportResultCache';
const REPORT_RESULT_CACHE_TTL_MS = Number(process.env.REPORT_RESULT_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000);

type ParsedFilterValues = Record<string, string | number | boolean | null>;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function reportCachePath(report: ReportDefinition, session: SessionContext, filters: ParsedFilterValues) {
  const clientSlug = normalized(session.clientSlug) || 'default';
  const hash = crypto.createHash('sha256').update(stableStringify({
    reportId: report.id,
    sql: report.source.sql,
    maxRows: report.source.maxRows,
    clientSlug,
    filters,
    territories: session.territories.map((territory) => territory.trim()).filter(Boolean).sort(),
  })).digest('hex').slice(0, 48);
  return `${REPORT_RESULT_CACHE_COLLECTION}/${clientSlug}__${report.id}__${hash}`;
}

async function readFreshReportResultCache(cachePath: string): Promise<ReportRunResult | null> {
  const snapshot = await getAdminFirestore().doc(cachePath).get();
  const data = snapshot.data() as (ReportRunResult & { cache?: ReportRunResult['cache'] }) | undefined;
  if (!data?.ok || !data.cache?.expiresAt || Date.parse(data.cache.expiresAt) <= Date.now()) return null;
  return {
    ...data,
    cache: {
      ...data.cache,
      source: 'firestore-cache',
      cachePath,
    },
  };
}

function decodeLegacyBase64Text(value: string) {
  if (!value.startsWith('b64:')) return value;
  try {
    const bytes = Buffer.from(value.slice(4), 'base64');
    if (!bytes.length) return '';
    const tryUtf32 = (read: (offset: number) => number) => {
      let decoded = '';
      for (let offset = 0; offset + 3 < bytes.length; offset += 4) {
        const codePoint = read(offset);
        if (codePoint === 0) continue;
        if (codePoint > 0x10ffff) return null;
        decoded += String.fromCodePoint(codePoint);
      }
      return decoded;
    };
    const candidates = [
      tryUtf32((offset) => bytes.readUInt32BE(offset)),
      tryUtf32((offset) => bytes.readUInt32LE(offset)),
      bytes.toString('utf8'),
    ].filter((candidate): candidate is string => Boolean(candidate));
    const printable = candidates.find((candidate) => {
      const trimmed = candidate.replace(/[\r\n\t]/g, '').trim();
      if (!trimmed) return false;
      const printableCount = [...trimmed].filter((char) => char >= ' ' && char !== '�').length;
      return printableCount / Math.max(trimmed.length, 1) > 0.85;
    });
    return printable ?? value;
  } catch {
    return value;
  }
}

function normalizeReportValue(value: unknown) {
  if (typeof value !== 'string') return value;
  return decodeLegacyBase64Text(value).replace(/Â|Â/g, "'");
}

function stripInternalSortFields(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row)
    .filter(([key]) => !key.startsWith('__sort_'))
    .map(([key, value]) => [key, normalizeReportValue(value)]));
}

async function writeReportResultCache(cachePath: string, result: Omit<ReportRunResult, 'cache'>) {
  const generatedAt = result.generatedAt ?? new Date().toISOString();
  const expiresAt = new Date(Date.now() + REPORT_RESULT_CACHE_TTL_MS).toISOString();
  const cached: ReportRunResult = {
    ...result,
    generatedAt,
    cache: {
      source: 'mssql-refresh',
      cachePath,
      generatedAt,
      expiresAt,
    },
  };
  await getAdminFirestore().doc(cachePath).set(JSON.parse(JSON.stringify(cached)));
  return cached;
}

function toSummary(report: ReportDefinition): ReportDefinitionSummary {
  return {
    id: report.id,
    title: report.title,
    description: report.description ?? null,
    category: report.category ?? null,
    clientSlugs: report.clientSlugs ?? [],
    filters: report.filters as ReportFilterDefinition[],
    columns: report.columns as ReportColumnDefinition[],
    outputs: report.outputs,
  };
}

function normalized(value?: string | null) {
  return String(value ?? '').trim().toLowerCase();
}

function effectiveRoles(session: SessionContext) {
  const roles = new Set(session.roles.map(normalized).filter(Boolean));
  if (!roles.size) roles.add('medical representative');
  if (roles.has('pilot-user') || roles.has('territory-user')) roles.add('medical representative');
  if (roles.has('admin') || roles.has('doxs-admin') || roles.has('doccs-admin')) roles.add('doccs admin');
  return [...roles];
}

function canAccessReport(report: ReportDefinition, session: SessionContext) {
  const clientSlugs = (report.clientSlugs ?? []).map(normalized).filter(Boolean);
  if (clientSlugs.length && !clientSlugs.includes(normalized(session.clientSlug))) return false;

  const allowedRoles = (report.allowedRoles ?? []).map(normalized).filter(Boolean);
  if (!allowedRoles.length) return true;
  return effectiveRoles(session).some((role) => allowedRoles.includes(role));
}

async function loadReportDefinition(reportId: string): Promise<ReportDefinition | null> {
  const snapshot = await getAdminFirestore().collection(REPORTS_COLLECTION).doc(reportId).get();
  if (!snapshot.exists) return null;
  const parsed = reportDefinitionSchema.safeParse(snapshot.data());
  if (!parsed.success) {
    throw new Error(`Invalid report definition ${reportId}: ${parsed.error.issues[0]?.message ?? 'schema error'}`);
  }
  return { id: snapshot.id, ...parsed.data };
}

export async function listReportDefinitions(session: SessionContext) {
  const snapshot = await getAdminFirestore().collection(REPORTS_COLLECTION).get();
  const reports: ReportDefinitionSummary[] = [];
  for (const doc of snapshot.docs) {
    const parsed = reportDefinitionSchema.safeParse(doc.data());
    if (!parsed.success || parsed.data.status !== 'enabled') continue;
    const report = { id: doc.id, ...parsed.data };
    if (canAccessReport(report, session)) reports.push(toSummary(report));
  }
  return reports.sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.title.localeCompare(b.title));
}

function assertReadOnlySelect(query: string) {
  const stripped = query.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!stripped.startsWith('select') && !stripped.startsWith('with ')) throw new Error('Reports must use read-only SELECT queries.');
  if (/[;]/.test(query)) throw new Error('Report SQL cannot contain multiple statements.');
  if (/\b(insert|update|delete|merge|drop|alter|create|truncate|exec|execute|grant|revoke)\b/i.test(query)) {
    throw new Error('Report SQL contains a blocked keyword.');
  }
}

function parseFilterValue(filter: z.infer<typeof filterSchema>, rawValue: unknown) {
  const value = rawValue ?? filter.defaultValue;
  if ((value === undefined || value === null || value === '') && filter.required) {
    throw new Error(`Missing required filter: ${filter.label}`);
  }
  if (value === undefined || value === null || value === '') return null;

  if (filter.type === 'number') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`Invalid number for ${filter.label}.`);
    return parsed;
  }
  if (filter.type === 'boolean') return value === true || value === 'true' || value === '1';
  if (filter.type === 'date') {
    const text = String(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`Invalid date for ${filter.label}; use YYYY-MM-DD.`);
    return text;
  }
  if (filter.type === 'select' && filter.options?.length) {
    const text = String(value);
    if (!filter.options.some((option) => option.value === text)) throw new Error(`Invalid option for ${filter.label}.`);
    return text;
  }
  return String(value);
}

function bindFilter(request: sql.Request, filter: z.infer<typeof filterSchema>, value: unknown) {
  if (value === null) {
    request.input(filter.id, sql.NVarChar, null);
    return;
  }
  if (filter.type === 'number') request.input(filter.id, sql.Float, value);
  else if (filter.type === 'boolean') request.input(filter.id, sql.Bit, value);
  else if (filter.type === 'date') request.input(filter.id, sql.Date, value as string);
  else request.input(filter.id, sql.NVarChar, String(value));
}

function territoryPredicateFor(territories: string[], columnExpression: string) {
  if (!/^[a-zA-Z0-9_\.\[\]]+$/.test(columnExpression)) throw new Error('Invalid territory scope column.');
  if (!territories.length) return 'and 1 = 0';
  return `and ltrim(rtrim(cast(${columnExpression} as varchar(128)))) in (${territories.map((_, index) => `@scopeTerritory${index}`).join(', ')})`;
}

function applyTerritoryScope(query: string, request: sql.Request, report: ReportDefinition, territories: string[]) {
  const scope = report.source.territoryScope ?? { mode: 'optional' as const };
  const token = scope.predicateToken ?? '{{territoryPredicate}}';
  if (scope.mode === 'none') return query.replaceAll(token, '');

  const tokenMatch = query.match(/\{\{territoryPredicate:([^}]+)\}\}/);
  const effectiveToken = tokenMatch?.[0] ?? token;
  const columnExpression = tokenMatch?.[1] ?? 'TERRITORY_ID';
  const scopedTerritories = territories.map((territory) => territory.trim()).filter(Boolean).sort();
  scopedTerritories.forEach((territory, index) => request.input(`scopeTerritory${index}`, sql.VarChar, territory));

  if (scope.mode === 'optional' && !scopedTerritories.length) return query.replaceAll(effectiveToken, '');
  return query.replaceAll(effectiveToken, territoryPredicateFor(scopedTerritories, columnExpression));
}

export async function runReportDefinition(reportId: string, session: SessionContext, rawFilters: Record<string, unknown>): Promise<ReportRunResult> {
  const report = await loadReportDefinition(reportId);
  if (!report || report.status !== 'enabled') return { ok: false, message: 'Report not found.' };
  if (!canAccessReport(report, session)) return { ok: false, message: 'You do not have access to this report.' };

  const config = getClientMSSQLConfig(session.clientSlug);
  if (!config) return { ok: false, report: toSummary(report), message: 'Client MSSQL data source is not configured.' };

  assertReadOnlySelect(report.source.sql);
  const parsedFilters = Object.fromEntries(report.filters.map((filter) => [filter.id, parseFilterValue(filter, rawFilters[filter.id])])) as ParsedFilterValues;
  const cachePath = reportCachePath(report, session, parsedFilters);
  try {
    const cached = await readFreshReportResultCache(cachePath);
    if (cached) return cached;
  } catch (error) {
    // Cache must not block report execution.
  }

  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await connectClientMSSQL(config);
    const request = pool.request();
    for (const filter of report.filters) {
      bindFilter(request, filter, parsedFilters[filter.id]);
    }
    const query = applyTerritoryScope(report.source.sql, request, report, session.territories);
    const queryResult = await request.query<Record<string, unknown>>(query);
    const rows = queryResult.recordset.slice(0, report.source.maxRows).map(stripInternalSortFields);
    const result: Omit<ReportRunResult, 'cache'> = {
      ok: true,
      report: toSummary(report),
      rows,
      rowCount: rows.length,
      truncated: queryResult.recordset.length > rows.length,
      generatedAt: new Date().toISOString(),
    };
    try {
      return await writeReportResultCache(cachePath, result);
    } catch (error) {
      return {
        ...result,
        cache: {
          source: 'mssql-refresh',
          cachePath,
          generatedAt: result.generatedAt ?? new Date().toISOString(),
          expiresAt: new Date(Date.now() + REPORT_RESULT_CACHE_TTL_MS).toISOString(),
        },
      };
    }
  } finally {
    if (pool) await pool.close();
  }
}
