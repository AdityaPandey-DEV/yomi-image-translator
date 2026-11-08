// Firebase Configuration & Initialization
// ========================================

declare const chrome: any;
// SETUP REQUIRED: Create a Firebase project at https://console.firebase.google.com
// 1. Create a new project (or use existing)
// 2. Enable Authentication → Sign-in Methods → Email/Password (enable "Email link" passwordless)
// 3. Enable Authentication → Sign-in Methods → Google
// 4. Create Firestore Database (production mode)
// 5. Copy your web app config below
// 6. Deploy Firestore security rules from firestore.rules

import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  serverTimestamp,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';

// ============================================================
// 🔧 REPLACE THESE WITH YOUR FIREBASE PROJECT CONFIG
// Get from: Firebase Console → Project Settings → Web App
// ============================================================
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

// Initialize Firebase (prevent duplicate initialization)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db: Firestore = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Extension ID for externally_connectable message relay
export const EXTENSION_ID = 'pjlblckbipgkomdiojhkmaeffbhkebld';

// ============================================================
// Auth Functions
// ============================================================

/** Sign in with Google popup */
export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  await ensureUserDocument(result.user);
  return result.user;
}

/** Send passwordless email OTP (magic link) */
export async function sendEmailOTP(email: string) {
  const actionCodeSettings = {
    url: `${window.location.origin}/auth/callback`,
    handleCodeInApp: true,
  };
  await sendSignInLinkToEmail(auth, email, actionCodeSettings);
  // Save email locally so we can complete sign-in after redirect
  window.localStorage.setItem('emailForSignIn', email);
}

/** Complete email link sign-in (called on /auth/callback) */
export async function completeEmailSignIn(): Promise<User | null> {
  if (!isSignInWithEmailLink(auth, window.location.href)) {
    return null;
  }
  let email = window.localStorage.getItem('emailForSignIn');
  if (!email) {
    email = window.prompt('Please provide your email for confirmation') || '';
  }
  if (!email) return null;

  const result = await signInWithEmailLink(auth, email, window.location.href);
  window.localStorage.removeItem('emailForSignIn');
  await ensureUserDocument(result.user);
  return result.user;
}

/** Sign out */
export async function signOutUser() {
  await firebaseSignOut(auth);
}

/** Subscribe to auth state changes */
export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

/** Get current user */
export function getCurrentUser(): User | null {
  return auth.currentUser;
}

/** Get current user's ID token (for API calls & extension relay) */
export async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

// ============================================================
// Firestore: User Profile & API Keys
// ============================================================

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  mode: 'private' | 'shared'; // private = own key only, shared = contribute to pool
  autoTranslate?: boolean;
  targetLang?: string;
  createdAt: any;
  lastLoginAt: any;
}

export interface StoredApiKey {
  id: string; // Firestore document ID — unique per key
  provider: string;
  apiKey: string; // encrypted in production, plaintext for V1 MVP
  model: string;
  isActive: boolean;
  isShared: boolean; // whether this key is contributed to the shared pool
  addedAt: any;
  lastUsedAt: any;
  usageCount: number;
}

/** Create user document if it doesn't exist */
async function ensureUserDocument(user: User) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email?.split('@')[0] || 'User',
      photoURL: user.photoURL || '',
      mode: 'private',
      autoTranslate: false,
      targetLang: 'en',
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    } satisfies Omit<UserProfile, 'createdAt' | 'lastLoginAt'> & { createdAt: any; lastLoginAt: any });
  } else {
    await updateDoc(ref, { lastLoginAt: serverTimestamp() });
  }
}

/** Get user profile */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

/** Update user mode (private/shared) */
export async function updateUserMode(uid: string, mode: 'private' | 'shared') {
  await updateDoc(doc(db, 'users', uid), { mode });
}

/** Save an API key for a provider (supports multiple keys per provider) */
export async function saveApiKey(uid: string, provider: string, apiKey: string, model: string, isShared: boolean = false) {
  // Use a unique document ID so multiple keys per provider are supported
  const keyId = `${provider}_${Date.now()}`;
  const ref = doc(db, 'users', uid, 'keys', keyId);
  await setDoc(ref, {
    provider,
    apiKey,
    model,
    isActive: true,
    isShared,
    addedAt: serverTimestamp(),
    lastUsedAt: null,
    usageCount: 0,
  } satisfies Omit<StoredApiKey, 'id' | 'addedAt' | 'lastUsedAt'> & { addedAt: any; lastUsedAt: any });

  // If shared, also add to the shared_keys pool
  if (isShared) {
    await setDoc(doc(db, 'shared_keys', keyId), {
      provider,
      apiKey,
      model,
      addedBy: uid,
      isActive: true,
      usageCount: 0,
      addedAt: serverTimestamp(),
    });
  }
}

/** Get all API keys for a user */
export async function getUserApiKeys(uid: string): Promise<StoredApiKey[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'keys'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as StoredApiKey));
}

/** Delete an API key by its document ID */
export async function deleteApiKey(uid: string, keyId: string) {
  await deleteDoc(doc(db, 'users', uid, 'keys', keyId));
  // Also remove from shared pool if it was shared
  try {
    await deleteDoc(doc(db, 'shared_keys', keyId));
  } catch (_) {
    // Ignore if shared key doesn't exist
  }
}

