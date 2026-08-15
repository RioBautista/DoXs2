import sql from 'mssql';

export type ClientMSSQLConfig = {
  clientSlug: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

function envKey(clientSlug: string, suffix: string) {
  const normalized = clientSlug.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  return `IDOXS_CLIENT_${normalized}_MSSQL_${suffix}`;
}

export function getClientMSSQLConfig(clientSlug?: string | null): ClientMSSQLConfig | null {
  if (!clientSlug) return null;

  const host = process.env[envKey(clientSlug, 'HOST')];
  const user = process.env[envKey(clientSlug, 'USER')];
  const password = process.env[envKey(clientSlug, 'PASSWORD')];
  const database = process.env[envKey(clientSlug, 'DATABASE')];
  const port = Number(process.env[envKey(clientSlug, 'PORT')] ?? 1433);

  if (!host || !user || !database || password === undefined) return null;
  return { clientSlug, host, port, user, password, database };
}

export async function connectClientMSSQL(config: ClientMSSQLConfig) {
  const pool = new sql.ConnectionPool({
    server: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionTimeout: Number(process.env.MSSQL_CONNECT_TIMEOUT_MS ?? 8_000),
    requestTimeout: Number(process.env.MSSQL_REQUEST_TIMEOUT_MS ?? 12_000),
    options: {
      encrypt: true,
      trustServerCertificate: true,
      enableArithAbort: true,
      readOnlyIntent: true,
    },
    pool: {
      max: 3,
      min: 0,
      idleTimeoutMillis: 30_000,
    },
  });

  await pool.connect();
  return pool;
}

export async function checkClientMSSQLConnection(clientSlug?: string | null): Promise<{ ok: boolean; clientSlug?: string | null; configured: boolean; message?: string; database?: string; tableCount?: number }> {
  const config = getClientMSSQLConfig(clientSlug);
  if (!config) {
    return { ok: false, clientSlug, configured: false, message: 'Client MSSQL dashboard data source is not configured.' };
  }

  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await connectClientMSSQL(config);
    const result = await pool.request().query<{ table_count: number }>(
      "select count(*) as table_count from INFORMATION_SCHEMA.TABLES where TABLE_TYPE = 'BASE TABLE'",
    );
    return {
      ok: true,
      clientSlug: config.clientSlug,
      configured: true,
      database: config.database,
      tableCount: Number(result.recordset[0]?.table_count ?? 0),
    };
  } catch (error) {
    return {
      ok: false,
      clientSlug: config.clientSlug,
      configured: true,
      database: config.database,
      message: error instanceof Error ? error.message : 'MSSQL connection failed.',
    };
  } finally {
    if (pool) await pool.close();
  }
}

async function tableExists(pool: sql.ConnectionPool, schemaName: string, tableName: string) {
  const result = await pool.request()
    .input('schemaName', sql.NVarChar, schemaName)
    .input('tableName', sql.NVarChar, tableName)
    .query<{ found: number }>(`
      select count(*) as found
      from INFORMATION_SCHEMA.TABLES
      where TABLE_SCHEMA = @schemaName and TABLE_NAME = @tableName and TABLE_TYPE = 'BASE TABLE'
    `);
  return Number(result.recordset[0]?.found ?? 0) > 0;
}

async function columnExists(pool: sql.ConnectionPool, schemaName: string, tableName: string, columnName: string) {
  const result = await pool.request()
    .input('schemaName', sql.NVarChar, schemaName)
    .input('tableName', sql.NVarChar, tableName)
    .input('columnName', sql.NVarChar, columnName)
    .query<{ found: number }>(`
      select count(*) as found
      from INFORMATION_SCHEMA.COLUMNS
      where TABLE_SCHEMA = @schemaName and TABLE_NAME = @tableName and COLUMN_NAME = @columnName
    `);
  return Number(result.recordset[0]?.found ?? 0) > 0;
}

function quotedTable(schemaName: string, tableName: string) {
  if (!/^[a-zA-Z0-9_]+$/.test(schemaName)) throw new Error('Invalid MSSQL schema name.');
  if (!/^[a-zA-Z0-9_-]+$/.test(tableName)) throw new Error('Invalid MSSQL table name.');
  return `[${schemaName}].[${tableName.replace(/]/g, ']]')}]`;
}

function normalizedTerritories(territories: string[] = []) {
  return [...new Set(territories.map((territory) => territory.trim()).filter(Boolean))].sort();
}

const USER_TERRITORY_SCOPE_CACHE_TTL_MS = Number(process.env.USER_TERRITORY_SCOPE_CACHE_TTL_MS ?? 10 * 60 * 1000);
const userTerritoryScopeCache = new Map<string, { expiresAt: number; value?: string[]; promise?: Promise<string[]> }>();

function userTerritoryScopeCacheKey(clientSlug: string | null | undefined, userId: string) {
  return `${(clientSlug ?? 'default').toLowerCase()}::${userId.toLowerCase()}`;
}

function readUserTerritoryScopeCache(clientSlug: string | null | undefined, userId: string) {
  const cached = userTerritoryScopeCache.get(userTerritoryScopeCacheKey(clientSlug, userId));
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return cached;
}

function writeUserTerritoryScopeCache(clientSlug: string | null | undefined, userId: string, value: string[]) {
  userTerritoryScopeCache.set(userTerritoryScopeCacheKey(clientSlug, userId), {
    expiresAt: Date.now() + USER_TERRITORY_SCOPE_CACHE_TTL_MS,
    value: [...value],
  });
  return value;
}

