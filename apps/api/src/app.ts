import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { authenticateUser, loginRequestSchema } from './auth.js';
import { checkDrupalMySQLConnection, debugDrupalMySQLAuth, debugDrupalMySQLUsersQuery } from './drupal-mysql-auth.js';
import { clearSessionCookie, createSessionToken, getSessionCookieDiagnostics, getSessionFromRequest, setSessionCookie } from './session.js';
import { DASHBOARD_VIEW_KEYS, readFreshDashboardActivityOverviewCache, readFreshDashboardCache, resolveDashboardScope, viewCachePath, writeDashboardActivityOverviewCache, writeDashboardCache, type DashboardScope } from './dashboard-cache.js';
import { runDashboardCacheFreshnessCheck } from './cache-freshness.js';
import { checkClientMSSQLConnection, getClientUserTerritories, getDashboardActivityOverview, getDashboardCallMap, getDashboardCallMapScopeMetadata, getDashboardSummary, inspectClientMSSQLDashboardSchema } from './mssql-dashboard.js';
import { listReportDefinitions, runReportDefinition } from './report-engine.js';
import { getCallMapTerritoryDate } from './call-map-store.js';
import { doctorDirectoryQuerySchema, listDoctorTerritories } from './doctor-directory.js';
import { getDoctorTerritoryDirectory } from './doctor-directory-cache.js';
import { getAdminFirestore } from './firestore-admin.js';
import { getUserTerritoriesFirestoreFirst } from './user-territory-replica.js';



const CALL_MAP_SCOPE_CACHE_TTL_MS = Number(process.env.CALL_MAP_SCOPE_CACHE_TTL_MS ?? 60 * 60 * 1000);

function apiNow() {
  return Date.now();
}

function apiIso(offsetMs = 0) {
  return new Date(apiNow() + offsetMs).toISOString();
}

function safeDocSegment(value: string | null | undefined, fallback = 'unknown') {
  return String(value || fallback).replace(/[^a-zA-Z0-9_-]/g, '_') || fallback;
}

async function getCachedClientUserTerritories(clientSlug: string | null | undefined, userId: string, logger: FastifyRequest['log']) {
  try {
    return await getUserTerritoriesFirestoreFirst(clientSlug, userId);
  } catch (error) {
    logger.warn({ error, clientSlug, userId }, 'Failed to read Firestore user territory replica; falling back to MSSQL directly.');
    const territories = await getClientUserTerritories(clientSlug, userId);
    return { territories, source: 'mssql-direct-fallback' as const, cachePath: null };
  }
}

type CachedCallMapScope = {
  ok: boolean;
  clientSlug?: string | null;
  cycle: Awaited<ReturnType<typeof getDashboardCallMapScopeMetadata>>['cycle'];
  selectedDate: string;
  territories: string[];
  message?: string;
  cache?: { cachePath: string; source: 'firestore-cache' | 'mssql-refresh'; generatedAt: string; expiresAt: string };
};

async function readCallMapScopeCache(scope: DashboardScope): Promise<CachedCallMapScope | null> {
  const cachePath = viewCachePath(scope, 'callMapScope');
  const snapshot = await getAdminFirestore().doc(cachePath).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as CachedCallMapScope | undefined;
  if (!data?.cache?.expiresAt || Date.parse(data.cache.expiresAt) <= Date.now()) return null;
  return { ...data, cache: { ...data.cache, source: 'firestore-cache' } };
}

