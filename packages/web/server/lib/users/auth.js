import crypto from 'crypto';
import { authenticateUser, getUserById, updateUser } from './storage.js';
import { hasPermission } from './rbac.js';

// Configuration
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const ACCESS_TOKEN_TTL = parseInt(process.env.JWT_ACCESS_TTL) || 15 * 60; // 15 minutes in seconds
const REFRESH_TOKEN_TTL = parseInt(process.env.JWT_REFRESH_TTL) || 7 * 24 * 60 * 60; // 7 days in seconds
const SESSION_COOKIE_NAME = 'oc_access_token';
const REFRESH_COOKIE_NAME = 'oc_refresh_token';

// Rate limiting for login attempts
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 5;
const RATE_LIMIT_LOCKOUT = 30 * 60 * 1000; // 30 minutes lockout

// Active sessions store (in production, use Redis)
const activeSessions = new Map();
const sessionCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [token, session] of activeSessions.entries()) {
    if (session.expiresAt < now) {
      activeSessions.delete(token);
    }
  }
}, 60 * 60 * 1000); // Clean up every hour

if (sessionCleanupInterval.unref) {
  sessionCleanupInterval.unref();
}

/**
 * Generate JWT token
 * @param {Object} payload - Token payload
 * @param {number} expiresIn - Expiration time in seconds
 * @returns {string} JWT token
 */
function generateToken(payload, expiresIn) {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + expiresIn
  };
  
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const bodyB64 = Buffer.from(JSON.stringify(body)).toString('base64url');
  
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${bodyB64}`)
    .digest('base64url');
  
  return `${headerB64}.${bodyB64}.${signature}`;
}

/**
 * Verify and decode JWT token
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded payload or null if invalid
 */
function verifyToken(token) {
  try {
    const [headerB64, bodyB64, signature] = token.split('.');
    
    if (!headerB64 || !bodyB64 || !signature) {
      return null;
    }
    
    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${headerB64}.${bodyB64}`)
      .digest('base64url');
    
    if (signature !== expectedSignature) {
      return null;
    }
    
    // Decode payload
    const payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString());
    
    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    
    return payload;
  } catch {
    return null;
  }
}

/**
 * Generate access and refresh tokens for a user
 * @param {Object} user - User object
 * @returns {Object} Tokens and expiration info
 */
function generateTokens(user) {
  const accessPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    type: 'access'
  };
  
  const refreshPayload = {
    sub: user.id,
    type: 'refresh',
    jti: crypto.randomBytes(16).toString('hex')
  };
  
  const accessToken = generateToken(accessPayload, ACCESS_TOKEN_TTL);
  const refreshToken = generateToken(refreshPayload, REFRESH_TOKEN_TTL);
  
  // Store refresh token
  activeSessions.set(refreshToken, {
    userId: user.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + (REFRESH_TOKEN_TTL * 1000)
  });
  
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL,
    refreshExpiresIn: REFRESH_TOKEN_TTL
  };
}

/**
 * Check rate limit for login attempts
 * @param {string} identifier - IP address or username
 * @returns {Object} Rate limit status
 */
function checkRateLimit(identifier) {
  const now = Date.now();
  const record = loginAttempts.get(identifier);
  
  if (!record) {
    return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS };
  }
  
  // Check if locked out
  if (record.lockedUntil && now < record.lockedUntil) {
    const retryAfter = Math.ceil((record.lockedUntil - now) / 1000);
    return { allowed: false, locked: true, retryAfter };
  }
  
  // Reset if window has passed
  if (now - record.firstAttempt > RATE_LIMIT_WINDOW) {
    loginAttempts.delete(identifier);
    return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS };
  }
  
  const remaining = Math.max(0, MAX_LOGIN_ATTEMPTS - record.count);
  return { allowed: remaining > 0, remaining, count: record.count };
}

/**
 * Record a failed login attempt
 * @param {string} identifier - IP address or username
 */
