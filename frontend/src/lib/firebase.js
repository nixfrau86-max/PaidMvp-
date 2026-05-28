// Firebase Analytics — initialised on app boot.
// Web-app config values are public by design (Firebase secures access via project rules).
import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported, logEvent, setUserId, setUserProperties } from "firebase/analytics";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID,
};

let _analytics = null;
let _ready = null;

// Only initialise if we have at least an apiKey + measurementId (prod env)
const enabled = Boolean(firebaseConfig.apiKey && firebaseConfig.measurementId);

if (enabled) {
  try {
    const app = initializeApp(firebaseConfig);
    _ready = isSupported().then((ok) => {
      if (ok) {
        _analytics = getAnalytics(app);
      }
      return ok;
    }).catch((err) => {
      console.warn("[firebase] analytics support check failed", err);
      return false;
    });
  } catch (err) {
    console.warn("[firebase] init failed", err);
  }
}

/** Safe event logger — silently no-ops if analytics is unavailable. */
export async function track(eventName, params = {}) {
  if (!enabled) return;
  try {
    await _ready;
    if (_analytics) logEvent(_analytics, eventName, params);
  } catch (err) {
    console.warn("[firebase] track error", eventName, err);
  }
}

/** Identify the user for cohort/funnel analysis. Call on login + on logout (null). */
export async function identify(user) {
  if (!enabled) return;
  try {
    await _ready;
    if (!_analytics) return;
    if (user?.user_id) {
      setUserId(_analytics, user.user_id);
      setUserProperties(_analytics, {
        role: user.role || "consumer",
        auth_method: (user.auth_methods || [])[0] || "unknown",
      });
    } else {
      setUserId(_analytics, null);
    }
  } catch (err) {
    console.warn("[firebase] identify error", err);
  }
}
