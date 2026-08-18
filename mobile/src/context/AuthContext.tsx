import type { User } from "@pest-app/shared";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import * as authApi from "../api/auth";
import { setSessionExpiredHandler } from "../api/client";
import { tokenStore } from "../api/tokenStore";
import { primeCache } from "../db/cache";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
    (async () => {
      const token = await tokenStore.getAccessToken();
      if (token) {
        try {
          const me = await authApi.fetchMe();
          setUser(me);
          primeCache().catch((err) => {
            // offline or first-run before any sync - fine, cache stays stale
            console.warn("primeCache failed", err);
          });
        } catch {
          await tokenStore.clear();
        }
      }
      setIsLoading(false);
    })();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      async login(email, password) {
        const res = await authApi.login(email, password);
        await tokenStore.setTokens(res.accessToken, res.refreshToken);
        setUser(res.user);
        primeCache().catch((err) => {
          // best-effort: worst case the technician primes on next login
          console.warn("primeCache failed", err);
        });
      },
      async logout() {
        const refreshToken = await tokenStore.getRefreshToken();
        await tokenStore.clear();
        setUser(null);
        if (refreshToken) {
          authApi.logout(refreshToken).catch(() => {
            // best-effort server-side revoke
          });
        }
      },
    }),
    [user, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
