import { useState } from 'react';
import { api, setAuthToken, ApiError } from './api.js';

const STORAGE_KEY = 'admin_token';

// setAuthToken() is called synchronously wherever `token` changes below —
// never via a useEffect. On mount, a child screen's own data-fetching effect
// runs before a parent's effect (React runs child effects first), so an
// effect-based approach here would fire the first authenticated request
// before the token was actually attached, get a 401, and immediately log
// back out. Setting it synchronously during the same render/action avoids
// that race entirely.

function store(token) {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable (private browsing etc) — session still works in-memory
  }
}

export function useAdminAuth() {
  const [token, setToken] = useState(() => {
    let stored = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    setAuthToken(stored);
    return stored;
  });
  const [loginError, setLoginError] = useState(null);
  const [loggingIn, setLoggingIn] = useState(false);

  // A token from login, sign-up or a password change.
  function applyToken(newToken) {
    setAuthToken(newToken);
    setToken(newToken);
    store(newToken);
  }

  async function login(email, password) {
    setLoggingIn(true);
    setLoginError(null);
    try {
      const { token: newToken } = await api.login(email, password);
      applyToken(newToken);
    } catch (err) {
      setLoginError(err instanceof ApiError && err.code === 'too_many_requests' ? 'too_many_requests' : 'loginError');
      if (!(err instanceof ApiError)) throw err;
    } finally {
      setLoggingIn(false);
    }
  }

  function logout() {
    applyToken(null);
  }

  // Any 401 from a protected call (expired/invalid token) drops back to login.
  function handleAuthError(err) {
    if (err instanceof ApiError && err.status === 401) {
      logout();
      return true;
    }
    return false;
  }

  return {
    token,
    loggedIn: !!token,
    login,
    logout,
    setSessionToken: applyToken,
    loginError,
    loggingIn,
    handleAuthError,
  };
}