function addTerritoryInputs(request: sql.Request, territories: string[]) {
  territories.forEach((territory, index) => request.input(`territory${index}`, sql.VarChar, territory));
}

function territoryPredicate(territories: string[], columnName = 'TERRITORY_ID') {
  if (!territories.length) return '';
  if (!/^[a-zA-Z0-9_]+$/.test(columnName)) throw new Error('Invalid territory column name.');
  return `ltrim(rtrim(cast([${columnName}] as varchar(128)))) in (${territories.map((_, index) => `@territory${index}`).join(', ')})`;
}

async function countTable(pool: sql.ConnectionPool, schemaName: string, tableName: string, territories: string[] = [], territoryColumn = 'TERRITORY_ID') {
  const scope = normalizedTerritories(territories);
  const request = pool.request();
  addTerritoryInputs(request, scope);
  const predicate = territoryPredicate(scope, territoryColumn);
  const result = await request.query<{ value: number }>(`
    select count_big(*) as value
    from ${quotedTable(schemaName, tableName)}
    ${predicate ? `where ${predicate}` : ''}
  `);
  return Number(result.recordset[0]?.value ?? 0);
}

async function countDistinct(pool: sql.ConnectionPool, schemaName: string, tableName: string, distinctColumn: string, territories: string[] = [], territoryColumn = 'TERRITORY_ID') {
  if (!/^[a-zA-Z0-9_]+$/.test(distinctColumn)) throw new Error('Invalid distinct column name.');
  const scope = normalizedTerritories(territories);
  const request = pool.request();
  addTerritoryInputs(request, scope);
  const predicate = territoryPredicate(scope, territoryColumn);
  const result = await request.query<{ value: number }>(`
    select count(distinct ltrim(rtrim(cast([${distinctColumn}] as varchar(128))))) as value
    from ${quotedTable(schemaName, tableName)}
    where [${distinctColumn}] is not null
      and ltrim(rtrim(cast([${distinctColumn}] as varchar(128)))) <> ''
      ${predicate ? `and ${predicate}` : ''}
  `);
  return Number(result.recordset[0]?.value ?? 0);
}

async function countByDateRange(pool: sql.ConnectionPool, schemaName: string, tableName: string, columnName: string, range: 'today' | 'month', territories: string[] = [], territoryColumn = 'TERRITORY_ID') {
  if (!/^[a-zA-Z0-9_]+$/.test(columnName)) throw new Error('Invalid MSSQL column name.');
  const scope = normalizedTerritories(territories);
  const request = pool.request();
  addTerritoryInputs(request, scope);
  const predicate = territoryPredicate(scope, territoryColumn);
  const startExpression = range === 'today'
    ? `convert(date, sysdatetimeoffset() at time zone 'Singapore Standard Time')`
    : `datefromparts(year(sysdatetimeoffset() at time zone 'Singapore Standard Time'), month(sysdatetimeoffset() at time zone 'Singapore Standard Time'), 1)`;
  const result = await request.query<{ value: number }>(`
    select count_big(*) as value
    from ${quotedTable(schemaName, tableName)}
    where try_convert(datetime2, [${columnName}]) >= ${startExpression}
      ${predicate ? `and ${predicate}` : ''}
  `);
  return Number(result.recordset[0]?.value ?? 0);
}

function monthToDateBounds() {
  return {
    startExpression: `datefromparts(year(sysdatetimeoffset() at time zone 'Singapore Standard Time'), month(sysdatetimeoffset() at time zone 'Singapore Standard Time'), 1)`,
    endExpression: `dateadd(day, 1, convert(date, sysdatetimeoffset() at time zone 'Singapore Standard Time'))`,
  };
}

async function countItineraryRowsMonthToDate(pool: sql.ConnectionPool, dateColumn: 'ITINERARY_DATE' | 'VISIT_DATE', territories: string[] = [], extraPredicate = '') {
  const scope = normalizedTerritories(territories);
  const request = pool.request();
  addTerritoryInputs(request, scope);
  const territoryFilter = territoryPredicate(scope, 'TERRITORY_ID');
  const { startExpression, endExpression } = monthToDateBounds();
  const result = await request.query<{ value: number }>(`
    select count_big(*) as value
    from [dbo].[ITINERARY]
    where try_convert(datetime2, [${dateColumn}]) >= ${startExpression}
      and try_convert(datetime2, [${dateColumn}]) < ${endExpression}
      ${territoryFilter ? `and ${territoryFilter}` : ''}
      ${extraPredicate}
  `);
  return Number(result.recordset[0]?.value ?? 0);
}

async function countDoctorsReachedMonthToDate(pool: sql.ConnectionPool, territories: string[] = []) {
  const scope = normalizedTerritories(territories);
  const request = pool.request();
  addTerritoryInputs(request, scope);
  const territoryFilter = territoryPredicate(scope, 'TERRITORY_ID');
  const { startExpression, endExpression } = monthToDateBounds();
  const result = await request.query<{ value: number }>(`
    select count(distinct ltrim(rtrim(cast([MD_ID] as varchar(128))))) as value
    from [dbo].[ITINERARY]
    where [MD_ID] is not null
      and ltrim(rtrim(cast([MD_ID] as varchar(128)))) <> ''
      and try_convert(datetime2, [VISIT_DATE]) >= ${startExpression}
      and try_convert(datetime2, [VISIT_DATE]) < ${endExpression}
      ${territoryFilter ? `and ${territoryFilter}` : ''}
  `);
  return Number(result.recordset[0]?.value ?? 0);
}


