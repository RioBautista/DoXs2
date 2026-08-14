import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function getAdminApp() {
  const existing = getApps()[0];
  if (existing) return existing;

  return initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || process.env.GOOGLE_CLOUD_PROJECT,
  });
}

export function getAdminFirestore() {
  return getFirestore(getAdminApp());
}
