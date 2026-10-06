import type { User } from "@pest-app/shared";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import * as authApi from "../api/auth";
import { ApiError, setSessionExpiredHandler } from "../api/client";
import { tokenStore } from "../api/tokenStore";
import { primeCache } from "../db/cache";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  // Step 1 of signing in. Returns what the server wants next (a temporary-
  // password change, two-step setup, or the code); the sign-in screen walks
  // through those and finishes with completeSignIn.
  login: (email: string, password: string) => Promise<authApi.LoginResult>;
  completeSignIn: (res: authApi.SignedIn) => Promise<void>;
  logout: () => Promise<void>;
  // Ends every signed-in device, including this one.
  logoutEverywhere: () => Promise<void>;
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
          tokenStore.setUser(me).catch(() => {});
          primeCache().catch((err) => {
            // offline or first-run before any sync - fine, cache stays stale
            console.warn("primeCache failed", err);
          });
        } catch (err) {
          // Only a server "no" means the login is dead. No connection (or a
          // server that's down) must not sign the technician out - open with
          // the remembered profile and the data already on the device.
          const rejected = err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 0;
          const remembered = rejected ? null : await tokenStore.getUser<User>();
          if (remembered) setUser(remembered);
          else await tokenStore.clear();
        }
      }
      setIsLoading(false);
    })();
  }, []);

  async function finishSignIn(res: authApi.SignedIn) {
    await tokenStore.setTokens(res.accessToken, res.refreshToken);
    await tokenStore.setUser(res.user);
    setUser(res.user);
    primeCache().catch((err) => {
      // best-effort: worst case the technician primes on next login
      console.warn("primeCache failed", err);
    });
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      async login(email, password) {
        const res = await authApi.login(email, password);
        // A password-only answer never carries tokens; only a finished
        // sign-in (after the code, when required) does.
        if (res.status === "ok") await finishSignIn(res);
        return res;
      },
      async completeSignIn(res) {
        await finishSignIn(res);
      },
      async logoutEverywhere() {
        await authApi.logoutEverywhere().catch(() => {});
        await tokenStore.clear();
        setUser(null);
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
