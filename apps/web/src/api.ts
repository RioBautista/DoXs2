import type { DashboardSummary, LoginUser } from '@doxs/shared';

export type { DashboardSummary } from '@doxs/shared';

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
