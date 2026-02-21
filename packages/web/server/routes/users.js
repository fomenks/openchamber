import { Router } from 'express';
import {
  createUser,
  getUserById,
  updateUser,
  deleteUser,
  listUsers,
  listRoles,
  saveRole,
  deleteRole,
  getSettings,
  updateSettings
} from '../lib/users/storage.js';
import { requireAuth } from '../lib/users/auth.js';
import { requirePermission, canManageUser, PERMISSIONS } from '../lib/users/rbac.js';

const router = Router();

/**
 * GET /api/users
 * List all users (admin only)
 */
router.get('/',
  requireAuth,
  requirePermission(PERMISSIONS.USER_READ),
  async (req, res) => {
    try {
      const options = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 50,
        role: req.query.role,
        isActive: req.query.isActive !== undefined 
          ? req.query.isActive === 'true' 
          : undefined
      };
      
      const result = await listUsers(options);
      res.json(result);
    } catch (err) {
      console.error('[Users API] List users error:', err);
      res.status(500).json({ error: 'Failed to list users' });
    }
  }
);

/**
 * POST /api/users
 * Create a new user (admin only)
 */
router.post('/',
  requireAuth,
  requirePermission(PERMISSIONS.USER_WRITE),
  async (req, res) => {
    try {
      const userData = req.body;
      
      // Validate required fields
      if (!userData.username || !userData.password) {
        return res.status(400).json({
          error: 'Username and password are required'
        });
      }
      
      const newUser = await createUser(userData);
      
      res.status(201).json({
        success: true,
        user: newUser
      });
    } catch (err) {
      console.error('[Users API] Create user error:', err);
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * GET /api/users/:id
 * Get user by ID (admin or self)
 */
router.get('/:id',
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check permissions
      if (req.user.id !== id && !(await hasPermission(req.user, PERMISSIONS.USER_READ))) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const user = await getUserById(id);
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      res.json(user);
    } catch (err) {
      console.error('[Users API] Get user error:', err);
      res.status(500).json({ error: 'Failed to get user' });
    }
  }
);

/**
 * PUT /api/users/:id
 * Update user (admin or self for certain fields)
 */
router.put('/:id',
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      // Check permissions
      const isSelf = req.user.id === id;
      const canManageUsers = await hasPermission(req.user, PERMISSIONS.USER_WRITE);
      
      if (!isSelf && !canManageUsers) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Self-users can only update certain fields
      if (isSelf && !canManageUsers) {
        const allowedSelfUpdates = ['email', 'preferences', 'password'];
        const hasDisallowedFields = Object.keys(updates).some(
          key => !allowedSelfUpdates.includes(key)
        );
        
        if (hasDisallowedFields) {
          return res.status(403).json({
            error: 'You can only update your email, preferences, and password'
          });
        }
      }
      
      // Check if user can manage target user (can't manage higher/equal role)
      if (!isSelf && canManageUsers) {
        const targetUser = await getUserById(id);
        if (!targetUser) {
          return res.status(404).json({ error: 'User not found' });
        }
        
        if (!canManageUser(req.user, targetUser)) {
          return res.status(403).json({
            error: 'You cannot manage users with the same or higher role'
          });
        }
      }
      
      const updatedUser = await updateUser(id, updates);
      
      res.json({
        success: true,
        user: updatedUser
      });
    } catch (err) {
      console.error('[Users API] Update user error:', err);
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * DELETE /api/users/:id
 * Delete user (admin only, cannot delete self)
 */
router.delete('/:id',
  requireAuth,
  requirePermission(PERMISSIONS.USER_DELETE),
  async (req, res) => {
    try {
      const { id } = req.params;
      
      // Prevent self-deletion
      if (req.user.id === id) {
        return res.status(400).json({
          error: 'Cannot delete your own account'
        });
      }
      
      // Check if can manage target user
      const targetUser = await getUserById(id);
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      if (!canManageUser(req.user, targetUser)) {
        return res.status(403).json({
          error: 'You cannot delete users with the same or higher role'
        });
      }
      
      await deleteUser(id);
      
      res.json({ success: true });
    } catch (err) {
      console.error('[Users API] Delete user error:', err);
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * GET /api/users/roles
 * List all roles (admin only)
 */
router.get('/roles',
  requireAuth,
  requirePermission(PERMISSIONS.ROLE_READ),
  async (req, res) => {
    try {
      const roles = await listRoles();
      res.json(roles);
    } catch (err) {
      console.error('[Users API] List roles error:', err);
      res.status(500).json({ error: 'Failed to list roles' });
    }
  }
);

/**
 * POST /api/users/roles
 * Create or update role (admin only)
 */
router.post('/roles',
  requireAuth,
  requirePermission(PERMISSIONS.ROLE_WRITE),
  async (req, res) => {
    try {
      const { name, ...roleData } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: 'Role name is required' });
      }
      
      // Prevent modifying system roles via API
      const protectedRoles = ['admin', 'developer', 'viewer'];
      if (protectedRoles.includes(name) && req.body.permissions) {
        return res.status(403).json({
          error: 'Cannot modify system role permissions'
        });
      }
      
      const role = await saveRole(name, roleData);
      
      res.json({
        success: true,
        role
      });
    } catch (err) {
      console.error('[Users API] Save role error:', err);
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * DELETE /api/users/roles/:name
 * Delete role (admin only)
 */
router.delete('/roles/:name',
  requireAuth,
  requirePermission(PERMISSIONS.ROLE_WRITE),
  async (req, res) => {
    try {
      const { name } = req.params;
      
      // Prevent deleting system roles
      const protectedRoles = ['admin', 'developer', 'viewer'];
      if (protectedRoles.includes(name)) {
        return res.status(403).json({
          error: 'Cannot delete system roles'
        });
      }
      
      await deleteRole(name);
      
      res.json({ success: true });
    } catch (err) {
      console.error('[Users API] Delete role error:', err);
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * GET /api/users/settings
 * Get global settings (admin only)
 */
router.get('/settings',
  requireAuth,
  requirePermission(PERMISSIONS.SYSTEM_CONFIG),
  async (req, res) => {
    try {
      const settings = await getSettings();
      res.json(settings);
    } catch (err) {
      console.error('[Users API] Get settings error:', err);
      res.status(500).json({ error: 'Failed to get settings' });
    }
  }
);

/**
 * PUT /api/users/settings
 * Update global settings (admin only)
 */
router.put('/settings',
  requireAuth,
  requirePermission(PERMISSIONS.SYSTEM_CONFIG),
  async (req, res) => {
    try {
      const settings = await updateSettings(req.body);
      res.json({
        success: true,
        settings
      });
    } catch (err) {
      console.error('[Users API] Update settings error:', err);
      res.status(400).json({ error: err.message });
    }
  }
);

// Helper function for permission check
async function hasPermission(user, permission) {
  const { hasPermission: checkPermission } = await import('../lib/users/rbac.js');
  return checkPermission(user, permission);
}

export default router;
