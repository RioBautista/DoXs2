import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let tokenPromise: Promise<void> | null = null;

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

function getClientFirebaseApp(): FirebaseApp | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID;

  if (!apiKey || !projectId || !appId) return null;

  if (!app) {
    app = initializeApp({
      apiKey,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId,
      appId,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    });
  }
  return app;
}

export function getClientFirestore(): Firestore | null {
  const firebaseApp = getClientFirebaseApp();
  if (!firebaseApp) return null;
  if (!db) db = getFirestore(firebaseApp);
  return db;
}

export async function ensureFirebaseSession(): Promise<boolean> {
  const firebaseApp = getClientFirebaseApp();
  if (!firebaseApp) return false;

  if (!auth) auth = getAuth(firebaseApp);
  if (auth.currentUser) return true;

  tokenPromise ??= (async () => {
    const response = await fetch(`${API_BASE}/firebase/token`, { method: 'POST', credentials: 'include' });
    if (!response.ok) throw new Error('Firebase session token request failed.');
    const data = (await response.json()) as { token?: string };
    if (!data.token) throw new Error('Firebase session token missing.');
    await signInWithCustomToken(auth!, data.token);
  })();

  await tokenPromise;
  return Boolean(auth.currentUser);
}
