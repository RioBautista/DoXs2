import type { IncomingMessage, ServerResponse } from 'node:http';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { buildApp } from './app.js';
import { runDashboardCacheFreshnessCheck } from './cache-freshness.js';

const app = buildApp();
const appReady = app.ready();

const DOXS_API_SECRETS = [
  'AUTH_MODE',
  'DEV_LOGIN_MOCK',
  'MYSQL_INSECURE_AUTH',
  'SESSION_SECRET',
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

export const api = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    minInstances: 0,
    maxInstances: 5,
    secrets: DOXS_API_SECRETS,
  },
  async (request: IncomingMessage, response: ServerResponse) => {
    await appReady;
    app.server.emit('request', request, response);
  },
);

export const dashboardCacheFreshness = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 1 minutes',
    timeZone: 'Asia/Manila',
    timeoutSeconds: 120,
    memory: '256MiB',
    maxInstances: 1,
    secrets: DOXS_API_SECRETS,
  },
  async () => {
    await appReady;
    const result = await runDashboardCacheFreshnessCheck(app.log);
    app.log.info({ result }, 'Scheduled dashboard cache freshness check completed.');
  },
);
