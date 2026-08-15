import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { authenticateUser, loginRequestSchema } from './auth.js';
import { checkDrupalMySQLConnection, debugDrupalMySQLAuth, debugDrupalMySQLUsersQuery } from './drupal-mysql-auth.js';
import { clearSessionCookie, createSessionToken, getSessionCookieDiagnostics, getSessionFromRequest, setSessionCookie } from './session.js';
import { DASHBOARD_VIEW_KEYS, readFreshDashboardActivityOverviewCache, readFreshDashboardCache, resolveDashboardScope, writeDashboardActivityOverviewCache, writeDashboardCache } from './dashboard-cache.js';
import { runDashboardCacheFreshnessCheck } from './cache-freshness.js';
import { checkClientMSSQLConnection, getClientUserTerritories, getDashboardActivityOverview, getDashboardCallMapScopeMetadata, getDashboardSummary, inspectClientMSSQLDashboardSchema } from './mssql-dashboard.js';
import { listReportDefinitions, runReportDefinition } from './report-engine.js';
import { getCallMapTerritoryDate } from './call-map-store.js';
import { doctorDirectoryQuerySchema, listDoctors } from './doctor-directory.js';


function clientSlugFromRequest(request: { headers: Record<string, string | string[] | undefined> }) {
  const firebaseHostingHost = request.headers['x-fh-requested-host'];
  const forwardedHost = request.headers['x-forwarded-host'];
  const rawHeader = firebaseHostingHost ?? forwardedHost ?? request.headers.host;
  const rawHost = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const host = String(rawHost ?? '').split(',')[0]?.split(':')[0]?.toLowerCase() ?? '';
  if (!host.endsWith('.idoxs.app')) return null;
  const labels = host.slice(0, -'.idoxs.app'.length).split('.').filter(Boolean);
  return labels[labels.length - 1] ?? null;
}


function resolveRequestClientSlug(request: { headers: Record<string, string | string[] | undefined> }, fallback?: string | null) {
  return clientSlugFromRequest(request) ?? fallback ?? null;
}

