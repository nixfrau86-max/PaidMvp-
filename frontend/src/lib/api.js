import axios from "axios";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Auth is carried entirely by the httpOnly `session_token` cookie.
// `withCredentials` sends it automatically — no token is ever exposed to JS (XSS-safe).
export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

export function wsUrl(path) {
  const base = BACKEND_URL.replace(/^http/, "ws");
  return `${base}${path}`;
}