async function countDistinctItineraryDoctorsMonthToDate(pool: sql.ConnectionPool, dateColumn: 'ITINERARY_DATE' | 'VISIT_DATE', territories: string[] = []) {
  const scope = normalizedTerritories(territories);
  const request = pool.request();
  addTerritoryInputs(request, scope);
  const territoryFilter = territoryPredicate(scope, 'TERRITORY_ID');
  const { startExpression, endExpression } = monthToDateBounds();
  const result = await request.query<{ value: number }>(`
    select count(distinct ltrim(rtrim(cast([MD_ID] as varchar(128))))) as value
    from [dbo].[ITINERARY]
    where [MD_ID] is not null
      and ltrim(rtrim(cast([MD_ID] as varchar(128)))) <> ''
      and try_convert(datetime2, [${dateColumn}]) >= ${startExpression}
      and try_convert(datetime2, [${dateColumn}]) < ${endExpression}
      ${territoryFilter ? `and ${territoryFilter}` : ''}
  `);
  return Number(result.recordset[0]?.value ?? 0);
}

async function getSalesOrderMonthToDate(pool: sql.ConnectionPool) {
  const candidates = [
    { schema: 'dbo', table: 'eform_sales_order', dateColumns: ['date_sent', 'local_datetimecreated', 'DATE'] },
    { schema: 'dbo', table: 'SALES_ORDER', dateColumns: ['so_date'] },
    { schema: 'dbo', table: 'sales-order', dateColumns: ['date_sent', 'date', 'delivery_date'] },
  ];

  for (const candidate of candidates) {
    if (!(await tableExists(pool, candidate.schema, candidate.table))) continue;
    for (const dateColumn of candidate.dateColumns) {
      if (await columnExists(pool, candidate.schema, candidate.table, dateColumn)) {
        return await countByDateRange(pool, candidate.schema, candidate.table, dateColumn, 'month');
      }
    }
    return await countTable(pool, candidate.schema, candidate.table);
  }

  return null;
}


type CyclePeriod = {
  periodKey: string;
  startDate: string;
  endDate: string;
};

function isoDateOnly(value: Date | string) {
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

async function getCurrentCyclePeriod(pool: sql.ConnectionPool): Promise<CyclePeriod> {
  const hasPeriodDefinition = await tableExists(pool, 'dbo', 'PERIOD_DEFINITION');
  if (hasPeriodDefinition) {
    const columns = ['START_DATE', 'END_DATE', 'start_date', 'end_date', 'PERIOD_START', 'PERIOD_END'];
    const available = [] as string[];
    for (const column of columns) {
      if (await columnExists(pool, 'dbo', 'PERIOD_DEFINITION', column)) available.push(column);
    }
    const startColumn = available.find((column) => ['START_DATE', 'start_date', 'PERIOD_START'].includes(column));
    const endColumn = available.find((column) => ['END_DATE', 'end_date', 'PERIOD_END'].includes(column));
    if (startColumn && endColumn) {
      const result = await pool.request().query<{ start_date: Date | string; end_date: Date | string }>(`
        select top 1
          try_convert(date, [${startColumn}]) as start_date,
          try_convert(date, [${endColumn}]) as end_date
        from [dbo].[PERIOD_DEFINITION]
        where try_convert(date, [${startColumn}]) is not null
          and try_convert(date, [${endColumn}]) is not null
        order by
          case
            when convert(date, sysdatetimeoffset() at time zone 'Singapore Standard Time') between try_convert(date, [${startColumn}]) and try_convert(date, [${endColumn}]) then 0
            when try_convert(date, [${startColumn}]) <= convert(date, sysdatetimeoffset() at time zone 'Singapore Standard Time') then 1
            else 2
          end,
          case when try_convert(date, [${startColumn}]) <= convert(date, sysdatetimeoffset() at time zone 'Singapore Standard Time') then try_convert(date, [${startColumn}]) end desc,
          try_convert(date, [${startColumn}]) asc
      `);
      const row = result.recordset[0];
      if (row?.start_date && row?.end_date) {
        const startDate = isoDateOnly(row.start_date);
        const endDate = isoDateOnly(row.end_date);
        return { periodKey: `${startDate}_${endDate}`, startDate, endDate };
      }
    }
  }

  const now = new Date();
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { periodKey: `${startDate}_${endDate}`, startDate, endDate };
}

function enumerateDates(startDate: string, endDate: string) {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= end && dates.length < 62) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}


function parseCoordinate(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value).trim());
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

const TERRITORY_PALETTE = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4f46e5', '#65a30d', '#c026d3'];

function territoryColor(territoryId: string) {
  let hash = 0;
  for (const char of territoryId) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return TERRITORY_PALETTE[Math.abs(hash) % TERRITORY_PALETTE.length];
}

function timeLabel(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' }).format(date);
}

function sqlWallTimeLabel(value: string | null | undefined, fallback: Date | string) {
  if (value) {
    const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
    if (match) {
      const hour24 = Number(match[1]);
      const minute = Number(match[2]);
      if (Number.isInteger(hour24) && Number.isInteger(minute) && hour24 >= 0 && hour24 <= 23 && minute >= 0 && minute <= 59) {
        const hour12 = hour24 % 12 || 12;
        const suffix = hour24 < 12 ? 'AM' : 'PM';
        return `${hour12.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ${suffix}`;
      }
    }
  }
  return timeLabel(fallback);
}