function sessionMatchesRequestClient(sessionClientSlug: string | null, requestClientSlug: string | null) {
  return !sessionClientSlug || !requestClientSlug || sessionClientSlug === requestClientSlug;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function buildApp() {
  const corsOrigin = process.env.CORS_ORIGIN ?? true;
  const app = Fastify({
    logger: true,
  });

  void app.register(helmet, {
    contentSecurityPolicy: false,
  });

  void app.register(cookie);

  void app.register(cors, {
    origin: corsOrigin,
    credentials: true,
  });

  app.get('/api/health', async () => ({ ok: true, service: 'doxs-api' }));

  app.get('/api/debug/db/:clientCode', async (request, reply) => {
    const params = request.params as { clientCode?: string };
    const result = await checkDrupalMySQLConnection(params.clientCode ?? '');
    return reply.status(result.ok ? 200 : 503).send(result);
  });

  app.post('/api/debug/auth', async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid login request.' });
    }

    const result = await debugDrupalMySQLAuth(parsed.data);
    return reply.status(result.status).send(result);
  });

  app.get('/api/debug/users/:clientCode', async (request, reply) => {
    const params = request.params as { clientCode?: string };
    const result = await debugDrupalMySQLUsersQuery(params.clientCode ?? '');
    return reply.status(result.ok ? 200 : 503).send(result);
  });



  const handleFirebaseToken = async (request: FastifyRequest, reply: FastifyReply) => {
    const session = getSessionFromRequest(request);
    if (!session) {
      return reply.status(401).send({ ok: false, message: 'Not authenticated.' });
    }

    const requestClientSlug = clientSlugFromRequest(request);
    if (!sessionMatchesRequestClient(session.clientSlug, requestClientSlug)) {
      clearSessionCookie(reply, request);
      return reply.status(401).send({ ok: false, message: 'Session client does not match this client domain.' });
    }

    const effectiveClientSlug = resolveRequestClientSlug(request, session.clientSlug);
    const territories = await getClientUserTerritories(effectiveClientSlug, session.username);
    const scope = resolveDashboardScope(session, effectiveClientSlug, territories);
    const { getAuth } = await import('firebase-admin/auth');
    const token = await getAuth().createCustomToken(`${scope.clientId}:${scope.userId}`, {
      clientId: scope.clientId,
      userId: scope.userId,
      scopeHash: scope.scopeHash,
      roles: scope.roles,
    });
    return reply.status(200).send({ ok: true, token, scopeHash: scope.scopeHash, clientId: scope.clientId });
  };

  app.get('/api/firebase/token', handleFirebaseToken);
  app.post('/api/firebase/token', handleFirebaseToken);

  app.get('/api/dashboard/summary', async (request, reply) => {
    const session = getSessionFromRequest(request);
    if (!session) {
      return reply.status(401).send({ ok: false, message: 'Not authenticated.' });
    }

    const requestClientSlug = clientSlugFromRequest(request);
    if (!sessionMatchesRequestClient(session.clientSlug, requestClientSlug)) {
      clearSessionCookie(reply, request);
      return reply.status(401).send({ ok: false, message: 'Session client does not match this client domain.' });
    }

    const effectiveClientSlug = resolveRequestClientSlug(request, session.clientSlug);
    const territories = await getClientUserTerritories(effectiveClientSlug, session.username);
    const scope = resolveDashboardScope(session, effectiveClientSlug, territories);

    try {
      const cachedSummary = await readFreshDashboardCache(scope);
      if (cachedSummary) return reply.status(200).send(cachedSummary);
    } catch (error) {
      request.log.warn({ error, cachePath: scope.cachePath }, 'Failed to read dashboard Firestore cache; falling back to MSSQL refresh.');
    }

    const summary = await getDashboardSummary(effectiveClientSlug, territories);
    try {
      const cachedSummary = await writeDashboardCache(summary, scope);
      return reply.status(200).send({ ...summary, cache: cachedSummary.cache });
    } catch (error) {
      request.log.warn({ error }, 'Failed to write dashboard Firestore cache; returning live summary.');
      return reply.status(200).send({
        ...summary,
        cache: {
          cachePath: scope.cachePath,
          scopeHash: scope.scopeHash,
          scopeKey: scope.scopeKey,
          viewKey: DASHBOARD_VIEW_KEYS.summary,
          periodKey: scope.periodKey,
          businessRulesVersion: '1',
          generatedAt: new Date().toISOString(),
          expiresAt: new Date().toISOString(),
          source: 'api-fallback',
        },
      });
    }
  });


  app.get('/api/dashboard/activity-overview', async (request, reply) => {
    const session = getSessionFromRequest(request);
    if (!session) {
      return reply.status(401).send({ ok: false, message: 'Not authenticated.' });
    }

    const requestClientSlug = clientSlugFromRequest(request);
    if (!sessionMatchesRequestClient(session.clientSlug, requestClientSlug)) {
      clearSessionCookie(reply, request);
      return reply.status(401).send({ ok: false, message: 'Session client does not match this client domain.' });
    }

    const effectiveClientSlug = resolveRequestClientSlug(request, session.clientSlug);
    const territories = await getClientUserTerritories(effectiveClientSlug, session.username);
    const scope = resolveDashboardScope(session, effectiveClientSlug, territories);

    try {
      const cachedActivityOverview = await readFreshDashboardActivityOverviewCache(scope);
      if (cachedActivityOverview) return reply.status(200).send(cachedActivityOverview);
    } catch (error) {
      request.log.warn({ error, cachePath: scope.cachePath, viewKey: DASHBOARD_VIEW_KEYS.activityOverview }, 'Failed to read dashboard activity overview Firestore cache; falling back to MSSQL refresh.');
    }

    const result = await getDashboardActivityOverview(effectiveClientSlug, territories);
    try {
      const cachedActivityOverview = await writeDashboardActivityOverviewCache(result, scope);
      return reply.status(result.ok ? 200 : 503).send({ ...result, cache: cachedActivityOverview.cache });
    } catch (error) {
      request.log.warn({ error, viewKey: DASHBOARD_VIEW_KEYS.activityOverview }, 'Failed to write dashboard activity overview Firestore cache; returning live result.');
      return reply.status(result.ok ? 200 : 503).send(result);
    }
  });


  app.get('/api/dashboard/call-map', async (request, reply) => {
    const session = getSessionFromRequest(request);
    if (!session) {
      return reply.status(401).send({ ok: false, message: 'Not authenticated.' });
    }

    const requestClientSlug = clientSlugFromRequest(request);
    if (!sessionMatchesRequestClient(session.clientSlug, requestClientSlug)) {
      clearSessionCookie(reply, request);
      return reply.status(401).send({ ok: false, message: 'Session client does not match this client domain.' });
    }

    const effectiveClientSlug = resolveRequestClientSlug(request, session.clientSlug);
    const territories = await getClientUserTerritories(effectiveClientSlug, session.username);
    const metadata = await getDashboardCallMapScopeMetadata(effectiveClientSlug, territories);
    const effectiveTerritories = territories.length > 0 ? territories : metadata.territories;
    return reply.status(metadata.ok ? 200 : 503).send({
      ...metadata,
      territories: effectiveTerritories,
      message: metadata.ok ? 'Call map scope loaded. Territory map data is loaded independently.' : metadata.message,
    });
  });

  app.get('/api/dashboard/call-map/territory/:territoryId', async (request, reply) => {
    const session = getSessionFromRequest(request);
    if (!session) {
      return reply.status(401).send({ ok: false, message: 'Not authenticated.' });
    }

    const requestClientSlug = clientSlugFromRequest(request);
    if (!sessionMatchesRequestClient(session.clientSlug, requestClientSlug)) {
      clearSessionCookie(reply, request);
      return reply.status(401).send({ ok: false, message: 'Session client does not match this client domain.' });
    }

    const params = request.params as { territoryId?: string };
    const query = request.query as { date?: string };
    const territoryId = String(params.territoryId ?? '').trim();
    const date = String(query.date ?? '').trim();
    if (!territoryId || !date) return reply.status(400).send({ ok: false, message: 'territoryId and date are required.' });

    const effectiveClientSlug = resolveRequestClientSlug(request, session.clientSlug);

    try {
      const doc = await getCallMapTerritoryDate(effectiveClientSlug ?? 'default', territoryId, date);
      return reply.status(200).send(doc);
    } catch (error) {
      request.log.warn({ error, territoryId, date }, 'Failed to load call map territory/date document.');
      return reply.status(503).send({ ok: false, territoryId, date, message: error instanceof Error ? error.message : 'Call map territory/date unavailable.' });
    }
  });



  app.post('/api/debug/cache-freshness/run', async (request, reply) => {
    const expectedToken = process.env.CACHE_FRESHNESS_DEBUG_TOKEN;
    if (!expectedToken || request.headers['x-cache-freshness-token'] !== expectedToken) {
      return reply.status(404).send({ ok: false, message: 'Not found.' });
    }
    const result = await runDashboardCacheFreshnessCheck(app.log);
    return reply.status(200).send({ ok: true, result });
  });

  app.get('/api/debug/mssql/:clientCode', async (request, reply) => {
    const params = request.params as { clientCode?: string };
    const result = await checkClientMSSQLConnection(params.clientCode ?? '');
    return reply.status(result.ok ? 200 : result.configured ? 503 : 404).send(result);
  });


  app.get('/api/debug/mssql-schema/:clientCode', async (request, reply) => {
    const params = request.params as { clientCode?: string };
    const result = await inspectClientMSSQLDashboardSchema(params.clientCode ?? '');
    return reply.status(result.ok ? 200 : result.configured ? 503 : 404).send(result);
  });


  app.get('/api/debug/dashboard/:clientCode', async (request, reply) => {
    const params = request.params as { clientCode?: string };
    const result = await getDashboardSummary(params.clientCode ?? '');
    return reply.status(200).send(result);
  });


  app.get('/api/debug/session', async (request, reply) => {
    return reply.status(200).send({
      ok: true,
      hostClientSlug: clientSlugFromRequest(request),
      diagnostics: getSessionCookieDiagnostics(request),
      cookieHeaderPresent: Boolean(request.headers.cookie),
    });
  });


  app.get('/api/debug/set-cookie-test', async (_request, reply) => {
    reply.setCookie('idoxs_cookie_test', 'ok', {
      httpOnly: false,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 600,
    });
    return reply.status(200).send({ ok: true, message: 'Cookie test set.' });
  });

  app.get('/api/debug/cookie-test', async (request, reply) => {
    return reply.status(200).send({
      ok: true,
      cookieHeaderPresent: Boolean(request.headers.cookie),
      testCookiePresent: request.cookies?.idoxs_cookie_test === 'ok',
      sessionCookiePresent: Boolean(request.cookies?.__session),
    });
  });

  app.get('/api/auth/me', async (request, reply) => {
    const session = getSessionFromRequest(request);
    if (!session) {
      return reply.status(401).send({ ok: false, message: 'Not authenticated.' });
    }

    const requestClientSlug = clientSlugFromRequest(request);
    if (!sessionMatchesRequestClient(session.clientSlug, requestClientSlug)) {
      clearSessionCookie(reply, request);
      return reply.status(401).send({ ok: false, message: 'Session client does not match this client domain.' });
    }

    return reply.status(200).send({
      ok: true,
      user: {
        username: session.username,
        displayName: session.displayName,
        roles: session.roles,
      },
      clientSlug: resolveRequestClientSlug(request, session.clientSlug),
    });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        message: parsed.error.issues[0]?.message ?? 'Invalid login request.',
      });
    }

    const effectiveClientSlug = resolveRequestClientSlug(request, parsed.data.clientCode ?? null);
    const loginPayload = { ...parsed.data, clientCode: effectiveClientSlug ?? parsed.data.clientCode };

    let result;
    try {
      result = await withTimeout(
        authenticateUser(loginPayload),
        Number(process.env.AUTH_TIMEOUT_MS ?? 8_000),
        'Authentication service timed out while connecting to the client database.',
      );
    } catch (error) {
      request.log.error({ error, clientSlug: effectiveClientSlug, username: parsed.data.username }, 'authentication failed before credential decision');
      return reply.status(504).send({
        ok: false,
        message: 'Authentication service is temporarily unavailable. Please try again shortly.',
      });
    }

    if (!result.ok || !result.user) {
      return reply.status(result.status).send({ ok: false, message: result.message });
    }

    const token = createSessionToken({
      username: result.user.username,
      displayName: result.user.displayName,
      roles: result.user.roles,
      clientSlug: effectiveClientSlug,
    });
    setSessionCookie(reply, request, token);

    return reply.status(200).send({ ok: true, user: result.user, clientSlug: effectiveClientSlug });
  });

  app.get('/api/reports', async (request, reply) => {
    const session = getSessionFromRequest(request);
    if (!session) {
      return reply.status(401).send({ ok: false, message: 'Not authenticated.' });
    }

    const requestClientSlug = clientSlugFromRequest(request);
    if (!sessionMatchesRequestClient(session.clientSlug, requestClientSlug)) {
      clearSessionCookie(reply, request);
      return reply.status(401).send({ ok: false, message: 'Session client does not match this client domain.' });
    }

    const effectiveClientSlug = resolveRequestClientSlug(request, session.clientSlug);
    const territories = await getClientUserTerritories(effectiveClientSlug, session.username);
    const reports = await listReportDefinitions({
      username: session.username,
      roles: session.roles,
      clientSlug: effectiveClientSlug,
      territories,
    });
    return reply.status(200).send({ ok: true, reports });
  });

  app.get('/api/doctors', async (request, reply) => {
    const session = getSessionFromRequest(request);
    if (!session) return reply.status(401).send({ ok: false, message: 'Not authenticated.' });

    const requestClientSlug = clientSlugFromRequest(request);
    if (!sessionMatchesRequestClient(session.clientSlug, requestClientSlug)) {
      clearSessionCookie(reply, request);
      return reply.status(401).send({ ok: false, message: 'Session client does not match this client domain.' });
    }

    const parsed = doctorDirectoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid doctor directory request.' });
    }

    const effectiveClientSlug = resolveRequestClientSlug(request, session.clientSlug);
    const territories = await getClientUserTerritories(effectiveClientSlug, session.username);
    const isManager = session.roles.some((role) => /admin|manager|district|region/i.test(role));
    if (!territories.length && !isManager) {
      return reply.status(403).send({ ok: false, message: 'No territory scope is assigned to this user.' });
    }

    try {
      const result = await listDoctors(effectiveClientSlug, territories, parsed.data);
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error, clientSlug: effectiveClientSlug, username: session.username }, 'doctor directory request failed');
      return reply.status(503).send({ ok: false, message: error instanceof Error ? error.message : 'Doctor directory is temporarily unavailable.' });
    }
  });

  app.get('/api/reports/:reportId/run', async (request, reply) => {
    const session = getSessionFromRequest(request);
    if (!session) {
      return reply.status(401).send({ ok: false, message: 'Not authenticated.' });
    }

    const requestClientSlug = clientSlugFromRequest(request);
    if (!sessionMatchesRequestClient(session.clientSlug, requestClientSlug)) {
      clearSessionCookie(reply, request);
      return reply.status(401).send({ ok: false, message: 'Session client does not match this client domain.' });
    }

    const params = request.params as { reportId?: string };
    const effectiveClientSlug = resolveRequestClientSlug(request, session.clientSlug);
    const territories = await getClientUserTerritories(effectiveClientSlug, session.username);
    try {
      const result = await runReportDefinition(params.reportId ?? '', {
        username: session.username,
        roles: session.roles,
        clientSlug: effectiveClientSlug,
        territories,
      }, request.query as Record<string, unknown>);
      return reply.status(result.ok ? 200 : 400).send(result);
    } catch (error) {
      request.log.error({ error, reportId: params.reportId, clientSlug: effectiveClientSlug }, 'report execution failed');
      return reply.status(500).send({ ok: false, message: error instanceof Error ? error.message : 'Report execution failed.' });
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    clearSessionCookie(reply, request);
    return reply.status(200).send({ ok: true });
  });

  return app;
}
