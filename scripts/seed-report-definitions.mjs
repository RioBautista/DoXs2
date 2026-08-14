#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const root = process.cwd();
const seedDir = process.env.REPORT_DEFINITION_SEED_DIR || path.join(root, 'seeds', 'reportDefinitions');
const collectionName = process.env.REPORTS_COLLECTION || 'reportDefinitions';
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const dryRun = process.argv.includes('--dry-run');
const forceRest = process.argv.includes('--firebase-cli-auth') || process.env.FIREBASE_CLI_AUTH === 'true';

async function readProjectFromFirebaseRc(cwd) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(cwd, '.firebaserc'), 'utf8'));
    return data.projects?.default || null;
  } catch {
    return null;
  }
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreValue(item)])) } };
  return { stringValue: String(value) };
}

function firestoreDocument(data) {
  return { fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, firestoreValue(value)])) };
}

async function firebaseCliAccessToken() {
  const configPath = process.env.FIREBASE_TOOLS_CONFIG || path.join(process.env.HOME || os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const token = config.tokens?.access_token;
  if (!token) throw new Error(`No Firebase CLI access token found in ${configPath}`);
  return token;
}

async function upsertWithRest({ id, data, project }) {
  const token = await firebaseCliAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${collectionName}/${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(firestoreDocument(data)),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firestore REST write failed for ${collectionName}/${id}: ${response.status} ${body.slice(0, 500)}`);
  }
}

async function upsertWithAdminSdk({ id, data, project }) {
  if (!getApps().length) {
    if (serviceAccountJson) initializeApp({ credential: cert(JSON.parse(serviceAccountJson)), projectId: project });
    else initializeApp({ credential: applicationDefault(), projectId: project });
  }
  await getFirestore().collection(collectionName).doc(id).set(data, { merge: true });
}

const effectiveProjectId = projectId || await readProjectFromFirebaseRc(root);
if (!effectiveProjectId && !dryRun) throw new Error('No Firebase project id found. Set FIREBASE_PROJECT_ID or configure .firebaserc.');

const files = (await fs.readdir(seedDir)).filter((name) => name.endsWith('.json')).sort();
if (!files.length) {
  console.error(`No JSON report definitions found in ${seedDir}`);
  process.exit(1);
}

for (const file of files) {
  const id = file.replace(/\.json$/i, '');
  const fullPath = path.join(seedDir, file);
  const data = JSON.parse(await fs.readFile(fullPath, 'utf8'));
  const payload = { ...data, updatedAt: new Date().toISOString(), source: 'repo-seed' };
  if (dryRun) {
    console.log(`[dry-run] would upsert ${collectionName}/${id}: ${data.title}`);
    continue;
  }
  if (forceRest) await upsertWithRest({ id, data: payload, project: effectiveProjectId });
  else await upsertWithAdminSdk({ id, data: payload, project: effectiveProjectId });
  console.log(`upserted ${collectionName}/${id}: ${data.title}`);
}
