import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { api } from "./api";
import { identify, track } from "./firebase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      identify(data);
    } catch (err) {
      console.debug("auth/me failed", err?.response?.status);
      setUser(null);
      identify(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // If session_id present in URL, AuthCallback will handle; skip /me to avoid race
    if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch (err) {
      console.warn("logout request failed", err);
    }
    setUser(null);
    identify(null);
    track("logout");
    window.location.href = "/";
  }, []);

  const updateRole = useCallback(async (role) => {
    const { data } = await api.post("/auth/role", { role });
    setUser(data);
    return data;
  }, []);

  const value = useMemo(
    () => ({ user, loading, setUser, checkAuth, logout, updateRole }),
    [user, loading, checkAuth, logout, updateRole]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export function loginRedirect() {
  // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
  const redirectUrl = window.location.origin + "/dashboard";
  window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
}
