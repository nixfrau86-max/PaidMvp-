import React, { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { logError } from "../lib/log";

export default function AuthCallback() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = location.hash || window.location.hash;
    const match = hash.match(/session_id=([^&]+)/);
    if (!match) {
      navigate("/");
      return;
    }
    const session_id = match[1];

    (async () => {
      try {
        // Backend sets the httpOnly `session_token` cookie on this exchange.
        // We deliberately do NOT persist the token in JS (XSS-safe; cookie-only auth).
        const { data } = await api.post("/auth/session", { session_id });
        setUser(data.user);
        // Clean hash from URL
        window.history.replaceState(null, "", "/dashboard");
        navigate("/dashboard", { state: { user: data.user } });
      } catch (e) {
        logError("Auth error", e);
        navigate("/");
      }
    })();
  }, [location, navigate, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="border-2 border-ink shadow-brut bg-white px-8 py-6 font-mono text-sm uppercase tracking-widest">
        <span className="inline-block animate-pulse">▮ Signing you in...</span>
      </div>
    </div>
  );
}