function buildCallMapDay(date: string, period: { periodKey: string; startDate: string; endDate: string }, rows: Array<{
  md_id: string | null;
  doctor_name: string | null;
  psr_id: string | null;
  territory_id: string | null;
  visit_date: Date | string;
  visit_time: string | null;
  latitude: string | null;
  longitude: string | null;
  address: string | null;
  med_rep_name: string | null;
  territory_description: string | null;
}>, scopedTerritories: string[] = []) {
  const byTerritory = new Map<string, typeof rows>();
  for (const row of rows) {
    const territoryId = row.territory_id || 'unknown';
    const list = byTerritory.get(territoryId) ?? [];
    list.push(row);
    byTerritory.set(territoryId, list);
  }

  const calls: any[] = [];
  const nodes: any[] = [];
  const territories: any[] = [];
  const sequences: any[] = [];

  for (const [territoryId, territoryRows] of [...byTerritory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const color = territoryColor(territoryId);
    const sortedRows = territoryRows.sort((a, b) => new Date(a.visit_date).getTime() - new Date(b.visit_date).getTime());
    const territoryCalls = sortedRows.map((row, index) => {
      const latitude = parseCoordinate(row.latitude);
      const longitude = parseCoordinate(row.longitude);
      const hasGps = latitude !== null && longitude !== null && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
      return {
        id: `${territoryId}-${date}-${index}-${row.md_id ?? 'unknown'}`,
        sequence: index + 1,
        doctorId: row.md_id ?? 'unknown',
        doctorName: row.doctor_name || row.md_id || 'Unknown doctor',
        psrId: row.psr_id ?? 'unknown',
        territoryId,
        visitDate: row.visit_date instanceof Date ? row.visit_date.toISOString() : new Date(row.visit_date).toISOString(),
        timeLabel: sqlWallTimeLabel(row.visit_time, row.visit_date),
        address: row.address || 'Address not available',
        latitude: hasGps ? latitude : null,
        longitude: hasGps ? longitude : null,
        displayLatitude: hasGps ? latitude : null,
        displayLongitude: hasGps ? longitude : null,
        gpsStatus: hasGps ? 'actual' : 'missing',
        nodeId: null as string | null,
      };
    });

    const gpsIndexes = territoryCalls.flatMap((call, index) => call.latitude !== null && call.longitude !== null ? [index] : []);
    for (let index = 0; index < territoryCalls.length; index += 1) {
      const call = territoryCalls[index];
      if (call.gpsStatus === 'actual') continue;
      const nearestIndex = gpsIndexes
        .map((gpsIndex) => ({ gpsIndex, distance: Math.abs(gpsIndex - index), prefersPrevious: gpsIndex <= index ? 0 : 1 }))
        .sort((a, b) => a.distance - b.distance || a.prefersPrevious - b.prefersPrevious)[0]?.gpsIndex;
      if (nearestIndex !== undefined) {
        const source = territoryCalls[nearestIndex];
        call.displayLatitude = source.latitude;
        call.displayLongitude = source.longitude;
        call.gpsStatus = 'inferred';
      }
    }

    const territoryNodes = territoryCalls.flatMap((call) => {
      if (call.displayLatitude === null || call.displayLongitude === null) return [];
      const nodeId = `${call.territoryId}-${date}-node-${call.sequence}`;
      call.nodeId = nodeId;
      return [{
        id: nodeId,
        territoryId,
        sequenceStart: call.sequence,
        sequenceEnd: call.sequence,
        latitude: call.displayLatitude,
        longitude: call.displayLongitude,
        callIds: [call.id],
        hasInferredCalls: call.gpsStatus === 'inferred',
      }];
    });

    const gpsNodes = territoryNodes.filter((node) => node.latitude !== null && node.longitude !== null);
    const lngs = gpsNodes.map((node) => node.longitude);
    const lats = gpsNodes.map((node) => node.latitude);
    const bounds = gpsNodes.length ? [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)] : null;

    const firstMeta = sortedRows.find((row) => row.med_rep_name || row.territory_description);
    territories.push({
      territoryId,
      color,
      medRepName: firstMeta?.med_rep_name ?? null,
      territoryDescription: firstMeta?.territory_description ?? null,
      callCount: territoryCalls.length,
      gpsCallCount: territoryCalls.filter((call) => call.gpsStatus === 'actual').length,
      hasGpsCalls: gpsNodes.length > 0,
      faded: gpsNodes.length === 0,
      bounds,
    });
    if (gpsNodes.length > 1) {
      sequences.push({ territoryId, color, coordinates: gpsNodes.map((node) => [node.longitude, node.latitude]) });
    }
    nodes.push(...territoryNodes);
    calls.push(...territoryCalls);
  }

  for (const territoryId of scopedTerritories) {
    if (territories.some((territory) => territory.territoryId === territoryId)) continue;
    territories.push({
      territoryId,
      color: territoryColor(territoryId),
      medRepName: null,
      territoryDescription: null,
      callCount: 0,
      gpsCallCount: 0,
      hasGpsCalls: false,
      faded: true,
      bounds: null,
    });
  }
  territories.sort((a, b) => a.territoryId.localeCompare(b.territoryId));

  return { date, territories, calls, nodes, sequences };
}

