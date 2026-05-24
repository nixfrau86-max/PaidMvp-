import axios from "axios";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

// Attach bearer fallback if available in localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("session_token");
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function wsUrl(path) {
  const base = BACKEND_URL.replace(/^http/, "ws");
  return `${base}${path}`;
}
