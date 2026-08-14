import type { DashboardActivityOverview, DashboardCallMap, DashboardCallMapDay, DashboardSummary, DoctorDirectoryResponse, LoginUser, ReportDefinitionSummary, ReportRunResult } from '@doxs/shared';

export type { DashboardSummary, ReportDefinitionSummary, ReportRunResult } from '@doxs/shared';
export type { DoctorDirectoryResponse, DoctorDirectoryRow } from '@doxs/shared';

type LoginRequest = {
  username: string;
  password: string;
  clientCode?: string;
};

export type AuthResponse = {
  ok: boolean;
  user?: LoginUser;
  clientSlug?: string | null;
  message?: string;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
const REQUEST_TIMEOUT_MS = 30_000;

async function fetchJson(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function login(payload: LoginRequest): Promise<AuthResponse> {
  const response = await fetchJson(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as AuthResponse;
  if (!response.ok) {
    return { ok: false, message: data.message ?? 'Login failed. Please check your credentials.' };
  }
  return data;
}

export async function getCurrentSession(): Promise<AuthResponse> {
  const response = await fetchJson(`${API_BASE}/auth/me`, {
    method: 'GET',
    credentials: 'include',
  });

  const data = (await response.json()) as AuthResponse;
  if (!response.ok) return { ok: false, message: data.message ?? 'Not authenticated.' };
  return data;
}

export async function logout(): Promise<void> {
  await fetchJson(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const response = await fetchJson(`${API_BASE}/dashboard/summary`, {
    method: 'GET',
    credentials: 'include',
  });

  const data = (await response.json()) as DashboardSummary;
  if (!response.ok) {
    throw new Error(data.message ?? 'Dashboard request failed.');
  }
  return data;
}

export async function getDoctors(params: { letter?: string; search?: string; cursor?: string; limit?: number }): Promise<DoctorDirectoryResponse> {
  const query = new URLSearchParams();
  if (params.letter) query.set('letter', params.letter);
  if (params.search) query.set('search', params.search);
  if (params.cursor) query.set('cursor', params.cursor);
  query.set('limit', String(params.limit ?? 50));
  const response = await fetchJson(`${API_BASE}/doctors?${query.toString()}`, { method: 'GET', credentials: 'include' });
  const data = (await response.json()) as DoctorDirectoryResponse;
  if (!response.ok) throw new Error(data.message ?? 'Doctor directory request failed.');
  return data;
}


export type DashboardActivityOverviewResponse = {
  ok: boolean;
  clientSlug?: string | null;
  activityOverview?: DashboardActivityOverview | null;
  message?: string;
};

export async function getDashboardActivityOverview(): Promise<DashboardActivityOverviewResponse> {
  const response = await fetchJson(`${API_BASE}/dashboard/activity-overview`, {
    method: 'GET',
    credentials: 'include',
  });

  const data = (await response.json()) as DashboardActivityOverviewResponse;
  if (!response.ok) return { ok: false, message: data.message ?? 'Activity overview request failed.', activityOverview: null };
  return data;
}


export type DashboardCallMapScopeResponse = {
  ok: boolean;
  clientSlug?: string | null;
  territories: string[];
  selectedDate?: string;
  cycle?: DashboardCallMap['cycle'] | null;
  message?: string;
};

export type DashboardCallMapTerritoryDateResponse = {
  ok: boolean;
  clientSlug?: string | null;
  territoryId: string;
  date: string;
  cycle?: DashboardCallMap['cycle'];
  day?: DashboardCallMapDay;
  source?: 'firestore-cache' | 'mssql-refresh';
  cachePath?: string;
  message?: string;
};

export async function getDashboardCallMapScope(): Promise<DashboardCallMapScopeResponse> {
  const response = await fetchJson(`${API_BASE}/dashboard/call-map`, {
    method: 'GET',
    credentials: 'include',
  });

  const data = (await response.json()) as DashboardCallMapScopeResponse;
  if (!response.ok) return { ok: false, message: data.message ?? 'Call map scope request failed.', territories: [] };
  return data;
}

export async function getDashboardCallMapTerritoryDate(territoryId: string, date: string): Promise<DashboardCallMapTerritoryDateResponse> {
  const response = await fetchJson(`${API_BASE}/dashboard/call-map/territory/${encodeURIComponent(territoryId)}?date=${encodeURIComponent(date)}`, {
    method: 'GET',
    credentials: 'include',
  });

  const data = (await response.json()) as DashboardCallMapTerritoryDateResponse;
  if (!response.ok) return { ok: false, territoryId, date, message: data.message ?? 'Call map territory request failed.' };
  return data;
}


export type ReportsListResponse = {
  ok: boolean;
  reports?: ReportDefinitionSummary[];
  message?: string;
};

export async function listReports(): Promise<ReportsListResponse> {
  const response = await fetchJson(`${API_BASE}/reports`, {
    method: 'GET',
    credentials: 'include',
  });

  const data = (await response.json()) as ReportsListResponse;
  if (!response.ok) return { ok: false, message: data.message ?? 'Reports request failed.' };
  return data;
}

export async function runReport(reportId: string, filters: Record<string, string>): Promise<ReportRunResult> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '') params.set(key, value);
  }
  const response = await fetchJson(`${API_BASE}/reports/${encodeURIComponent(reportId)}/run?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
  });

  const data = (await response.json()) as ReportRunResult;
  if (!response.ok) return { ok: false, message: data.message ?? 'Report execution failed.', report: data.report };
  return data;
}