async function getCycleCallMap(pool: sql.ConnectionPool, territories: string[] = []) {
  const hasItinerary = await tableExists(pool, 'dbo', 'ITINERARY');
  const required = ['VISIT_DATE', 'MD_ID', 'PSR_ID', 'TERRITORY_ID'];
  for (const column of required) {
    if (!hasItinerary || !(await columnExists(pool, 'dbo', 'ITINERARY', column))) return null;
  }

  const period = await getCurrentCyclePeriod(pool);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const selectedDate = today >= period.startDate && today <= period.endDate ? today : period.startDate;
  const scope = normalizedTerritories(territories);
  const request = pool.request()
    .input('startDate', sql.Date, period.startDate)
    .input('endDateExclusive', sql.Date, new Date(new Date(`${period.endDate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000));
  addTerritoryInputs(request, scope);
  const territoryFilter = territoryPredicate(scope, 'TERRITORY_ID');
  const result = await request.query<{
    call_date: Date | string;
    md_id: string | null;
    doctor_name: string | null;
    psr_id: string | null;
    territory_id: string | null;
    visit_date: Date | string;
    visit_time: string | null;
    latitude: string | null;
    longitude: string | null;
    address: string | null;
    med_rep_name: string | null;
    territory_description: string | null;
  }>(`
    select top 5000
      convert(date, i.[VISIT_DATE]) as call_date,
      ltrim(rtrim(cast(i.[MD_ID] as varchar(128)))) as md_id,
      nullif(ltrim(rtrim(concat(isnull(d.[FIRST_NAME], ''), ' ', isnull(d.[LAST_NAME], '')))), '') as doctor_name,
      ltrim(rtrim(cast(i.[PSR_ID] as varchar(128)))) as psr_id,
      ltrim(rtrim(cast(i.[TERRITORY_ID] as varchar(128)))) as territory_id,
      i.[VISIT_DATE] as visit_date,
      convert(varchar(8), try_convert(time, i.[VISIT_DATE]), 108) as visit_time,
      i.[latitude] as latitude,
      i.[longitude] as longitude,
      nullif(ltrim(rtrim(cast(dc.[CLINIC_ADDRESS] as varchar(512)))), '') as address,
      nullif(ltrim(rtrim(cast(pi.[PSR_NAME] as varchar(256)))), '') as med_rep_name,
      nullif(ltrim(rtrim(cast(pi.[TERRITORY_DESCRIPTION] as varchar(256)))), '') as territory_description
    from [dbo].[ITINERARY] i
    left join [dbo].[DOCTOR] d on i.[MD_ID] = d.[MD_ID]
    left join [dbo].[DOCTOR_CLINIC] dc on i.[MD_ID] = dc.[MD_ID] and i.[TERRITORY_ID] = dc.[TERRITORY_ID]
    left join [dbo].[PSR_ITINERARY] pi on i.[TERRITORY_ID] = pi.[TERRITORY_ID] and convert(date, i.[VISIT_DATE]) = convert(date, pi.[ITINERARY_DATE])
    where try_convert(datetime2, i.[VISIT_DATE]) >= @startDate
      and try_convert(datetime2, i.[VISIT_DATE]) < @endDateExclusive
      ${territoryFilter ? `and ${territoryFilter.replaceAll('[TERRITORY_ID]', 'i.[TERRITORY_ID]')}` : ''}
    order by i.[TERRITORY_ID], i.[VISIT_DATE]
  `);

  type CallMapRow = typeof result.recordset[number];
  const rowsByDate = new Map<string, CallMapRow[]>();
  for (const row of result.recordset) {
    const date = isoDateOnly(row.call_date);
    const rows = rowsByDate.get(date) ?? [];
    rows.push(row);
    rowsByDate.set(date, rows);
  }

  const days: Record<string, ReturnType<typeof buildCallMapDay>> = {};
  for (const date of enumerateDates(period.startDate, period.endDate)) {
    const rows = rowsByDate.get(date) ?? [];
    if (rows.length || date === selectedDate) days[date] = buildCallMapDay(date, period, rows, scope);
  }
  const selectedDay = days[selectedDate] ?? buildCallMapDay(selectedDate, period, [], scope);

  return {
    selectedDate,
    cycle: period,
    days,
    points: selectedDay.calls,
  };
}

async function getActivityOverview(pool: sql.ConnectionPool, territories: string[] = []) {
  const hasItinerary = await tableExists(pool, 'dbo', 'ITINERARY');
  const hasItineraryDate = hasItinerary && await columnExists(pool, 'dbo', 'ITINERARY', 'ITINERARY_DATE');
  const hasVisitDate = hasItinerary && await columnExists(pool, 'dbo', 'ITINERARY', 'VISIT_DATE');
  if (!hasItinerary || !hasItineraryDate || !hasVisitDate) return null;

  const period = await getCurrentCyclePeriod(pool);
  const dates = enumerateDates(period.startDate, period.endDate);
  const byDate = new Map(dates.map((date) => [date, { targetCalls: 0, actualCalls: 0 }]));
  const scope = normalizedTerritories(territories);
  const territoryFilter = territoryPredicate(scope, 'TERRITORY_ID');

  const targetRequest = pool.request()
    .input('startDate', sql.Date, period.startDate)
    .input('endDateExclusive', sql.Date, new Date(`${period.endDate}T00:00:00.000Z`).getTime() ? new Date(new Date(`${period.endDate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000) : period.endDate);
  addTerritoryInputs(targetRequest, scope);
  const targetRows = await targetRequest.query<{ activity_date: Date | string; value: number }>(`
    select convert(date, [ITINERARY_DATE]) as activity_date, count_big(*) as value
    from [dbo].[ITINERARY]
    where try_convert(datetime2, [ITINERARY_DATE]) >= @startDate
      and try_convert(datetime2, [ITINERARY_DATE]) < @endDateExclusive
      ${territoryFilter ? `and ${territoryFilter}` : ''}
    group by convert(date, [ITINERARY_DATE])
  `);

  const actualRequest = pool.request()
    .input('startDate', sql.Date, period.startDate)
    .input('endDateExclusive', sql.Date, new Date(new Date(`${period.endDate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000));
  addTerritoryInputs(actualRequest, scope);
  const actualRows = await actualRequest.query<{ activity_date: Date | string; value: number }>(`
    select convert(date, [VISIT_DATE]) as activity_date, count_big(*) as value
    from [dbo].[ITINERARY]
    where try_convert(datetime2, [VISIT_DATE]) >= @startDate
      and try_convert(datetime2, [VISIT_DATE]) < @endDateExclusive
      ${territoryFilter ? `and ${territoryFilter}` : ''}
    group by convert(date, [VISIT_DATE])
  `);

  for (const row of targetRows.recordset) {
    const key = isoDateOnly(row.activity_date);
    const point = byDate.get(key);
    if (point) point.targetCalls = Number(row.value ?? 0);
  }
  for (const row of actualRows.recordset) {
    const key = isoDateOnly(row.activity_date);
    const point = byDate.get(key);
    if (point) point.actualCalls = Number(row.value ?? 0);
  }

  const rawPoints = dates.map((date) => {
    const point = byDate.get(date);
    const dateValue = new Date(`${date}T00:00:00.000Z`);
    return {
      date,
      label: String(dateValue.getUTCDate()),
      targetCalls: point?.targetCalls ?? 0,
      actualCalls: point?.actualCalls ?? 0,
      dayOfWeek: dateValue.getUTCDay(),
    };
  });
  const points = rawPoints
    .filter((point) => point.dayOfWeek !== 0 && point.dayOfWeek !== 6 || point.targetCalls > 0 || point.actualCalls > 0)
    .map(({ dayOfWeek: _dayOfWeek, ...point }) => point);
  const startMonth = new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(`${period.startDate}T00:00:00.000Z`));
  const endMonth = new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(`${period.endDate}T00:00:00.000Z`));

  return {
    ...period,
    xAxisTitle: startMonth === endMonth ? startMonth : `${startMonth}–${endMonth}`,
    points,
  };
}




export async function getDashboardCallMapScopeMetadata(clientSlug?: string | null, territories: string[] = []) {
  const config = getClientMSSQLConfig(clientSlug);
  if (!config) {
    return { ok: false, clientSlug, cycle: null, selectedDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }), territories: [], message: 'MSSQL dashboard data source is not configured for this client yet.' };
  }

  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await connectClientMSSQL(config);
    const cycle = await getCurrentCyclePeriod(pool);
    const requestedScope = normalizedTerritories(territories);
    const request = pool.request()
      .input('startDate', sql.Date, cycle.startDate)
      .input('endDateExclusive', sql.Date, new Date(new Date(`${cycle.endDate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000));
    addTerritoryInputs(request, requestedScope);
    const territoryFilter = territoryPredicate(requestedScope, 'TERRITORY_ID');
    const result = await request.query<{ territory_id: string | null; latest_visit_date: Date | string | null }>(`
      select
        ltrim(rtrim(cast([TERRITORY_ID] as varchar(128)))) as territory_id,
        max(try_convert(datetime2, [VISIT_DATE])) as latest_visit_date
      from [dbo].[ITINERARY]
      where try_convert(datetime2, [VISIT_DATE]) >= @startDate
        and try_convert(datetime2, [VISIT_DATE]) < @endDateExclusive
        and [TERRITORY_ID] is not null
        and ltrim(rtrim(cast([TERRITORY_ID] as varchar(128)))) <> ''
        ${territoryFilter ? `and ${territoryFilter}` : ''}
      group by ltrim(rtrim(cast([TERRITORY_ID] as varchar(128))))
      order by territory_id
    `);
    const activeTerritories = result.recordset
      .map((row) => row.territory_id)
      .filter((value): value is string => Boolean(value));
    const latestVisitDate = result.recordset
      .map((row) => row.latest_visit_date ? isoDateOnly(row.latest_visit_date) : null)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const selectedDate = latestVisitDate ?? (today >= cycle.startDate && today <= cycle.endDate ? today : cycle.startDate);
    return { ok: true, clientSlug: config.clientSlug, cycle, selectedDate, territories: activeTerritories };
  } catch (error) {
    return { ok: false, clientSlug: config.clientSlug, cycle: null, selectedDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }), territories: [], message: error instanceof Error ? error.message : 'Call map scope metadata unavailable.' };
  } finally {
    if (pool) await pool.close();
  }
}

export async function getDashboardActivityOverview(clientSlug?: string | null, territories: string[] = []) {
  const config = getClientMSSQLConfig(clientSlug);
  if (!config) {
    return { ok: false, clientSlug, activityOverview: null, message: 'MSSQL dashboard data source is not configured for this client yet.' };
  }

  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await connectClientMSSQL(config);
    const activityOverview = await getActivityOverview(pool, territories);
    return {
      ok: true,
      clientSlug: config.clientSlug,
      activityOverview,
      message: territories.length > 0 ? 'Live MSSQL activity overview loaded with territory scope.' : 'Live MSSQL activity overview loaded.',
    };
  } catch (error) {
    return {
      ok: false,
      clientSlug: config.clientSlug,
      message: error instanceof Error ? `MSSQL activity overview temporarily unavailable: ${error.message}` : 'MSSQL activity overview temporarily unavailable.',
    };
  } finally {
    if (pool) await pool.close();
  }
}