async function writeCallMapScopeCache(scope: DashboardScope, metadata: Awaited<ReturnType<typeof getDashboardCallMapScopeMetadata>>, territories: string[]): Promise<CachedCallMapScope> {
  const generatedAt = apiIso();
  const expiresAt = apiIso(CALL_MAP_SCOPE_CACHE_TTL_MS);
  const cachePath = viewCachePath(scope, 'callMapScope');
  const doc: CachedCallMapScope = {
    ...metadata,
    territories,
    cache: { cachePath, source: 'mssql-refresh', generatedAt, expiresAt },
  };
  await getAdminFirestore().doc(cachePath).set(JSON.parse(JSON.stringify(doc)), { merge: true });
  return doc;
}

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
    const territoryScope = await getCachedClientUserTerritories(effectiveClientSlug, session.username, request.log);
    const territories = territoryScope.territories;
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
    const territoryScope = await getCachedClientUserTerritories(effectiveClientSlug, session.username, request.log);
    const territories = territoryScope.territories;
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
    const territoryScope = await getCachedClientUserTerritories(effectiveClientSlug, session.username, request.log);
    const territories = territoryScope.territories;
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
    const territoryScope = await getCachedClientUserTerritories(effectiveClientSlug, session.username, request.log);
    const territories = territoryScope.territories;
    const scope = resolveDashboardScope(session, effectiveClientSlug, territories);

    try {
      const cachedScope = await readCallMapScopeCache(scope);
      if (cachedScope) {
        const effectiveTerritories = territories.length > 0 ? territories : cachedScope.territories;
        return reply.status(cachedScope.ok ? 200 : 503).send({
          ...cachedScope,
          territories: effectiveTerritories,
          message: cachedScope.ok ? 'Call map scope loaded from Firestore. Territory map data is loaded independently.' : cachedScope.message,
        });
      }
    } catch (error) {
      request.log.warn({ error, cachePath: viewCachePath(scope, 'callMapScope') }, 'Failed to read Firestore call map scope cache; falling back to MSSQL.');
    }

    const metadata = await getDashboardCallMapScopeMetadata(effectiveClientSlug, territories);
    const effectiveTerritories = territories.length > 0 ? territories : metadata.territories;
    try {
      const cachedScope = await writeCallMapScopeCache(scope, metadata, effectiveTerritories);
      return reply.status(metadata.ok ? 200 : 503).send({
        ...cachedScope,
        message: metadata.ok ? 'Call map scope loaded from MSSQL and cached. Territory map data is loaded independently.' : metadata.message,
      });
    } catch (error) {
      request.log.warn({ error, cachePath: viewCachePath(scope, 'callMapScope') }, 'Failed to write Firestore call map scope cache.');
      return reply.status(metadata.ok ? 200 : 503).send({
        ...metadata,
        territories: effectiveTerritories,
        message: metadata.ok ? 'Call map scope loaded. Territory map data is loaded independently.' : metadata.message,
      });
    }
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
    const territoryScope = await getCachedClientUserTerritories(effectiveClientSlug, session.username, request.log);
    const territories = territoryScope.territories;
    const reports = await listReportDefinitions({
      username: session.username,
      roles: session.roles,
      clientSlug: effectiveClientSlug,
      territories,
    });
    return reply.status(200).send({ ok: true, reports });
  });

  app.get('/api/doctors/territories', async (request, reply) => {
    const session = getSessionFromRequest(request);
    if (!session) return reply.status(401).send({ ok: false, message: 'Not authenticated.' });
    const requestClientSlug = clientSlugFromRequest(request);
    if (!sessionMatchesRequestClient(session.clientSlug, requestClientSlug)) {
      clearSessionCookie(reply, request);
      return reply.status(401).send({ ok: false, message: 'Session client does not match this client domain.' });
    }
    const effectiveClientSlug = resolveRequestClientSlug(request, session.clientSlug);
    const territoryScope = await getCachedClientUserTerritories(effectiveClientSlug, session.username, request.log);
    const assigned = territoryScope.territories;
    const isManager = session.roles.some((role) => /admin|manager|district|region/i.test(role));
    if (!assigned.length && !isManager) return reply.status(403).send({ ok: false, message: 'No territory scope is assigned to this user.' });
    try {
      const territories = assigned.length ? [...assigned].sort() : await listDoctorTerritories(effectiveClientSlug);
      return reply.status(200).send({ ok: true, territories, scope: { source: territoryScope.source, cachePath: territoryScope.cachePath } });
    } catch (error) {
      request.log.error({ error, clientSlug: effectiveClientSlug, username: session.username }, 'doctor territory request failed');
      return reply.status(503).send({ ok: false, message: 'Doctor territories are temporarily unavailable.' });
    }
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
    const territoryScope = await getCachedClientUserTerritories(effectiveClientSlug, session.username, request.log);
    const territories = territoryScope.territories;
    const isManager = session.roles.some((role) => /admin|manager|district|region/i.test(role));
    if (!territories.length && !isManager) {
      return reply.status(403).send({ ok: false, message: 'No territory scope is assigned to this user.' });
    }

    const territoryId = parsed.data.territory;
    if (!territoryId) return reply.status(400).send({ ok: false, message: 'territory is required.' });
    if (territories.length && !territories.includes(territoryId)) {
      return reply.status(403).send({ ok: false, message: 'Territory is outside this user scope.' });
    }

    try {
      const result = await getDoctorTerritoryDirectory(effectiveClientSlug, territoryId, parsed.data);
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error, clientSlug: effectiveClientSlug, username: session.username }, 'doctor directory request failed');
      return reply.status(503).send({ ok: false, message: error instanceof Error ? error.message : 'Doctor directory is temporarily unavailable.' });
    }
  });

  app.get('/api/doctors/actual-calls', async (request, reply) => {
    const session = getSessionFromRequest(request);
    if (!session) return reply.status(401).send({ ok: false, message: 'Not authenticated.' });

    const requestClientSlug = clientSlugFromRequest(request);
    if (!sessionMatchesRequestClient(session.clientSlug, requestClientSlug)) {
      clearSessionCookie(reply, request);
      return reply.status(401).send({ ok: false, message: 'Session client does not match this client domain.' });
    }

    const territoryId = String((request.query as { territory?: string }).territory ?? '').trim();
    if (!territoryId) return reply.status(400).send({ ok: false, message: 'territory is required.' });

    const effectiveClientSlug = resolveRequestClientSlug(request, session.clientSlug);
    const territoryScope = await getCachedClientUserTerritories(effectiveClientSlug, session.username, request.log);
    const territories = territoryScope.territories;
    const isManager = session.roles.some((role) => /admin|manager|district|region/i.test(role));
    if (!territories.length && !isManager) return reply.status(403).send({ ok: false, message: 'No territory scope is assigned to this user.' });
    if (territories.length && !territories.includes(territoryId)) return reply.status(403).send({ ok: false, message: 'Territory is outside this user scope.' });

    try {
      const result = await getDashboardCallMap(effectiveClientSlug, [territoryId]);
      if (!result.ok || !result.callMap) return reply.status(503).send({ ok: false, territoryId, cycle: null, calls: [], message: result.message ?? 'Actual calls are unavailable.' });
      const calls = Object.entries(result.callMap.days).flatMap(([callDate, day]) => day.calls.map(({ id, doctorId, territoryId: callTerritoryId, visitDate }) => ({
        id,
        doctorId,
        territoryId: callTerritoryId,
        visitDate,
        callDate,
      })));
      return reply.status(200).send({ ok: true, territoryId, cycle: result.callMap.cycle, calls });
    } catch (error) {
      request.log.error({ error, clientSlug: effectiveClientSlug, territoryId }, 'doctor actual calls request failed');
      return reply.status(503).send({ ok: false, territoryId, cycle: null, calls: [], message: 'Actual calls are temporarily unavailable.' });
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
    const territoryScope = await getCachedClientUserTerritories(effectiveClientSlug, session.username, request.log);
    const territories = territoryScope.territories;
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
