import { Router } from 'express';
import {
  login,
  logout,
  refreshAccessToken,
  requireAuth,
  setAuthCookies,
  clearAuthCookies,
  getSessionInfo,
  extractRefreshToken,
  logoutAllSessions
} from '../lib/users/auth.js';

const router = Router();

/**
 * POST /api/auth/login
 * Authenticate user and issue tokens
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        error: 'Username and password are required' 
      });
    }
    
    const result = await login(username, password, req);
    
    if (!result.success) {
      return res.status(401).json({
        error: result.error,
        retryAfter: result.retryAfter,
        remainingAttempts: result.remainingAttempts
      });
    }
    
    // Set cookies if using cookie-based auth
    if (req.body.useCookies !== false) {
      setAuthCookies(req, res, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        refreshExpiresIn: result.refreshExpiresIn
      });
    }
    
    res.json({
      success: true,
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn
    });
  } catch (err) {
    console.error('[Auth API] Login error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * POST /api/auth/logout
 * Logout user and invalidate tokens
 */
router.post('/logout', async (req, res) => {
  try {
    const refreshToken = extractRefreshToken(req) || req.body.refreshToken;
    
    await logout(refreshToken);
    
    // Clear cookies
    clearAuthCookies(req, res);
    
    res.json({ success: true });
  } catch (err) {
    console.error('[Auth API] Logout error:', err);
    res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * POST /api/auth/logout-all
 * Logout from all sessions (requires authentication)
 */
router.post('/logout-all', requireAuth, async (req, res) => {
  try {
    await logoutAllSessions(req.user.id);
    
    // Clear cookies
    clearAuthCookies(req, res);
    
    res.json({ success: true });
  } catch (err) {
    console.error('[Auth API] Logout all error:', err);
    res.status(500).json({ error: 'Failed to logout from all sessions' });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = extractRefreshToken(req) || req.body.refreshToken;
    
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }
    
    const result = await refreshAccessToken(refreshToken);
    
    if (!result.success) {
      // Clear invalid cookies
      clearAuthCookies(req, res);
      return res.status(401).json({ error: result.error });
    }
    
    // Update cookies
    if (req.body.useCookies !== false) {
      setAuthCookies(req, res, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        refreshExpiresIn: result.refreshExpiresIn
      });
    }
    
    res.json({
      success: true,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn
    });
  } catch (err) {
    console.error('[Auth API] Refresh error:', err);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

/**
 * GET /api/auth/me
 * Get current user information
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    res.json({
      authenticated: true,
      user: req.user
    });
  } catch (err) {
    console.error('[Auth API] Get user error:', err);
    res.status(500).json({ error: 'Failed to get user information' });
  }
});

/**
 * GET /api/auth/session
 * Get session status (doesn't require auth, but returns info if authenticated)
 */
router.get('/session', (req, res) => {
  const sessionInfo = getSessionInfo(req);
  
  if (sessionInfo.authenticated) {
    res.json(sessionInfo);
  } else {
    res.status(401).json({ authenticated: false });
  }
});

export default router;