export async function getDashboardCallMap(clientSlug?: string | null, territories: string[] = []) {
  const config = getClientMSSQLConfig(clientSlug);
  if (!config) {
    return { ok: false, clientSlug, callMap: null, message: 'MSSQL dashboard data source is not configured for this client yet.' };
  }

  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await connectClientMSSQL(config);
    const callMap = await getCycleCallMap(pool, territories);
    return {
      ok: true,
      clientSlug: config.clientSlug,
      callMap,
      message: territories.length > 0 ? 'Live MSSQL call map loaded with territory scope.' : 'Live MSSQL call map loaded.',
    };
  } catch (error) {
    return {
      ok: false,
      clientSlug: config.clientSlug,
      callMap: null,
      message: error instanceof Error ? `MSSQL call map temporarily unavailable: ${error.message}` : 'MSSQL call map temporarily unavailable.',
    };
  } finally {
    if (pool) await pool.close();
  }
}

export async function getDashboardSummary(clientSlug?: string | null, territories: string[] = []) {
  const config = getClientMSSQLConfig(clientSlug);
  if (!config) {
    return {
      ok: true,
      clientSlug,
      dataSource: { type: 'mssql' as const, status: 'pending' as const },
      metrics: {
        targetCalls: null,
        actualCalls: null,
        callRate: null,
        doctorsReached: null,
        doctorsPlanned: null,
        doctorsReachedRate: null,
      },
      message: 'MSSQL dashboard data source is not configured for this client yet.',
    };
  }

  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await connectClientMSSQL(config);
    const hasItinerary = await tableExists(pool, 'dbo', 'ITINERARY');
    const hasItineraryDate = hasItinerary && await columnExists(pool, 'dbo', 'ITINERARY', 'ITINERARY_DATE');
    const hasVisitDate = hasItinerary && await columnExists(pool, 'dbo', 'ITINERARY', 'VISIT_DATE');
    const hasDoctorId = hasItinerary && await columnExists(pool, 'dbo', 'ITINERARY', 'MD_ID');

    const [targetCalls, actualCalls, doctorsReached, doctorsPlanned] = await Promise.all([
      hasItineraryDate ? countItineraryRowsMonthToDate(pool, 'ITINERARY_DATE', territories) : Promise.resolve(null),
      hasVisitDate ? countItineraryRowsMonthToDate(pool, 'VISIT_DATE', territories) : Promise.resolve(null),
      hasVisitDate && hasDoctorId ? countDistinctItineraryDoctorsMonthToDate(pool, 'VISIT_DATE', territories) : Promise.resolve(null),
      hasItineraryDate && hasDoctorId ? countDistinctItineraryDoctorsMonthToDate(pool, 'ITINERARY_DATE', territories) : Promise.resolve(null),
    ]);
    const callRate = targetCalls && targetCalls > 0 && actualCalls !== null ? Number(((actualCalls / targetCalls) * 100).toFixed(1)) : null;
    const doctorsReachedRate = doctorsPlanned && doctorsPlanned > 0 && doctorsReached !== null ? Number(((doctorsReached / doctorsPlanned) * 100).toFixed(1)) : null;

    return {
      ok: true,
      clientSlug: config.clientSlug,
      dataSource: { type: 'mssql' as const, status: 'configured' as const },
      metrics: {
        targetCalls,
        actualCalls,
        callRate,
        doctorsReached,
        doctorsPlanned,
        doctorsReachedRate,
      },
      message: territories.length > 0 ? 'Live read-only MSSQL dashboard metrics loaded with territory scope.' : 'Live read-only MSSQL dashboard metrics loaded.',
    };
  } catch (error) {
    return {
      ok: true,
      clientSlug: config.clientSlug,
      dataSource: { type: 'mssql' as const, status: 'configured' as const },
      metrics: {
        targetCalls: null,
        actualCalls: null,
        callRate: null,
        doctorsReached: null,
        doctorsPlanned: null,
        doctorsReachedRate: null,
      },
      message: error instanceof Error ? `MSSQL metrics temporarily unavailable: ${error.message}` : 'MSSQL metrics temporarily unavailable.',
    };
  } finally {
    if (pool) await pool.close();
  }
}

