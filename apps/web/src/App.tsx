import { FormEvent, useEffect, useMemo, useState } from 'react';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { getCurrentSession, login, logout } from './api';
import { Dashboard } from './components/Dashboard';
import { Button } from './components/ui/Button';
import { Input } from './components/ui/Input';
import type { AuthSession } from './lib/auth';
import { getClientContext, getDisplayClientName } from './lib/client';

function syncRouteWithSession(session: AuthSession | null, checkedSession: boolean) {
  if (!checkedSession) return;

  if (!session && window.location.pathname !== '/login') {
    window.history.replaceState(null, '', '/login');
    return;
  }

  if (session && window.location.pathname === '/login') {
    window.history.replaceState(null, '', '/');
  }
}

export default function App() {
  const client = useMemo(() => getClientContext(), []);
  const clientName = getDisplayClientName(client.clientSlug);
  const [checkedSession, setCheckedSession] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clientCode, setClientCode] = useState(client.clientSlug ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

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
    syncRouteWithSession(session, checkedSession);
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
  }

  async function handleLogout() {
    await logout();
    setSession(null);
    window.history.replaceState(null, '', '/login');
  }

  if (!checkedSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-sm text-slate-500">
        Checking session…
      </main>
    );
  }

  if (session) {
    return <Dashboard session={session} onLogout={handleLogout} />;
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