function recordFailedAttempt(identifier) {
  const now = Date.now();
  const record = loginAttempts.get(identifier);
  
  if (!record || now - record.firstAttempt > RATE_LIMIT_WINDOW) {
    loginAttempts.set(identifier, {
      count: 1,
      firstAttempt: now,
      lastAttempt: now
    });
  } else {
    record.count++;
    record.lastAttempt = now;
    
    // Lock out if exceeded max attempts
    if (record.count >= MAX_LOGIN_ATTEMPTS) {
      record.lockedUntil = now + RATE_LIMIT_LOCKOUT;
    }
  }
}

/**
 * Clear login attempts (successful login)
 * @param {string} identifier - IP address or username
 */
function clearLoginAttempts(identifier) {
  loginAttempts.delete(identifier);
}

/**
 * Extract token from request
 * @param {Object} req - Express request
 * @returns {string|null} Token or null
 */
function extractToken(req) {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Check cookie
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || null;
}

/**
 * Parse cookies from header
 * @param {string} cookieHeader - Cookie header string
 * @returns {Object} Parsed cookies
 */
function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  
  return cookieHeader.split(';').reduce((acc, cookie) => {
    const [name, ...rest] = cookie.split('=');
    if (name) {
      acc[name.trim()] = decodeURIComponent(rest.join('=').trim());
    }
    return acc;
  }, {});
}

/**
 * Build cookie string
 * @param {Object} options - Cookie options
 * @returns {string} Cookie header value
 */
function buildCookie(options) {
  const { name, value, maxAge, httpOnly = true, sameSite = 'Strict', secure = false } = options;
  
  let cookie = `${name}=${encodeURIComponent(value)}`;
  
  if (httpOnly) cookie += '; HttpOnly';
  if (sameSite) cookie += `; SameSite=${sameSite}`;
  if (secure) cookie += '; Secure';
  if (maxAge !== undefined) {
    cookie += `; Max-Age=${maxAge}`;
    const expires = new Date(Date.now() + maxAge * 1000).toUTCString();
    cookie += `; Expires=${expires}`;
  }
  cookie += '; Path=/';
  
  return cookie;
}

/**
 * Check if request is secure
 * @param {Object} req - Express request
 * @returns {boolean}
 */
function isSecureRequest(req) {
  if (req.secure) return true;
  const forwardedProto = req.headers['x-forwarded-proto'];
  return forwardedProto === 'https' || forwardedProto?.startsWith('https');
}

/**
 * Login user with credentials
 * @param {string} username - Username
 * @param {string} password - Password
 * @param {Object} req - Express request (for rate limiting)
 * @returns {Object} Login result
 */
export async function login(username, password, req) {
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
  const rateLimitKey = `${clientIp}:${username.toLowerCase()}`;
  
  // Check rate limit
  const rateLimit = checkRateLimit(rateLimitKey);
  if (!rateLimit.allowed) {
    return {
      success: false,
      error: rateLimit.locked 
        ? `Too many login attempts. Try again in ${Math.ceil(rateLimit.retryAfter / 60)} minutes.`
        : 'Too many login attempts',
      retryAfter: rateLimit.retryAfter
    };
  }
  
  // Authenticate
  const result = await authenticateUser(username, password);
  
  if (!result.success) {
    recordFailedAttempt(rateLimitKey);
    return {
      success: false,
      error: result.error,
      remainingAttempts: rateLimit.remaining - 1
    };
  }
  
  // Success - clear rate limit
  clearLoginAttempts(rateLimitKey);
  
  // Generate tokens
  const tokens = generateTokens(result.user);
  
  return {
    success: true,
    user: result.user,
    ...tokens
  };
}

/**
 * Refresh access token using refresh token
 * @param {string} refreshToken - Refresh token
 * @returns {Object} New tokens or error
 */
export async function refreshAccessToken(refreshToken) {
  // Verify refresh token
  const payload = verifyToken(refreshToken);
  if (!payload || payload.type !== 'refresh') {
    return { success: false, error: 'Invalid refresh token' };
  }
  
  // Check if session exists
  const session = activeSessions.get(refreshToken);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }
  
  // Get user
  const user = await getUserById(payload.sub);
  if (!user || !user.isActive) {
    activeSessions.delete(refreshToken);
    return { success: false, error: 'User not found or disabled' };
  }
  
  // Remove old session
  activeSessions.delete(refreshToken);
  
  // Generate new tokens
  const tokens = generateTokens(user);
  
  return {
    success: true,
    ...tokens
  };
}