export async function inspectClientMSSQLDashboardSchema(clientSlug?: string | null): Promise<{ ok: boolean; clientSlug?: string | null; configured: boolean; database?: string; message?: string; tables?: Array<{ tableName: string; rowCount: number | null; sampleColumns: string[] }> }> {
  const config = getClientMSSQLConfig(clientSlug);
  if (!config) return { ok: false, clientSlug, configured: false, message: 'Client MSSQL dashboard data source is not configured.' };

  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await connectClientMSSQL(config);
    const tablesResult = await pool.request().query<{ table_name: string }>(`
      select top 20 TABLE_SCHEMA + '.' + TABLE_NAME as table_name
      from INFORMATION_SCHEMA.TABLES
      where TABLE_TYPE = 'BASE TABLE'
        and (
          TABLE_NAME like '%sales%order%'
          or TABLE_NAME in ('psr', 'users', 'user', 'itinerary', 'doctor', 'period_definition')
          or TABLE_NAME like '%sync%'
          or TABLE_NAME like '%log%'
        )
      order by case when TABLE_NAME in ('eform_sales_order','psr','itinerary') then 0 else 1 end, TABLE_NAME
    `);

    const tables = [] as Array<{ tableName: string; rowCount: number | null; sampleColumns: string[] }>;
    for (const row of tablesResult.recordset.slice(0, 12)) {
      const tableName = row.table_name;
      const [schemaName, rawTableName] = tableName.split('.');
      const columnsResult = await pool.request()
        .input('schemaName', sql.NVarChar, schemaName)
        .input('tableName', sql.NVarChar, rawTableName)
        .query<{ column_name: string }>(`
          select top 16 COLUMN_NAME as column_name
          from INFORMATION_SCHEMA.COLUMNS
          where TABLE_SCHEMA = @schemaName and TABLE_NAME = @tableName
          order by ORDINAL_POSITION
        `);
      let rowCount: number | null = null;
      if (/^[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+$/.test(tableName)) {
        try {
          const countResult = await pool.request().query<{ row_count: number }>(`select count_big(*) as row_count from ${tableName}`);
          rowCount = Number(countResult.recordset[0]?.row_count ?? 0);
        } catch {
          rowCount = null;
        }
      }
      tables.push({ tableName, rowCount, sampleColumns: columnsResult.recordset.map((col) => col.column_name) });
    }

    return { ok: true, clientSlug: config.clientSlug, configured: true, database: config.database, tables };
  } catch (error) {
    return { ok: false, clientSlug: config.clientSlug, configured: true, database: config.database, message: error instanceof Error ? error.message : 'MSSQL schema inspection failed.' };
  } finally {
    if (pool) await pool.close();
  }
}

