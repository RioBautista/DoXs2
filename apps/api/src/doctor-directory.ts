import sql from 'mssql';
import { z } from 'zod';
import type { DoctorDirectoryResponse, DoctorDirectoryRow } from '@doxs/shared';
import { connectClientMSSQL, getClientMSSQLConfig } from './mssql-dashboard.js';

export const doctorDirectoryQuerySchema = z.object({
  letter: z.string().trim().regex(/^[A-Z]$/).optional(),
  search: z.string().trim().max(80).optional(),
  cursor: z.string().trim().max(600).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

type DoctorCursor = {
  lastName: string;
  firstName: string;
  doctorId: string;
  territoryId: string;
};

type DoctorRecord = {
  doctor_id: string | null;
  territory_id: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  specialty_code: string | null;
  class_code: string | null;
  frequency: number | null;
  visit_day1: number | null;
  visit_day2: number | null;
  visit_day3: number | null;
  visit_day4: number | null;
  visit_day5: number | null;
  clinic_address: string | null;
};

function clean(value: unknown) {
  return String(value ?? '').trim();
}

function encodeCursor(row: DoctorDirectoryRow) {
  const cursor: DoctorCursor = {
    lastName: row.lastName,
    firstName: row.firstName,
    doctorId: row.doctorId,
    territoryId: row.territoryId,
  };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value?: string): DoctorCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<DoctorCursor>;
    const cursor = {
      lastName: clean(parsed.lastName),
      firstName: clean(parsed.firstName),
      doctorId: clean(parsed.doctorId),
      territoryId: clean(parsed.territoryId),
    };
    return cursor.doctorId && cursor.territoryId ? cursor : null;
  } catch {
    return null;
  }
}

function normalizedTerritories(territories: string[]) {
  return [...new Set(territories.map(clean).filter(Boolean))].sort();
}