/** Get a random active shared key for a provider */
export async function getSharedKey(provider: string): Promise<{ apiKey: string; model: string } | null> {
  const q = query(
    collection(db, 'shared_keys'),
    where('provider', '==', provider),
    where('isActive', '==', true)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;

  // Round-robin: pick the key with lowest usage count
  const keys = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  keys.sort((a: any, b: any) => (a.usageCount || 0) - (b.usageCount || 0));
  const chosen = keys[0] as any;
  return { apiKey: chosen.apiKey, model: chosen.model };
}

// ============================================================
// Extension Integration: 3-Layer Auth Sync (Professional Grade)
//
// Layer 1 (PRIMARY):  externally_connectable — direct to background SW
//   Most reliable. Bypasses content scripts. Works even after
//   extension reload. Only fails if extension is uninstalled.
//
// Layer 2 (BACKUP):   Content script window.postMessage bridge
//   Works when content script is alive. Fails after ext reload.
//
// Layer 3 (RECOVERY): localStorage persistence — popup.js reads
//   this via chrome.scripting.executeScript when Layers 1 & 2 fail.
// ============================================================

/** Write auth session to localStorage as Layer 3 recovery fallback */
function persistSessionToLocalStorage(
  token: string,
  email: string,
  displayName: string,
  photoURL: string,
  mode: string
): void {
  try {
    localStorage.setItem(
      'mmt_auth_session',
      JSON.stringify({ token, email, displayName, photoURL, mode, ts: Date.now() })
    );
  } catch {
    // localStorage may be unavailable in some contexts
  }
}

/** Clear auth session from localStorage (on sign-out) */
export function clearSessionFromLocalStorage(): void {
  try {
    localStorage.removeItem('mmt_auth_session');
  } catch {
    // Ignore
  }
}

/** Send auth credentials to the Chrome extension via 3-layer architecture */
export function sendTokenToExtension(
  idToken: string,
  email: string = '',
  displayName: string = '',
  photoURL: string = '',
  mode: string = 'private'
): Promise<boolean> {
  // Layer 3: Always persist to localStorage as recovery fallback
  persistSessionToLocalStorage(idToken, email, displayName, photoURL, mode);

  return new Promise((resolve) => {
    let resolved = false;
    const done = (success: boolean) => {
      if (!resolved) {
        resolved = true;
        resolve(success);
      }
    };

    // Layer 1 (PRIMARY): Direct externally_connectable relay
    // This goes straight to background.js onMessageExternal — no content script needed
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage(
          EXTENSION_ID,
          {
            type: 'AUTH_TOKEN',
            token: idToken,
            email,
            displayName,
            photoURL,
            mode,
          },
          (response: any) => {
            if (chrome.runtime.lastError) {
              console.log('[Auth] externally_connectable unavailable:', chrome.runtime.lastError.message);
              // Extension not installed or ID mismatch — fall through to Layer 2
            } else if (response?.success) {
              console.log('[Auth] ✅ Synced via externally_connectable (Layer 1)');
              done(true);
            }
          }
        );
      } catch {
        // chrome.runtime not available in this context
      }
    }

    // Layer 2 (BACKUP): Content script window.postMessage bridge
    if (typeof window !== 'undefined') {
      const handleSynced = (e: MessageEvent) => {
        if (e.data?.type === 'MMT_AUTH_SYNCED') {
          window.removeEventListener('message', handleSynced);
          console.log('[Auth] ✅ Synced via content script bridge (Layer 2)');
          done(true);
        }
      };
      window.addEventListener('message', handleSynced);

      window.postMessage(
        {
          type: 'MMT_AUTH_SYNC',
          token: idToken,
          email,
          displayName,
          photoURL,
          mode,
        },
        window.location.origin
      );

      // Clean up listener after 2.5s
      setTimeout(() => {
        window.removeEventListener('message', handleSynced);
      }, 2500);
    }

    // Resolve after 1s even if neither layer confirmed
    // (Layer 3 localStorage fallback is already written above)
    setTimeout(() => {
      if (!resolved) {
        console.log('[Auth] Layers 1 & 2 timed out — Layer 3 localStorage recovery available');
        done(true); // localStorage fallback is in place
      }
    }, 1000);
  });
}

/** Notify extension of sign-out via externally_connectable + content script */
export function sendSignOutToExtension(): Promise<void> {
  clearSessionFromLocalStorage();

  return new Promise((resolve) => {
    let done = false;

    // Layer 1: Direct to background service worker
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage(
          EXTENSION_ID,
          { type: 'AUTH_SIGNOUT' },
          () => {
            if (!chrome.runtime.lastError) {
              console.log('[Auth] 🔒 Sign-out sent via externally_connectable');
            }
            if (!done) { done = true; resolve(); }
          }
        );
      } catch {
        // Extension not available
      }
    }

    // Layer 2: Content script bridge
    if (typeof window !== 'undefined') {
      window.postMessage({ type: 'MMT_AUTH_SIGNOUT' }, window.location.origin);
    }

    // Resolve after 500ms regardless
    setTimeout(() => {
      if (!done) { done = true; resolve(); }
    }, 500);
  });
}

export { auth, db, app };

