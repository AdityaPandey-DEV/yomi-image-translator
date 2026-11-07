import React, { createContext, useContext, useEffect, useState } from 'react';
import { type User } from 'firebase/auth';
import {
  onAuthChange,
  getUserProfile,
  getUserApiKeys,
  type UserProfile,
  type StoredApiKey,
} from './firebase';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  apiKeys: StoredApiKey[];
  loading: boolean;
  refreshProfile: () => Promise<void>;
  refreshKeys: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  apiKeys: [],
  loading: true,
  refreshProfile: async () => {},
  refreshKeys: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [apiKeys, setApiKeys] = useState<StoredApiKey[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshProfile = async () => {
    if (!user) return;
    const p = await getUserProfile(user.uid);
    setProfile(p);
  };

  const refreshKeys = async () => {
    if (!user) return;
    const keys = await getUserApiKeys(user.uid);
    setApiKeys(keys);
  };

  useEffect(() => {
    const unsub = onAuthChange(async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const [p, keys] = await Promise.all([
            getUserProfile(firebaseUser.uid),
            getUserApiKeys(firebaseUser.uid),
          ]);
          setProfile(p);
          setApiKeys(keys);
        } catch (err) {
          console.error('Failed to load user data:', err);
        }
      } else {
        setProfile(null);
        setApiKeys([]);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  // Re-fetch when user changes
  useEffect(() => {
    if (user) {
      refreshProfile();
      refreshKeys();
    }
  }, [user?.uid]);

  return (
    <AuthContext.Provider value={{ user, profile, apiKeys, loading, refreshProfile, refreshKeys }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

