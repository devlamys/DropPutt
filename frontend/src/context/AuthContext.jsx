import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as client from "../utils/api.js";
import { disablePush } from "../utils/push.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => client.getSession());

  useEffect(() => client.onSessionExpired(() => setSession(null)), []);

  const signIn = useCallback(async (credentials) => {
    const data = await client.login(credentials);
    client.saveSession(data);
    setSession(data);
    return data.user;
  }, []);

  const signOut = useCallback(async () => {
    await disablePush(); // while the token still works
    await client.logout();
    client.clearSession();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ user: session?.user ?? null, isAuthenticated: !!session, signIn, signOut }),
    [session, signIn, signOut]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