/**
 * Logout user (invalidate tokens)
 * @param {string} refreshToken - Refresh token to invalidate
 */
export async function logout(refreshToken) {
  if (refreshToken) {
    activeSessions.delete(refreshToken);
  }
  return { success: true };
}

/**
 * Logout from all sessions
 * @param {string} userId - User ID
 */
export async function logoutAllSessions(userId) {
  for (const [token, session] of activeSessions.entries()) {
    if (session.userId === userId) {
      activeSessions.delete(token);
    }
  }
  return { success: true };
}

/**
 * Verify access token and return user
 * @param {string} token - Access token
 * @returns {Object|null} User data or null
 */
export async function verifyAccessToken(token) {
  const payload = verifyToken(token);
  
  if (!payload || payload.type !== 'access') {
    return null;
  }
  
  const user = await getUserById(payload.sub);
  
  if (!user || !user.isActive) {
    return null;
  }
  
  return user;
}

/**
 * Express middleware - require authentication
 */
export function requireAuth(req, res, next) {
  // Skip for OPTIONS requests
  if (req.method === 'OPTIONS') {
    return next();
  }
  
  const token = extractToken(req);
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  verifyAccessToken(token).then(user => {
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    req.user = user;
    next();
  }).catch(err => {
    console.error('[Auth] Error verifying token:', err);
    return res.status(500).json({ error: 'Authentication error' });
  });
}

/**
 * Express middleware - optional authentication
 * (attaches user if token valid, but doesn't require it)
 */
export function optionalAuth(req, res, next) {
  const token = extractToken(req);
  
  if (!token) {
    return next();
  }
  
  verifyAccessToken(token).then(user => {
    if (user) {
      req.user = user;
    }
    next();
  }).catch(() => {
    next();
  });
}

/**
 * Set authentication cookies
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Object} tokens - Tokens object
 */
export function setAuthCookies(req, res, tokens) {
  const secure = isSecureRequest(req);
  
  res.setHeader('Set-Cookie', [
    buildCookie({
      name: SESSION_COOKIE_NAME,
      value: tokens.accessToken,
      maxAge: tokens.expiresIn,
      httpOnly: true,
      sameSite: 'Strict',
      secure
    }),
    buildCookie({
      name: REFRESH_COOKIE_NAME,
      value: tokens.refreshToken,
      maxAge: tokens.refreshExpiresIn,
      httpOnly: true,
      sameSite: 'Strict',
      secure
    })
  ]);
}

/**
 * Clear authentication cookies
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
export function clearAuthCookies(req, res) {
  const secure = isSecureRequest(req);
  
  res.setHeader('Set-Cookie', [
    buildCookie({
      name: SESSION_COOKIE_NAME,
      value: '',
      maxAge: 0,
      httpOnly: true,
      sameSite: 'Strict',
      secure
    }),
    buildCookie({
      name: REFRESH_COOKIE_NAME,
      value: '',
      maxAge: 0,
      httpOnly: true,
      sameSite: 'Strict',
      secure
    })
  ]);
}

/**
 * Get current session info
 * @param {Object} req - Express request
 * @returns {Object} Session status
 */
export function getSessionInfo(req) {
  const token = extractToken(req);
  
  if (!token) {
    return { authenticated: false };
  }
  
  const payload = verifyToken(token);
  if (!payload) {
    return { authenticated: false };
  }
  
  return {
    authenticated: true,
    userId: payload.sub,
    username: payload.username,
    role: payload.role,
    expiresAt: payload.exp * 1000
  };
}

/**
 * Extract refresh token from request
 * @param {Object} req - Express request
 * @returns {string|null}
 */
export function extractRefreshToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[REFRESH_COOKIE_NAME] || null;
}

export default {
  login,
  logout,
  logoutAllSessions,
  refreshAccessToken,
  verifyAccessToken,
  requireAuth,
  optionalAuth,
  setAuthCookies,
  clearAuthCookies,
  getSessionInfo,
  extractRefreshToken,
  generateTokens
};
