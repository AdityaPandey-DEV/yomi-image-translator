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
  createdAt: any;
  lastLoginAt: any;
}

export interface StoredApiKey {
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

/** Save an API key for a provider */
export async function saveApiKey(uid: string, provider: string, apiKey: string, model: string, isShared: boolean = false) {
  const ref = doc(db, 'users', uid, 'keys', provider);
  await setDoc(ref, {
    provider,
    apiKey,
    model,
    isActive: true,
    isShared,
    addedAt: serverTimestamp(),
    lastUsedAt: null,
    usageCount: 0,
  } satisfies Omit<StoredApiKey, 'addedAt' | 'lastUsedAt'> & { addedAt: any; lastUsedAt: any });

  // If shared, also add to the shared_keys pool
  if (isShared) {
    await setDoc(doc(db, 'shared_keys', `${uid}_${provider}`), {
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
  return snap.docs.map(d => d.data() as StoredApiKey);
}

/** Delete an API key */
export async function deleteApiKey(uid: string, provider: string) {
  await deleteDoc(doc(db, 'users', uid, 'keys', provider));
  // Also remove from shared pool if it was shared
  try {
    await deleteDoc(doc(db, 'shared_keys', `${uid}_${provider}`));
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
// Extension Integration: Send auth token to Chrome extension
// ============================================================

/** Attempt to send auth credentials to the installed Chrome extension */
export function sendTokenToExtension(idToken: string, email: string = ''): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      resolve(false);
      return;
    }
    try {
      chrome.runtime.sendMessage(
        EXTENSION_ID,
        { type: 'AUTH_TOKEN', token: idToken, email },
        (response: any) => {
          if (chrome.runtime.lastError) {
            console.log('Extension not detected:', chrome.runtime.lastError.message);
            resolve(false);
            return;
          }
          resolve(response?.success === true);
        }
      );
    } catch {
      resolve(false);
    }
  });
}

export { auth, db, app };

