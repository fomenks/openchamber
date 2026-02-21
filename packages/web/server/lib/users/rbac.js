import { getRole } from './storage.js';

/**
 * Permission definitions
 * Each permission has a scope and an action
 */
export const PERMISSIONS = {
  // Project permissions
  PROJECT_READ: 'project:read',
  PROJECT_WRITE: 'project:write',
  PROJECT_DELETE: 'project:delete',
  PROJECT_ADMIN: 'project:admin',
  
  // Session permissions
  SESSION_READ: 'session:read',
  SESSION_WRITE: 'session:write',
  SESSION_DELETE: 'session:delete',
  SESSION_ADMIN: 'session:admin',
  
  // Settings permissions
  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE_SELF: 'settings:write:self',
  SETTINGS_WRITE_GLOBAL: 'settings:write:global',
  
  // Instance permissions
  INSTANCE_READ: 'instance:read',
  INSTANCE_WRITE: 'instance:write',
  INSTANCE_ADMIN: 'instance:admin',
  
  // Terminal permissions
  TERMINAL_READ: 'terminal:read',
  TERMINAL_WRITE: 'terminal:write',
  
  // Git permissions
  GIT_READ: 'git:read',
  GIT_WRITE: 'git:write',
  
  // File system permissions
  FS_READ: 'fs:read',
  FS_WRITE: 'fs:write',
  FS_DELETE: 'fs:delete',
  
  // User management permissions (admin only)
  USER_READ: 'user:read',
  USER_WRITE: 'user:write',
  USER_DELETE: 'user:delete',
  USER_ADMIN: 'user:admin',
  
  // Role management permissions (admin only)
  ROLE_READ: 'role:read',
  ROLE_WRITE: 'role:write',
  ROLE_DELETE: 'role:delete',
  
  // System permissions (admin only)
  SYSTEM_ADMIN: 'system:admin',
  SYSTEM_CONFIG: 'system:config',
  SYSTEM_MONITOR: 'system:monitor'
};

/**
 * Wildcard permission - grants all permissions
 */
export const WILDCARD_PERMISSION = '*';

/**
 * Check if a user has a specific permission
 * @param {Object} user - User object with role property
 * @param {string} permission - Permission to check
 * @returns {Promise<boolean>}
 */
export async function hasPermission(user, permission) {
  if (!user || !user.role) {
    return false;
  }
  
  // Super admin check
  if (user.role === 'admin') {
    return true;
  }
  
  const role = await getRole(user.role);
  if (!role) {
    return false;
  }
  
  const permissions = role.permissions || [];
  
  // Check for wildcard
  if (permissions.includes(WILDCARD_PERMISSION)) {
    return true;
  }
  
  // Check for exact permission
  if (permissions.includes(permission)) {
    return true;
  }
  
  // Check for wildcard within scope (e.g., 'project:*' matches 'project:read')
  const [scope] = permission.split(':');
  if (permissions.includes(`${scope}:*`)) {
    return true;
  }
  
  return false;
}

/**
 * Check if a user has all of the specified permissions
 * @param {Object} user - User object
 * @param {string[]} permissions - Array of permissions to check
 * @returns {Promise<boolean>}
 */
export async function hasAllPermissions(user, permissions) {
  if (!Array.isArray(permissions)) {
    return hasPermission(user, permissions);
  }
  
  for (const permission of permissions) {
    if (!(await hasPermission(user, permission))) {
      return false;
    }
  }
  
  return true;
}

/**
 * Check if a user has any of the specified permissions
 * @param {Object} user - User object
 * @param {string[]} permissions - Array of permissions to check
 * @returns {Promise<boolean>}
 */
