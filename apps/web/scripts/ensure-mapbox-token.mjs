import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(webDir, '../..');
const envLocalPath = resolve(webDir, '.env.local');
const buildEnvKey = 'VITE_MAPBOX_ACCESS_TOKEN';
const legacySecretKey = 'VITE_MAPBOX_TOKEN';
const projectId = process.env.FIREBASE_PROJECT || 'doxs2-e3d72';

function hasUsableToken(value) {
  return typeof value === 'string' && value.trim().startsWith('pk.') && value.trim().length >= 20;
}

function readEnvLocal() {
  if (!existsSync(envLocalPath)) return new Map();
  return new Map(
    readFileSync(envLocalPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf('=');
        return index === -1 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

if (hasUsableToken(process.env[buildEnvKey])) {
  process.exit(0);
}

const localEnv = readEnvLocal();
if (hasUsableToken(localEnv.get(buildEnvKey))) {
  process.exit(0);
}

const localSecretPath = resolve(repoRoot, '../secrets/imported/workspace/mapbox-public-token.env');
if (existsSync(localSecretPath)) {
  const text = readFileSync(localSecretPath, 'utf8').trim();
  const match = text.match(/(?:VITE_MAPBOX_ACCESS_TOKEN|VITE_MAPBOX_TOKEN|MAPBOX_TOKEN|MAPBOX_ACCESS_TOKEN)\s*=\s*([\"']?)([^\"'\s]+)\1/);
  const token = (match ? match[2] : text.split(/\r?\n/)[0]).trim();
  if (hasUsableToken(token)) {
    const existingLines = existsSync(envLocalPath)
      ? readFileSync(envLocalPath, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith(`${buildEnvKey}=`) && !line.startsWith(`${legacySecretKey}=`))
      : [];
    existingLines.push(`${buildEnvKey}=${token}`);
    existingLines.push(`${legacySecretKey}=${token}`);
    writeFileSync(envLocalPath, `${existingLines.join('\n')}\n`, { mode: 0o600 });
    console.log(`[web build] Loaded ${buildEnvKey} from local imported Mapbox token.`);
    process.exit(0);
  }
}

const firebaseBin = resolve(repoRoot, 'node_modules/.bin/firebase');
let token = '';
let lastStderr = '';
for (const secretName of [buildEnvKey, legacySecretKey]) {
  const result = spawnSync(firebaseBin, ['functions:secrets:access', secretName, '--project', projectId], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  token = (result.stdout || '').trim();
  lastStderr = (result.stderr || '').trim();
  if (hasUsableToken(token)) break;
}

if (!hasUsableToken(token)) {
  console.error(`[web build] ${buildEnvKey} is missing and could not be loaded from Firebase Secret Manager.`);
  if (lastStderr) console.error(lastStderr.split(/\r?\n/).slice(0, 5).join('\n'));
  process.exit(1);
}

const existingLines = existsSync(envLocalPath)
  ? readFileSync(envLocalPath, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith(`${buildEnvKey}=`) && !line.startsWith(`${legacySecretKey}=`))
  : [];

existingLines.push(`${buildEnvKey}=${token}`);
existingLines.push(`${legacySecretKey}=${token}`);
writeFileSync(envLocalPath, `${existingLines.join('\n')}\n`, { mode: 0o600 });
console.log(`[web build] Loaded ${buildEnvKey} from Firebase Secret Manager into apps/web/.env.local.`);
