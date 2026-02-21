/**
 * User Management Module for OpenChamber Multiuser Mode
 * 
 * This module provides comprehensive user management including:
 * - User CRUD operations
 * - Authentication (JWT-based)
 * - Role-based access control (RBAC)
 * - Session management
 */

// Storage operations
export {
  createUser,
  getUserById,
  getUserByUsername,
  getUserByEmail,
  authenticateUser,
  updateUser,
  deleteUser,
  listUsers,
  getRole,
  listRoles,
  saveRole,
  deleteRole,
  getSettings,
  updateSettings,
  getUserDataPath,
  ensureUserDataDir,
  getMultiuserDataDir,
  invalidateCache
} from './storage.js';

// RBAC operations
export {
  PERMISSIONS,
  WILDCARD_PERMISSION,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  getUserPermissions,
  canAccess,
  requirePermission,
  requireOwnershipOrAdmin,
  canManageUser,
  getPermissionDescription,
  getPermissionsByScope
} from './rbac.js';

// Auth operations
export {
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
} from './auth.js';

// Default export combining all
import * as storage from './storage.js';
import * as rbac from './rbac.js';
import * as auth from './auth.js';

export default {
  storage,
  rbac,
  auth
};
