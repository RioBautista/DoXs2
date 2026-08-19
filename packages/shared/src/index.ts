export type LoginUser = {
  username: string;
  displayName: string;
  roles: string[];
};

export type DoctorDirectoryRow = {
  doctorId: string;
  territoryId: string;
  firstName: string;
  middleName: string;
  lastName: string;
  displayName: string;
  specialtyCode: string | null;
  classCode: string | null;
  frequency: number | null;
  visitDays: [number | null, number | null, number | null, number | null, number | null];
  clinicAddress: string | null;
};

export type DoctorDirectoryResponse = {
  ok: boolean;
  doctors: DoctorDirectoryRow[];
  nextCursor: string | null;
  hasMore: boolean;
  generatedAt: string;
  source: 'mssql' | 'firestore-cache';
  territoryCount: number;
  territoryId?: string;
  totals?: {
    byWeekDay: number[][];
    byWeek: number[];
    grandTotal: number;
    doctorCount: number;
  };
  message?: string;
};

export type DoctorActualCallsResponse = {
  ok: boolean;
  territoryId: string;
  cycle: DashboardCallMap['cycle'] | null;
  calls: Array<Pick<DashboardCallMapCall, 'id' | 'doctorId' | 'territoryId' | 'visitDate'> & { callDate: string }>;
  message?: string;
};

export type DashboardMetrics = {
  targetCalls: number | null;
  actualCalls: number | null;
  callRate: number | null;
  doctorsReached: number | null;
  doctorsPlanned: number | null;
  doctorsReachedRate: number | null;
};

export type DashboardCallMapCall = {
  id: string;
  sequence: number;
  doctorId: string;
  doctorName: string;
  psrId: string;
  territoryId: string;
  visitDate: string;
  timeLabel: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  displayLatitude: number | null;
  displayLongitude: number | null;
  gpsStatus: 'actual' | 'inferred' | 'missing';
  nodeId: string | null;
};

export type DashboardCallMapNode = {
  id: string;
  territoryId: string;
  sequenceStart: number;
  sequenceEnd: number;
  latitude: number;
  longitude: number;
  callIds: string[];
  hasInferredCalls: boolean;
};

export type DashboardCallMapTerritory = {
  territoryId: string;
  color: string;
  medRepName?: string | null;
  territoryDescription?: string | null;
  callCount: number;
  gpsCallCount: number;
  hasGpsCalls: boolean;
  faded: boolean;
  bounds?: [number, number, number, number] | null;
};

export type DashboardCallMapSequence = {
  territoryId: string;
  color: string;
  coordinates: Array<[number, number]>;
};

export type DashboardCallMapDay = {
  date: string;
  territories: DashboardCallMapTerritory[];
  calls: DashboardCallMapCall[];
  nodes: DashboardCallMapNode[];
  sequences: DashboardCallMapSequence[];
};

export type DashboardCallMap = {
  selectedDate: string;
  cycle: {
    periodKey: string;
    startDate: string;
    endDate: string;
  };
  days: Record<string, DashboardCallMapDay>;
  points?: DashboardCallMapCall[];
};

export type DashboardActivityPoint = {
  date: string;
  label: string;
  targetCalls: number;
  actualCalls: number;
};

export type DashboardActivityOverviewTerritory = {
  territoryId: string;
  territoryDescription?: string | null;
  medRepName?: string | null;
  points: DashboardActivityPoint[];
};

export type DashboardActivityOverview = {
  periodKey: string;
  startDate: string;
  endDate: string;
  xAxisTitle?: string;
  points: DashboardActivityPoint[];
  territories?: DashboardActivityOverviewTerritory[];
};

export type DashboardDataSource = {
  type: 'mssql';
  status: 'pending' | 'configured';
};

export type DashboardCacheMetadata = {
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

export type DashboardSummaryTerritory = {
  territoryId: string;
  territoryDescription?: string | null;
  medRepName?: string | null;
  metrics: DashboardMetrics;
};

export type DashboardSummary = {
  ok: boolean;
  clientSlug?: string | null;
  dataSource: DashboardDataSource;
  metrics: DashboardMetrics;
  territories?: DashboardSummaryTerritory[];
  message?: string;
  cache?: DashboardCacheMetadata;
};

export type DashboardCacheDocument = DashboardSummary & {
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
  sourceWatermark?: string | null;
  stale?: boolean;
  staleReason?: string | null;
  staleDetectedAt?: string | null;
  affectedTerritories?: string[];
};


export type DashboardCallMapCacheDocument = {
  ok: boolean;
  clientSlug?: string | null;
  callMap: DashboardCallMap | null;
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
  sourceWatermark?: string | null;
  cache?: DashboardCacheMetadata;
};

export type ReportFilterType = 'date' | 'text' | 'number' | 'boolean' | 'select';
export type ReportFilterDefinition = {
  id: string;
  label: string;
  type: ReportFilterType;
  required?: boolean;
  defaultValue?: string | number | boolean | null;
  options?: Array<{ label: string; value: string }>;
};

export type ReportColumnDefinition = {
  id: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'datetime' | 'boolean';
  align?: 'left' | 'right' | 'center';
  format?: string;
};

export type ReportDefinitionSummary = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  clientSlugs?: string[];
  filters: ReportFilterDefinition[];
  columns: ReportColumnDefinition[];
  outputs: Array<'html' | 'csv' | 'xlsx' | 'pdf'>;
};

export type ReportRunResult = {
  ok: boolean;
  report?: ReportDefinitionSummary;
  rows?: Record<string, unknown>[];
  rowCount?: number;
  truncated?: boolean;
  generatedAt?: string;
  message?: string;
};
