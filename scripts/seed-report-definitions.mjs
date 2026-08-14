#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const root = process.cwd();
const seedDir = process.env.REPORT_DEFINITION_SEED_DIR || path.join(root, 'seeds', 'reportDefinitions');
const collectionName = process.env.REPORTS_COLLECTION || 'reportDefinitions';
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!getApps().length) {
  if (serviceAccountJson) {
    initializeApp({ credential: cert(JSON.parse(serviceAccountJson)), projectId });
  } else {
    initializeApp({ credential: applicationDefault(), projectId });
  }
}

const db = getFirestore();
const files = (await fs.readdir(seedDir)).filter((name) => name.endsWith('.json')).sort();
if (!files.length) {
  console.error(`No JSON report definitions found in ${seedDir}`);
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
for (const file of files) {
  const id = file.replace(/\.json$/i, '');
  const fullPath = path.join(seedDir, file);
  const data = JSON.parse(await fs.readFile(fullPath, 'utf8'));
  if (dryRun) {
    console.log(`[dry-run] would upsert ${collectionName}/${id}: ${data.title}`);
    continue;
  }
  await db.collection(collectionName).doc(id).set({ ...data, updatedAt: new Date().toISOString(), source: 'repo-seed' }, { merge: true });
  console.log(`upserted ${collectionName}/${id}: ${data.title}`);
}