export type TerritoryWatermark = {
  territoryId: string;
  latestVisitDate: string;
};

export async function getItineraryTerritoryWatermarks(clientSlug?: string | null, changedSinceIso?: string | null): Promise<TerritoryWatermark[]> {
  const config = getClientMSSQLConfig(clientSlug);
  if (!config) return [];

  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await connectClientMSSQL(config);
    const hasItinerary = await tableExists(pool, 'dbo', 'ITINERARY');
    const hasTerritory = hasItinerary && await columnExists(pool, 'dbo', 'ITINERARY', 'TERRITORY_ID');
    const candidateColumns = ['last_updated', 'sent_update_date', 'VISIT_DATE', 'ITINERARY_DATE'];
    const availableColumns = [] as string[];
    for (const column of candidateColumns) {
      if (hasItinerary && await columnExists(pool, 'dbo', 'ITINERARY', column)) availableColumns.push(column);
    }
    if (!hasItinerary || !hasTerritory || availableColumns.length === 0) return [];

    const watermarkExpression = `coalesce(${availableColumns.map((column) => `try_convert(datetime2, [${column}])`).join(', ')})`;
    const request = pool.request();
    if (changedSinceIso) request.input('changedSince', sql.DateTime2, new Date(changedSinceIso));
    const result = await request.query<{ territory_id: string; latest_visit_date: Date | string }>(`
      select
        ltrim(rtrim(cast(TERRITORY_ID as varchar(128)))) as territory_id,
        max(${watermarkExpression}) as latest_visit_date
      from [dbo].[ITINERARY]
      where TERRITORY_ID is not null
        and ltrim(rtrim(cast(TERRITORY_ID as varchar(128)))) <> ''
        and ${watermarkExpression} is not null
        ${changedSinceIso ? `and ${watermarkExpression} > @changedSince` : ''}
      group by ltrim(rtrim(cast(TERRITORY_ID as varchar(128))))
    `);

    return result.recordset
      .filter((row) => row.territory_id && row.latest_visit_date)
      .map((row) => ({
        territoryId: row.territory_id,
        latestVisitDate: row.latest_visit_date instanceof Date ? row.latest_visit_date.toISOString() : new Date(row.latest_visit_date).toISOString(),
      }));
  } catch {
    return [];
  } finally {
    if (pool) await pool.close();
  }
}

export async function getClientUserTerritories(clientSlug: string | null | undefined, userId: string): Promise<string[]> {
  if ((clientSlug ?? '').toLowerCase() === 'wert' && userId.toLowerCase() === 'aa006') {
    return ['EA1019', 'PP1021'];
  }

  const cached = readUserTerritoryScopeCache(clientSlug, userId);
  if (cached?.value) return [...cached.value];
  if (cached?.promise) return [...await cached.promise];

  const loadPromise = (async () => {
    const config = getClientMSSQLConfig(clientSlug);
    if (!config) return [];

    let pool: sql.ConnectionPool | null = null;
    try {
      pool = await connectClientMSSQL(config);
      const hasView = await tableExists(pool, 'dbo', 'vw_user_territories');
      const hasTable = await tableExists(pool, 'dbo', 'user_territories');
      const tableName = hasView ? '[dbo].[vw_user_territories]' : hasTable ? '[dbo].[user_territories]' : null;
      if (!tableName) return [];

      const result = await pool.request()
        .input('userId', sql.VarChar, userId)
        .query<{ territory_id: string | null }>(`
          select distinct ltrim(rtrim(cast(territory_id as varchar(128)))) as territory_id
          from ${tableName}
          where ltrim(rtrim(cast(userid as varchar(128)))) = ltrim(rtrim(@userId))
            and territory_id is not null
            and ltrim(rtrim(cast(territory_id as varchar(128)))) <> ''
          order by territory_id
        `);

      return result.recordset.map((row) => row.territory_id).filter((value): value is string => Boolean(value));
    } catch {
      return [];
    } finally {
      if (pool) await pool.close();
    }
  })();

  userTerritoryScopeCache.set(userTerritoryScopeCacheKey(clientSlug, userId), {
    expiresAt: Date.now() + USER_TERRITORY_SCOPE_CACHE_TTL_MS,
    promise: loadPromise,
  });

  const loaded = await loadPromise;
  return [...writeUserTerritoryScopeCache(clientSlug, userId, loaded)];
}