export async function hasAnyPermission(user, permissions) {
  if (!Array.isArray(permissions)) {
    return hasPermission(user, permissions);
  }
  
  for (const permission of permissions) {
    if (await hasPermission(user, permission)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get all permissions for a user
 * @param {Object} user - User object
 * @returns {Promise<string[]>}
 */
export async function getUserPermissions(user) {
  if (!user || !user.role) {
    return [];
  }
  
  const role = await getRole(user.role);
  if (!role) {
    return [];
  }
  
  return role.permissions || [];
}

/**
 * Check if user can access a specific resource
 * @param {Object} user - User object
 * @param {string} resource - Resource type (project, session, etc.)
 * @param {string} action - Action (read, write, delete, admin)
 * @param {Object} resourceData - Resource data for ownership check
 * @returns {Promise<boolean>}
 */
export async function canAccess(user, resource, action, resourceData = {}) {
  const permission = `${resource}:${action}`;
  
  // First check if user has the permission
  if (!(await hasPermission(user, permission))) {
    return false;
  }
  
  // For self-scoped actions, check ownership
  if (action === 'write:self' && resourceData.ownerId) {
    return user.id === resourceData.ownerId;
  }
  
  return true;
}

/**
 * Middleware factory for Express - requires specific permission
 * @param {string|string[]} permissions - Required permission(s)
 * @param {Object} options - Options
 * @returns {Function} Express middleware
 */
export function requirePermission(permissions, options = {}) {
  const { requireAll = true, errorMessage = 'Forbidden' } = options;
  
  return async (req, res, next) => {
    // User must be attached to request (by auth middleware)
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const checkFn = requireAll ? hasAllPermissions : hasAnyPermission;
    
    if (!(await checkFn(req.user, permissions))) {
      return res.status(403).json({ 
        error: errorMessage,
        required: Array.isArray(permissions) ? permissions : [permissions]
      });
    }
    
    next();
  };
}

/**
 * Middleware factory for Express - requires ownership or admin
 * @param {Function} getResourceOwner - Function to extract owner ID from request
 * @returns {Function} Express middleware
 */
export function requireOwnershipOrAdmin(getResourceOwner) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Admin can access anything
    if (req.user.role === 'admin') {
      return next();
    }
    
    // Check ownership
    const ownerId = await getResourceOwner(req);
    if (ownerId && ownerId === req.user.id) {
      return next();
    }
    
    return res.status(403).json({ error: 'Access denied' });
  };
}

/**
 * Check if user can manage another user
 * @param {Object} currentUser - Current user
 * @param {Object} targetUser - Target user to manage
 * @returns {boolean}
 */
export function canManageUser(currentUser, targetUser) {
  // Can't manage yourself through this check
  if (currentUser.id === targetUser.id) {
    return false;
  }
  
  // Admin can manage anyone
  if (currentUser.role === 'admin') {
    return true;
  }
  
  // Can't manage users with same or higher role
  const roleHierarchy = { viewer: 1, developer: 2, admin: 3 };
  const currentLevel = roleHierarchy[currentUser.role] || 0;
  const targetLevel = roleHierarchy[targetUser.role] || 0;
  
  return currentLevel > targetLevel;
}

/**
 * Get permission description
 * @param {string} permission - Permission string
 * @returns {string} Human-readable description
 */
export function getPermissionDescription(permission) {
  const descriptions = {
    [PERMISSIONS.PROJECT_READ]: 'View projects',
    [PERMISSIONS.PROJECT_WRITE]: 'Create and edit projects',
    [PERMISSIONS.PROJECT_DELETE]: 'Delete projects',
    [PERMISSIONS.PROJECT_ADMIN]: 'Full project administration',
    [PERMISSIONS.SESSION_READ]: 'View chat sessions',
    [PERMISSIONS.SESSION_WRITE]: 'Create and send messages',
    [PERMISSIONS.SESSION_DELETE]: 'Delete sessions',
    [PERMISSIONS.SETTINGS_READ]: 'View settings',
    [PERMISSIONS.SETTINGS_WRITE_SELF]: 'Edit own settings',
    [PERMISSIONS.SETTINGS_WRITE_GLOBAL]: 'Edit global settings',
    [PERMISSIONS.INSTANCE_READ]: 'View OpenCode instances',
    [PERMISSIONS.INSTANCE_WRITE]: 'Create and manage instances',
    [PERMISSIONS.TERMINAL_READ]: 'View terminal output',
    [PERMISSIONS.TERMINAL_WRITE]: 'Execute terminal commands',
    [PERMISSIONS.GIT_READ]: 'View git status and history',
    [PERMISSIONS.GIT_WRITE]: 'Execute git operations',
    [PERMISSIONS.FS_READ]: 'Read files',
    [PERMISSIONS.FS_WRITE]: 'Write files',
    [PERMISSIONS.USER_READ]: 'View users',
    [PERMISSIONS.USER_WRITE]: 'Create and edit users',
    [PERMISSIONS.USER_DELETE]: 'Delete users',
    [PERMISSIONS.ROLE_READ]: 'View roles',
    [PERMISSIONS.ROLE_WRITE]: 'Create and edit roles',
    [PERMISSIONS.SYSTEM_ADMIN]: 'Full system administration'
  };
  
  return descriptions[permission] || permission;
}

/**
 * Group permissions by scope for UI display
 * @returns {Object} Grouped permissions
 */
export function getPermissionsByScope() {
  const scopes = {};
  
  Object.values(PERMISSIONS).forEach(permission => {
    const [scope, action] = permission.split(':');
    if (!scopes[scope]) {
      scopes[scope] = [];
    }
    scopes[scope].push({
      permission,
      action,
      description: getPermissionDescription(permission)
    });
  });
  
  return scopes;
}

export default {
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
};
