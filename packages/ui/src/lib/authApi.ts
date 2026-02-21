/**
 * Authentication API Client
 * Handles all authentication-related API calls
 */

const API_BASE = '/api';

/**
 * Login with username and password
 */
export async function login(username, password, options = {}) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include', // Include cookies
    body: JSON.stringify({
      username,
      password,
      useCookies: options.useCookies !== false
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new AuthError(data.error || 'Login failed', {
      status: response.status,
      retryAfter: data.retryAfter,
      remainingAttempts: data.remainingAttempts
    });
  }

  return data;
}

/**
 * Logout current user
 */
export async function logout() {
  const response = await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include'
  });

  if (!response.ok) {
    const data = await response.json();
    throw new AuthError(data.error || 'Logout failed', { status: response.status });
  }

  return response.json();
}

/**
 * Logout from all sessions
 */
export async function logoutAllSessions() {
  const response = await fetch(`${API_BASE}/auth/logout-all`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Authorization': `Bearer ${getAccessToken()}`
    }
  });

  if (!response.ok) {
    const data = await response.json();
    throw new AuthError(data.error || 'Logout failed', { status: response.status });
  }

  return response.json();
}

/**
 * Refresh access token
 */
export async function refreshToken() {
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      useCookies: true
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new AuthError(data.error || 'Token refresh failed', { status: response.status });
  }

  // Store new tokens if not using cookies
  if (data.accessToken) {
    localStorage.setItem('oc_access_token', data.accessToken);
  }
  if (data.refreshToken) {
    localStorage.setItem('oc_refresh_token', data.refreshToken);
  }

  return data;
}

/**
 * Get current user information
 */
export async function getCurrentUser() {
  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: {
      'Authorization': `Bearer ${getAccessToken()}`
    },
    credentials: 'include'
  });

  if (!response.ok) {
    if (response.status === 401) {
      return null;
    }
    const data = await response.json();
    throw new AuthError(data.error || 'Failed to get user', { status: response.status });
  }

  return response.json();
}

/**
 * Check session status
 */
export async function checkSession() {
  const response = await fetch(`${API_BASE}/auth/session`, {
    credentials: 'include'
  });

  if (response.status === 401) {
    return { authenticated: false };
  }

  return response.json();
}

/**
 * Get access token from storage
 */
export function getAccessToken() {
  return localStorage.getItem('oc_access_token');
}

/**
 * Get refresh token from storage
 */
export function getRefreshToken() {
  return localStorage.getItem('oc_refresh_token');
}

/**
 * Store tokens
 */
export function storeTokens(accessToken, refreshToken) {
  localStorage.setItem('oc_access_token', accessToken);
  localStorage.setItem('oc_refresh_token', refreshToken);
}

/**
 * Clear stored tokens
 */
export function clearTokens() {
  localStorage.removeItem('oc_access_token');
  localStorage.removeItem('oc_refresh_token');
}

/**
 * Custom error class for auth errors
 */
export class AuthError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AuthError';
    this.status = details.status;
    this.retryAfter = details.retryAfter;
    this.remainingAttempts = details.remainingAttempts;
  }
}

/**
 * Fetch wrapper that automatically handles token refresh
 */
export async function authenticatedFetch(url, options = {}) {
  let accessToken = getAccessToken();

  const makeRequest = (token) => {
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${token}`
      },
      credentials: 'include'
    });
  };

  let response = await makeRequest(accessToken);

  // If token expired, try to refresh
  if (response.status === 401) {
    try {
      const refreshData = await refreshToken();
      accessToken = refreshData.accessToken;
      response = await makeRequest(accessToken);
    } catch (err) {
      // Refresh failed, clear tokens and throw
      clearTokens();
      throw new AuthError('Session expired. Please login again.', { status: 401 });
    }
  }

  return response;
}

export default {
  login,
  logout,
  logoutAllSessions,
  refreshToken,
  getCurrentUser,
  checkSession,
  getAccessToken,
  getRefreshToken,
  storeTokens,
  clearTokens,
  authenticatedFetch,
  AuthError
};
