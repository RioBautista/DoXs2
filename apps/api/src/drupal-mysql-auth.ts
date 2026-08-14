import crypto from 'node:crypto';
import mysql from 'mysql';
import { promisify } from 'node:util';
import { getClientDatabaseConfig, prefixedTable } from './client-config.js';
import type { LoginRequest, LoginResult } from './auth.js';

type DrupalUserRow = {
  uid: number;
  name: string;
  pass: string;
  mail: string | null;
  status: number;
};

type DrupalRoleRow = {
  name: string;
};

export type AuthDebugEvent = { step: string; elapsedMs: number; ok: boolean; message?: string };

function elapsedSince(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function md5(value: string) {
  return crypto.createHash('md5').update(value, 'utf8').digest('hex');
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function withConnectionTimeout<T>(
  connection: mysql.Connection,
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      connection.destroy();
      reject(new Error(message));
    }, timeoutMs);

    operation.then(
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

function verifyDrupalPassword(password: string, storedHash: string) {
  const hash = String(storedHash || '');

  // Drupal 5.x legacy users table normally stores md5(password).
  if (/^[a-f0-9]{32}$/i.test(hash)) {
    return safeCompare(md5(password).toLowerCase(), hash.toLowerCase());
  }

  // Explicitly fail closed for newer Drupal hashes until we confirm the client version/hash scheme.
  // Drupal 7 style hashes usually start with $S$; phpBB/portable phpass commonly starts with $P$/$H$.
  return false;
}

export async function authenticateAgainstDrupalMySQL(payload: LoginRequest): Promise<LoginResult> {
  const config = getClientDatabaseConfig(payload.clientCode);
  if (!config) {
    return {
      ok: false,
      status: 501,
      message: 'Client MySQL authentication is not configured.',
    };
  }

  const connection = mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT_MS ?? 5_000),
    insecureAuth: process.env.MYSQL_INSECURE_AUTH === 'true',
  });
  const connect = promisify(connection.connect).bind(connection);
  const query = promisify(connection.query).bind(connection) as <T = unknown>(sql: string, values?: unknown) => Promise<T>;

  const dbTimeoutMs = Number(process.env.DB_OPERATION_TIMEOUT_MS ?? 5_000);

  await withConnectionTimeout(connection, connect(), dbTimeoutMs, 'Timed out connecting to client MySQL database.');

  try {
    const usersTable = prefixedTable(config, 'users');
    const escapedUsername = connection.escape(payload.username);

    const userRows = await withConnectionTimeout(connection, query<DrupalUserRow[]>(
      `select uid, name, pass, mail, status from ${usersTable} where name = ${escapedUsername} limit 1`,
    ), dbTimeoutMs, 'Timed out querying Drupal user.');

    const user = userRows[0] as DrupalUserRow | undefined;
    if (!user || Number(user.status) !== 1 || !verifyDrupalPassword(payload.password, user.pass)) {
      return { ok: false, status: 401, message: 'Invalid username or password.' };
    }

    const roles: string[] = [];

    return {
      ok: true,
      status: 200,
      user: {
        username: user.name,
        displayName: user.name,
        roles,
      },
    };
  } finally {
    connection.destroy();
  }
}

export async function checkDrupalMySQLConnection(clientCode: string): Promise<{ ok: boolean; clientSlug?: string; message?: string }> {
  const config = getClientDatabaseConfig(clientCode);
  if (!config) return { ok: false, message: 'Client MySQL authentication is not configured.' };

  const connection = mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT_MS ?? 5_000),
    insecureAuth: process.env.MYSQL_INSECURE_AUTH === 'true',
  });
  const connect = promisify(connection.connect).bind(connection);
  const query = promisify(connection.query).bind(connection) as <T = unknown>(sql: string, values?: unknown) => Promise<T>;
  const dbTimeoutMs = Number(process.env.DB_OPERATION_TIMEOUT_MS ?? 8_000);

  try {
    await withConnectionTimeout(connection, connect(), dbTimeoutMs, 'Timed out connecting to client MySQL database.');
    await withConnectionTimeout(connection, query('select 1 as ok'), dbTimeoutMs, 'Timed out running MySQL ping query.');
    return { ok: true, clientSlug: config.clientSlug };
  } catch (error) {
    return { ok: false, clientSlug: config.clientSlug, message: error instanceof Error ? error.message : 'MySQL check failed.' };
  } finally {
    connection.destroy();
  }
}


