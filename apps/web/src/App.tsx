import { Component, type ErrorInfo, FormEvent, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LockKeyhole, LogOut, ShieldCheck } from 'lucide-react';
import { getCurrentSession, login, logout } from './api';
import { Button } from './components/ui/Button';
import { Input } from './components/ui/Input';
import type { AuthSession } from './lib/auth';
import { getClientContext, getDisplayClientName } from './lib/client';

const Dashboard = lazy(() => import('./components/Dashboard').then((module) => ({ default: module.Dashboard })));
const ReportsPage = lazy(() => import('./components/ReportsPage').then((module) => ({ default: module.ReportsPage })));

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Dashboard render failed', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 shadow-sm">
          <p className="font-semibold">Dashboard could not render after login.</p>
          <p className="mt-2">The session is active, but a browser-side module crashed. Please refresh once; if it repeats, this panel will keep the page visible while we inspect logs.</p>
          <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-white/70 p-3 text-xs text-red-700">{this.state.error.message}</pre>
          <button type="button" className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}


function normalizePath(pathname: string) {
  if (pathname === '/reports' || pathname.startsWith('/reports/')) return '/reports';
  if (pathname === '/login') return '/login';
  return '/';
}

function navigate(path: string) {
  if (window.location.pathname === path) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function AppShell({ session, activePath, onLogout }: { session: AuthSession; activePath: string; onLogout: () => void }) {
  const activeClientName = getDisplayClientName(session.clientSlug);
  const isReports = activePath === '/reports';

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-brand-600">
              <span>{activeClientName} Console</span>
              <span className="text-slate-300">•</span>
              <span className="inline-flex items-center gap-1 text-emerald-600"><ShieldCheck className="h-4 w-4" /> Authenticated</span>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{isReports ? 'Reports' : 'Dashboard'}</h1>
            <p className="mt-1 text-sm text-slate-500">Welcome, {session.user.displayName}. This workspace is scoped to {activeClientName}.</p>
          </div>
          <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" onClick={onLogout}>
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl space-y-6 px-4 py-6 lg:px-8">
        <nav className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm" aria-label="Primary">
          <button
            type="button"
            onClick={() => navigate('/')}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${!isReports ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => navigate('/reports')}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${isReports ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            Reports
          </button>
        </nav>

        <AppErrorBoundary>
          <Suspense fallback={<div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Loading…</div>}>
            {isReports ? <ReportsPage clientName={activeClientName} /> : <Dashboard session={session} />}
          </Suspense>
        </AppErrorBoundary>
      </section>
    </main>
  );
}

function syncRouteWithSession(session: AuthSession | null, checkedSession: boolean, setActivePath: (path: string) => void) {
  if (!checkedSession) return;

  if (!session && window.location.pathname !== '/login') {
    window.history.replaceState(null, '', '/login');
    setActivePath('/login');
    return;
  }

  if (session && window.location.pathname === '/login') {
    window.history.replaceState(null, '', '/');
    setActivePath('/');
  }
}

export default function App() {
  const client = useMemo(() => getClientContext(), []);
  const clientName = getDisplayClientName(client.clientSlug);
  const [checkedSession, setCheckedSession] = useState(false);
  const [activePath, setActivePath] = useState(() => normalizePath(window.location.pathname));
  const [session, setSession] = useState<AuthSession | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clientCode, setClientCode] = useState(client.clientSlug ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    function handlePopState() {
      setActivePath(normalizePath(window.location.pathname));
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      const result = await getCurrentSession();
      if (cancelled) return;
      if (result.ok && result.user) {
        setSession({ user: result.user, clientSlug: result.clientSlug ?? null });
      }
      setCheckedSession(true);
    }

    void checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    syncRouteWithSession(session, checkedSession, setActivePath);
  }, [session, checkedSession]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setMessage(null);
    setIsError(false);

    const effectiveClientCode = client.clientSlug ?? (clientCode || undefined);
    let result;
    try {
      result = await login({ username, password, clientCode: effectiveClientCode });
    } catch (error) {
      setIsLoading(false);
      setIsError(true);
      setMessage(error instanceof Error ? error.message : 'Login request failed.');
      return;
    }

    setIsLoading(false);
    if (!result.ok || !result.user) {
      setIsError(true);
      setMessage(result.message ?? 'Login failed.');
      return;
    }

    setSession({ user: result.user, clientSlug: result.clientSlug ?? effectiveClientCode ?? null });
    window.history.replaceState(null, '', '/');
    setActivePath('/');
  }

  async function handleLogout() {
    await logout();
    setSession(null);
    window.history.replaceState(null, '', '/login');
    setActivePath('/login');
  }

  if (!checkedSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-sm text-slate-500">
        Checking session…
      </main>
    );
  }

  if (session) {
    return <AppShell session={session} activePath={activePath} onLogout={handleLogout} />;
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_34%),linear-gradient(135deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-10">
      <section className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-10 lg:grid-cols-[1fr_440px]">
        <div className="hidden lg:block">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white/70 px-4 py-2 text-sm font-medium text-blue-700 shadow-sm backdrop-blur">
            <ShieldCheck className="h-4 w-4" />
            {client.clientSlug ? `${clientName} · idoxs.app` : 'Modern production UI rewrite'}
          </div>
          <h1 className="max-w-2xl text-5xl font-bold tracking-tight text-slate-950">
            {clientName} field operations console.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
            Sign in to continue. The client context is resolved from the subdomain, e.g. client.idoxs.app.
          </p>
          <div className="mt-8 grid max-w-xl gap-3 text-sm text-slate-600">
            <div className="rounded-xl border border-white/70 bg-white/70 p-4 shadow-sm backdrop-blur">
              If a user is not logged in, protected routes redirect to <span className="font-mono">/login</span>.
            </div>
            <div className="rounded-xl border border-white/70 bg-white/70 p-4 shadow-sm backdrop-blur">
              Browser UI talks only to the Node API bridge — not directly to MSSQL/MySQL.
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-md rounded-2xl border border-white/80 bg-white/90 p-8 shadow-soft backdrop-blur">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-blue-200">
              <LockKeyhole className="h-7 w-7" />
            </div>
            <h2 className="text-2xl font-bold text-slate-950">Sign in to {clientName}</h2>
            <p className="mt-2 text-sm text-slate-500">Use your production account credentials.</p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            {!client.clientSlug ? (
              <Input
                label="Client / company code"
                name="clientCode"
                autoComplete="organization"
                placeholder="Required on localhost/root domain"
                value={clientCode}
                onChange={(event) => setClientCode(event.target.value)}
              />
            ) : null}
            <Input
              label="Username"
              name="username"
              autoComplete="username"
              placeholder="e.g. RR143"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <Input
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            {message ? (
              <div className={`rounded-lg border px-3 py-2 text-sm ${isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                {message}
              </div>
            ) : null}

            <Button type="submit" isLoading={isLoading}>Login</Button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-400">
            {client.hostname} · Secure API session
          </p>
        </div>
      </section>
    </main>
  );
}
