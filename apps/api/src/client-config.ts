export type ClientDatabaseConfig = {
  clientSlug: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  tablePrefix: string;
};

function envKey(clientSlug: string, suffix: string) {
  const normalized = clientSlug.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  return `IDOXS_CLIENT_${normalized}_MYSQL_${suffix}`;
}

export function getClientDatabaseConfig(clientSlug?: string | null): ClientDatabaseConfig | null {
  const effectiveClient = clientSlug || process.env.DEFAULT_CLIENT_SLUG || 'default';

  const host = process.env[envKey(effectiveClient, 'HOST')] ?? process.env.MYSQL_HOST;
  const user = process.env[envKey(effectiveClient, 'USER')] ?? process.env.MYSQL_USER;
  const password = process.env[envKey(effectiveClient, 'PASSWORD')] ?? process.env.MYSQL_PASSWORD;
  const database = process.env[envKey(effectiveClient, 'DATABASE')] ?? process.env.MYSQL_DATABASE;
  const port = Number(process.env[envKey(effectiveClient, 'PORT')] ?? process.env.MYSQL_PORT ?? 3306);
  const tablePrefix = process.env[envKey(effectiveClient, 'TABLE_PREFIX')] ?? process.env.MYSQL_TABLE_PREFIX ?? '';

  if (!host || !user || !database || password === undefined) return null;

  return {
    clientSlug: effectiveClient,
    host,
    port,
    user,
    password,
    database,
    tablePrefix,
  };
}

export function prefixedTable(config: ClientDatabaseConfig, table: string) {
  const name = `${config.tablePrefix}${table}`;
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error('Invalid MySQL table prefix configuration.');
  }
  return `\`${name}\``;
}
