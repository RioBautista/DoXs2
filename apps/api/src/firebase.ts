import type { IncomingMessage, ServerResponse } from 'node:http';
import { onRequest } from 'firebase-functions/v2/https';
import { buildApp } from './app.js';

const app = buildApp();
const appReady = app.ready();

export const api = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    minInstances: 0,
    maxInstances: 5,
    secrets: [
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
    ],
  },
  async (request: IncomingMessage, response: ServerResponse) => {
    await appReady;
    app.server.emit('request', request, response);
  },
);
