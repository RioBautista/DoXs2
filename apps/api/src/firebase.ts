import type { IncomingMessage, ServerResponse } from 'node:http';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { buildApp } from './app.js';
import { runDashboardCacheFreshnessCheck } from './cache-freshness.js';
import { runDoctorTmlCacheRefresh } from './doctor-directory.js';
import { runUserTerritoryReplicaRefresh } from './user-territory-replica.js';

const app = buildApp();
const appReady = app.ready();

const DOXS_API_SECRETS = [
  'AUTH_MODE',
  'DEV_LOGIN_MOCK',
  'MYSQL_INSECURE_AUTH',
  'SESSION_SECRET',
  'IDOXS_CLIENT_DEMO_MYSQL_HOST',
  'IDOXS_CLIENT_DEMO_MYSQL_PORT',
  'IDOXS_CLIENT_DEMO_MYSQL_USER',
  'IDOXS_CLIENT_DEMO_MYSQL_PASSWORD',
  'IDOXS_CLIENT_DEMO_MYSQL_DATABASE',
  'IDOXS_CLIENT_DEMO_MSSQL_HOST',
  'IDOXS_CLIENT_DEMO_MSSQL_PORT',
  'IDOXS_CLIENT_DEMO_MSSQL_USER',
  'IDOXS_CLIENT_DEMO_MSSQL_PASSWORD',
  'IDOXS_CLIENT_DEMO_MSSQL_DATABASE',
  'IDOXS_CLIENT_OXFORD_MYSQL_HOST',
  'IDOXS_CLIENT_OXFORD_MYSQL_PORT',
  'IDOXS_CLIENT_OXFORD_MYSQL_USER',
  'IDOXS_CLIENT_OXFORD_MYSQL_PASSWORD',
  'IDOXS_CLIENT_OXFORD_MYSQL_DATABASE',
  'IDOXS_CLIENT_OXFORD_MSSQL_HOST',
  'IDOXS_CLIENT_OXFORD_MSSQL_PORT',
  'IDOXS_CLIENT_OXFORD_MSSQL_USER',
  'IDOXS_CLIENT_OXFORD_MSSQL_PASSWORD',
  'IDOXS_CLIENT_OXFORD_MSSQL_DATABASE',
  'IDOXS_CLIENT_WERT_MYSQL_HOST',
  'IDOXS_CLIENT_WERT_MYSQL_PORT',
  'IDOXS_CLIENT_WERT_MYSQL_USER',
  'IDOXS_CLIENT_WERT_MYSQL_PASSWORD',
  'IDOXS_CLIENT_WERT_MYSQL_DATABASE',
  'IDOXS_CLIENT_WERT_MSSQL_HOST',
  'IDOXS_CLIENT_WERT_MSSQL_PORT',
  'IDOXS_CLIENT_WERT_MSSQL_USER',
  'IDOXS_CLIENT_WERT_MSSQL_PASSWORD',
  'IDOXS_CLIENT_WERT_MSSQL_DATABASE',
  'IDOXS_CLIENT_IVACORP_MYSQL_HOST',
  'IDOXS_CLIENT_IVACORP_MYSQL_PORT',
  'IDOXS_CLIENT_IVACORP_MYSQL_USER',
  'IDOXS_CLIENT_IVACORP_MYSQL_DATABASE',
  'IDOXS_CLIENT_IVACORP_MYSQL_PASSWORD',
];

type FirebaseRequest = IncomingMessage & {
  method?: string;
  originalUrl?: string;
  url?: string;
  rawBody?: Buffer;
};

async function handleFirebaseRequest(request: FirebaseRequest, response: ServerResponse) {
  await appReady;

  // Firebase Functions provides POST bodies as an already-buffered rawBody.
  // Passing the consumed IncomingMessage stream directly to Fastify can leave
  // production POST routes waiting for a body/end event that never arrives.
  if (request.rawBody && !['GET', 'HEAD'].includes(request.method ?? '')) {
    const result = await (app.inject as any)({
      method: request.method ?? 'POST',
      url: request.originalUrl ?? request.url ?? '/',
      headers: request.headers,
      payload: request.rawBody,
    });

    response.statusCode = result.statusCode;
    for (const [name, value] of Object.entries(result.headers)) {
      if (value !== undefined) response.setHeader(name, value as string | number | readonly string[]);
    }
    response.end(result.body);
    return;
  }

  app.server.emit('request', request, response);
}

export const api = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    minInstances: 0,
    maxInstances: 5,
    secrets: DOXS_API_SECRETS,
  },
  handleFirebaseRequest,
);

export const dashboardCacheFreshnessDaytime = onSchedule(
  {
    region: 'us-central1',
    schedule: '* 8-23 * * *',
    timeZone: 'Asia/Manila',
    timeoutSeconds: 120,
    memory: '256MiB',
    maxInstances: 1,
    secrets: DOXS_API_SECRETS,
  },
  async () => {
    await appReady;
    const result = await runDashboardCacheFreshnessCheck(app.log);
    app.log.info({ result }, 'Scheduled daytime dashboard cache freshness check completed.');
  },
);


export const dashboardCacheFreshnessOvernight = onSchedule(
  {
    region: 'us-central1',
    schedule: '0 0-7 * * *',
    timeZone: 'Asia/Manila',
    timeoutSeconds: 120,
    memory: '256MiB',
    maxInstances: 1,
    secrets: DOXS_API_SECRETS,
  },
  async () => {
    await appReady;
    const result = await runDashboardCacheFreshnessCheck(app.log);
    app.log.info({ result }, 'Scheduled overnight dashboard cache freshness check completed.');
  },
);


export const userTerritoryReplicaRefresh = onSchedule(
  {
    region: 'us-central1',
    schedule: '0 1 * * *',
    timeZone: 'Asia/Manila',
    timeoutSeconds: 540,
    memory: '256MiB',
    maxInstances: 1,
    secrets: DOXS_API_SECRETS,
  },
  async () => {
    await appReady;
    const result = await runUserTerritoryReplicaRefresh(app.log);
    app.log.info({ result }, 'Scheduled user territory replica refresh completed.');
  },
);

export const doctorTmlCacheRefresh = onSchedule(
  {
    region: 'us-central1',
    schedule: '0 0,5,11,17 * * *',
    timeZone: 'Asia/Manila',
    timeoutSeconds: 540,
    memory: '256MiB',
    maxInstances: 1,
    secrets: DOXS_API_SECRETS,
  },
  async () => {
    await appReady;
    const result = await runDoctorTmlCacheRefresh(app.log);
    app.log.info({ result }, 'Scheduled Doctor/TML cache refresh completed.');
  },
);