export async function debugDrupalMySQLAuth(payload: LoginRequest): Promise<{ ok: boolean; status: number; events: AuthDebugEvent[]; userFound?: boolean; userActive?: boolean; hashType?: string }> {
  const startedAt = performance.now();
  const events: AuthDebugEvent[] = [];
  const mark = (step: string, ok: boolean, message?: string) => events.push({ step, elapsedMs: elapsedSince(startedAt), ok, message });

  const config = getClientDatabaseConfig(payload.clientCode);
  if (!config) {
    mark('config', false, 'Client MySQL authentication is not configured.');
    return { ok: false, status: 501, events };
  }
  mark('config', true);

  const connection = mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT_MS ?? 5_000),
    insecureAuth: process.env.MYSQL_INSECURE_AUTH === 'true',
  });
  const connect = promisify(connection.connect).bind(connection);
  const query = promisify(connection.query).bind(connection) as <T = unknown>(sql: string, values?: unknown) => Promise<T>;
  const dbTimeoutMs = Number(process.env.DB_OPERATION_TIMEOUT_MS ?? 8_000);

  try {
    await withConnectionTimeout(connection, connect(), dbTimeoutMs, 'Timed out connecting to client MySQL database.');
    mark('connect', true);

    const usersTable = prefixedTable(config, 'users');
    const escapedUsername = connection.escape(payload.username);
    const userRows = await withConnectionTimeout(connection, query<DrupalUserRow[]>(
      `select uid, name, pass, mail, status from ${usersTable} where name = ${escapedUsername} limit 1`,
    ), dbTimeoutMs, 'Timed out querying Drupal user.');
    mark('user-query', true);

    const user = userRows[0] as DrupalUserRow | undefined;
    const hash = String(user?.pass ?? '');
    const hashType = /^[a-f0-9]{32}$/i.test(hash) ? 'md5' : hash.startsWith('$S$') ? 'drupal7' : hash.startsWith('$P$') || hash.startsWith('$H$') ? 'phpass' : user ? 'other' : undefined;
    if (!user) return { ok: false, status: 401, events, userFound: false };
    mark('user-found', true);

    const userActive = Number(user.status) === 1;
    const passwordOk = userActive && verifyDrupalPassword(payload.password, user.pass);
    mark('password-check', passwordOk);
    return { ok: passwordOk, status: passwordOk ? 200 : 401, events, userFound: true, userActive, hashType };
  } catch (error) {
    mark('error', false, error instanceof Error ? error.message : 'Unknown auth error.');
    return { ok: false, status: 503, events };
  } finally {
    connection.destroy();
    mark('destroy', true);
  }
}


export async function debugDrupalMySQLUsersQuery(clientCode: string): Promise<{ ok: boolean; clientSlug?: string; message?: string; rowCount?: number }> {
  const config = getClientDatabaseConfig(clientCode);
  if (!config) return { ok: false, message: 'Client MySQL authentication is not configured.' };

  const connection = mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT_MS ?? 5_000),
    insecureAuth: process.env.MYSQL_INSECURE_AUTH === 'true',
  });
  const connect = promisify(connection.connect).bind(connection);
  const query = promisify(connection.query).bind(connection) as <T = unknown>(sql: string, values?: unknown) => Promise<T>;
  const dbTimeoutMs = Number(process.env.DB_OPERATION_TIMEOUT_MS ?? 8_000);

  try {
    await withConnectionTimeout(connection, connect(), dbTimeoutMs, 'Timed out connecting to client MySQL database.');
    const usersTable = prefixedTable(config, 'users');
    const rows = await withConnectionTimeout(connection, query<DrupalUserRow[]>(
      `select uid, name, status, length(pass) as pass_len from ${usersTable} limit 1`,
    ), dbTimeoutMs, 'Timed out querying Drupal users table.');
    return { ok: true, clientSlug: config.clientSlug, rowCount: rows.length };
  } catch (error) {
    return { ok: false, clientSlug: config.clientSlug, message: error instanceof Error ? error.message : 'MySQL users query failed.' };
  } finally {
    connection.destroy();
  }
}