export async function listDoctors(
  clientSlug: string | null,
  territories: string[],
  query: z.infer<typeof doctorDirectoryQuerySchema>,
): Promise<DoctorDirectoryResponse> {
  const config = getClientMSSQLConfig(clientSlug);
  if (!config) throw new Error('Client MSSQL doctor directory is not configured.');

  const scope = normalizedTerritories(territories);
  const cursor = decodeCursor(query.cursor);
  if (query.cursor && !cursor) throw new Error('Invalid doctor directory cursor.');

  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await connectClientMSSQL(config);
    const request = pool.request()
      .input('rowLimit', sql.Int, query.limit + 1)
      .input('letterPrefix', sql.VarChar(2), query.letter ? `${query.letter}%` : null)
      .input('searchPrefix', sql.NVarChar(82), query.search ? `${query.search}%` : null);

    scope.forEach((territory, index) => request.input(`territory${index}`, sql.VarChar(128), territory));
    if (cursor) {
      request
        .input('cursorLastName', sql.NVarChar(256), cursor.lastName)
        .input('cursorFirstName', sql.NVarChar(256), cursor.firstName)
        .input('cursorDoctorId', sql.VarChar(128), cursor.doctorId)
        .input('cursorTerritoryId', sql.VarChar(128), cursor.territoryId);
    }

    const territoryPredicate = scope.length
      ? `and ltrim(rtrim(cast(DC.TERRITORY_ID as varchar(128)))) in (${scope.map((_, index) => `@territory${index}`).join(', ')})`
      : '';
    const cursorPredicate = cursor ? `and (
      upper(ltrim(rtrim(coalesce(D.LAST_NAME, '')))) > upper(@cursorLastName)
      or (upper(ltrim(rtrim(coalesce(D.LAST_NAME, '')))) = upper(@cursorLastName) and upper(ltrim(rtrim(coalesce(D.FIRST_NAME, '')))) > upper(@cursorFirstName))
      or (upper(ltrim(rtrim(coalesce(D.LAST_NAME, '')))) = upper(@cursorLastName) and upper(ltrim(rtrim(coalesce(D.FIRST_NAME, '')))) = upper(@cursorFirstName) and ltrim(rtrim(cast(DC.MD_ID as varchar(128)))) > @cursorDoctorId)
      or (upper(ltrim(rtrim(coalesce(D.LAST_NAME, '')))) = upper(@cursorLastName) and upper(ltrim(rtrim(coalesce(D.FIRST_NAME, '')))) = upper(@cursorFirstName) and ltrim(rtrim(cast(DC.MD_ID as varchar(128)))) = @cursorDoctorId and ltrim(rtrim(cast(DC.TERRITORY_ID as varchar(128)))) > @cursorTerritoryId)
    )` : '';

    const result = await request.query<DoctorRecord>(`
      select top (@rowLimit)
        ltrim(rtrim(cast(DC.MD_ID as varchar(128)))) as doctor_id,
        ltrim(rtrim(cast(DC.TERRITORY_ID as varchar(128)))) as territory_id,
        ltrim(rtrim(coalesce(D.FIRST_NAME, ''))) as first_name,
        ltrim(rtrim(coalesce(D.MIDDLE_NAME, ''))) as middle_name,
        ltrim(rtrim(coalesce(D.LAST_NAME, ''))) as last_name,
        nullif(ltrim(rtrim(cast(D.SPECIALTY_CODE as varchar(128)))), '') as specialty_code,
        nullif(ltrim(rtrim(cast(DC.CLASS_CODE as varchar(128)))), '') as class_code,
        try_convert(int, DC.FREQUENCY) as frequency,
        try_convert(int, DC.VISIT_DAY1) as visit_day1,
        try_convert(int, DC.VISIT_DAY2) as visit_day2,
        try_convert(int, DC.VISIT_DAY3) as visit_day3,
        try_convert(int, DC.VISIT_DAY4) as visit_day4,
        try_convert(int, DC.VISIT_DAY5) as visit_day5,
        nullif(ltrim(rtrim(cast(DC.CLINIC_ADDRESS as nvarchar(1000)))), '') as clinic_address
      from [dbo].[DOCTOR_CLINIC] DC
      inner join [dbo].[DOCTOR] D on DC.MD_ID = D.MD_ID
      where DC.MD_ID is not null
        and DC.TERRITORY_ID is not null
        ${territoryPredicate}
        and (@letterPrefix is null or upper(ltrim(rtrim(coalesce(D.LAST_NAME, '')))) like @letterPrefix)
        and (@searchPrefix is null
          or upper(ltrim(rtrim(coalesce(D.LAST_NAME, '')))) like upper(@searchPrefix)
          or upper(ltrim(rtrim(coalesce(D.FIRST_NAME, '')))) like upper(@searchPrefix)
          or ltrim(rtrim(cast(DC.MD_ID as varchar(128)))) like @searchPrefix)
        ${cursorPredicate}
      order by
        upper(ltrim(rtrim(coalesce(D.LAST_NAME, '')))),
        upper(ltrim(rtrim(coalesce(D.FIRST_NAME, '')))),
        ltrim(rtrim(cast(DC.MD_ID as varchar(128)))),
        ltrim(rtrim(cast(DC.TERRITORY_ID as varchar(128))))
    `);

    const mapped = result.recordset.map((row): DoctorDirectoryRow => {
      const firstName = clean(row.first_name);
      const middleName = clean(row.middle_name);
      const lastName = clean(row.last_name);
      return {
        doctorId: clean(row.doctor_id),
        territoryId: clean(row.territory_id),
        firstName,
        middleName,
        lastName,
        displayName: [lastName && `${lastName},`, firstName, middleName].filter(Boolean).join(' '),
        specialtyCode: clean(row.specialty_code) || null,
        classCode: clean(row.class_code) || null,
        frequency: row.frequency === null ? null : Number(row.frequency),
        visitDays: [row.visit_day1, row.visit_day2, row.visit_day3, row.visit_day4, row.visit_day5]
          .map((day) => day !== null && day >= 1 && day <= 5 ? Number(day) : null) as DoctorDirectoryRow['visitDays'],
        clinicAddress: clean(row.clinic_address) || null,
      };
    });
    const hasMore = mapped.length > query.limit;
    const doctors = mapped.slice(0, query.limit);

    return {
      ok: true,
      doctors,
      nextCursor: hasMore && doctors.length ? encodeCursor(doctors[doctors.length - 1]) : null,
      hasMore,
      generatedAt: new Date().toISOString(),
      source: 'mssql',
      territoryCount: scope.length,
    };
  } finally {
    if (pool) await pool.close();
  }
}
