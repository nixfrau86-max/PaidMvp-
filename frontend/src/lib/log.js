// Lightweight logger: surfaces errors in development for debugging, but stays
// silent in production builds (no console noise / data leakage). Use this in
// catch blocks instead of a bare console.* or an empty/silent catch.
const isDev = process.env.NODE_ENV !== "production";

export const logError = (...args) => {
  if (isDev) console.error(...args);
};

export const logWarn = (...args) => {
  if (isDev) console.warn(...args);
};
