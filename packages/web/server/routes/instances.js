import { Router } from 'express';
import { poolManager } from '../lib/opencode/pool.js';
import { requireAuth } from '../lib/users/auth.js';
import { requirePermission, PERMISSIONS } from '../lib/users/rbac.js';
import { getUserById } from '../lib/users/storage.js';

const router = Router();

/**
 * GET /api/instances
 * List user's instances or all instances (admin)
 */
router.get('/',
  requireAuth,
  async (req, res) => {
    try {
      // Check if admin requesting all instances
      const canViewAll = await hasPermission(req.user, PERMISSIONS.INSTANCE_ADMIN);
      
      if (canViewAll && req.query.all === 'true') {
        const stats = poolManager.getStats();
        return res.json({
          instances: stats.instances,
          stats: {
            totalInstances: stats.totalInstances,
            runningInstances: stats.runningInstances,
            usedPorts: stats.usedPorts,
            availablePorts: stats.availablePorts
          }
        });
      }
      
      // Return user's instance
      const instance = poolManager.getInstance(req.user.id);
      
      res.json({
        instances: instance ? [sanitizeInstance(instance)] : [],
        stats: null
      });
    } catch (err) {
      console.error('[Instances API] List error:', err);
      res.status(500).json({ error: 'Failed to list instances' });
    }
  }
);

/**
 * POST /api/instances
 * Create or ensure instance for current user
 */
router.post('/',
  requireAuth,
  requirePermission(PERMISSIONS.INSTANCE_WRITE),
  async (req, res) => {
    try {
      const user = await getUserById(req.user.id);
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Check if instance already exists
      const existingInstance = poolManager.getInstance(req.user.id);
      if (existingInstance) {
        return res.json({
          success: true,
          instance: sanitizeInstance(existingInstance),
          message: 'Instance already exists'
        });
      }
      
      // Create new instance with user config
      const config = {
        maxMemoryMB: user.opencodeConfig?.resources?.maxMemoryMB || 2048,
        ...req.body.config
      };
      
      const instance = await poolManager.getOrCreateInstance(req.user.id, config);
      
      res.status(201).json({
        success: true,
        instance: sanitizeInstance(instance)
      });
    } catch (err) {
      console.error('[Instances API] Create error:', err);
      res.status(500).json({ error: err.message || 'Failed to create instance' });
    }
  }
);

/**
 * GET /api/instances/:id
 * Get instance details (owner or admin)
 */
router.get('/:id',
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      // Find instance by ID
      const instance = findInstanceById(id);
      
      if (!instance) {
        return res.status(404).json({ error: 'Instance not found' });
      }
      
      // Check ownership or admin
      if (instance.userId !== req.user.id && !(await hasPermission(req.user, PERMISSIONS.INSTANCE_ADMIN))) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Check health
      const isHealthy = await poolManager.checkHealth(instance);
      
      res.json({
        instance: {
          ...sanitizeInstance(instance),
          healthy: isHealthy
        }
      });
    } catch (err) {
      console.error('[Instances API] Get error:', err);
      res.status(500).json({ error: 'Failed to get instance' });
    }
  }
);

/**
 * POST /api/instances/:id/restart
 * Restart an instance (owner or admin)
 */
router.post('/:id/restart',
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      // Find instance by ID
      const instance = findInstanceById(id);
      
      if (!instance) {
        return res.status(404).json({ error: 'Instance not found' });
      }
      
      // Check ownership or admin
      const canManage = instance.userId === req.user.id || 
                       await hasPermission(req.user, PERMISSIONS.INSTANCE_ADMIN);
      
      if (!canManage) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Destroy and recreate
      await poolManager.destroyInstance(instance.userId);
      
      const user = await getUserById(instance.userId);
      const newInstance = await poolManager.getOrCreateInstance(instance.userId, {
        maxMemoryMB: user?.opencodeConfig?.resources?.maxMemoryMB || 2048
      });
      
      res.json({
        success: true,
        instance: sanitizeInstance(newInstance)
      });
    } catch (err) {
      console.error('[Instances API] Restart error:', err);
      res.status(500).json({ error: err.message || 'Failed to restart instance' });
    }
  }
);

/**
 * DELETE /api/instances/:id
 * Destroy an instance (owner or admin)
 */
router.delete('/:id',
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      // Find instance by ID
      const instance = findInstanceById(id);
      
      if (!instance) {
        return res.status(404).json({ error: 'Instance not found' });
      }
      
      // Check ownership or admin
      const canManage = instance.userId === req.user.id || 
                       await hasPermission(req.user, PERMISSIONS.INSTANCE_ADMIN);
      
      if (!canManage) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      await poolManager.destroyInstance(instance.userId);
      
      res.json({ success: true });
    } catch (err) {
      console.error('[Instances API] Destroy error:', err);
      res.status(500).json({ error: 'Failed to destroy instance' });
    }
  }
);

/**
 * GET /api/instances/:id/status
 * Get instance health status
 */
router.get('/:id/status',
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      // Find instance by ID
      const instance = findInstanceById(id);
      
      if (!instance) {
        return res.status(404).json({ error: 'Instance not found' });
      }
      
      // Check ownership or admin
      if (instance.userId !== req.user.id && !(await hasPermission(req.user, PERMISSIONS.INSTANCE_ADMIN))) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const isHealthy = await poolManager.checkHealth(instance);
      
      res.json({
        id: instance.id,
        status: instance.status,
        healthy: isHealthy,
        lastActivity: instance.lastActivity
      });
    } catch (err) {
      console.error('[Instances API] Status error:', err);
      res.status(500).json({ error: 'Failed to get status' });
    }
  }
);

/**
 * POST /api/instances/:id/activity
 * Report activity to keep instance alive
 */
router.post('/:id/activity',
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      // Find instance by ID
      const instance = findInstanceById(id);
      
      if (!instance) {
        return res.status(404).json({ error: 'Instance not found' });
      }
      
      // Only owner can report activity
      if (instance.userId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Update activity
      instance.lastActivity = Date.now();
      
      res.json({ success: true });
    } catch (err) {
      console.error('[Instances API] Activity error:', err);
      res.status(500).json({ error: 'Failed to report activity' });
    }
  }
);

/**
 * GET /api/instances/stats
 * Get pool statistics (admin only)
 */
router.get('/stats',
  requireAuth,
  requirePermission(PERMISSIONS.INSTANCE_ADMIN),
  async (req, res) => {
    try {
      const stats = poolManager.getStats();
      res.json(stats);
    } catch (err) {
      console.error('[Instances API] Stats error:', err);
      res.status(500).json({ error: 'Failed to get stats' });
    }
  }
);

// Helper function to find instance by ID
function findInstanceById(id) {
  for (const instance of poolManager.instances.values()) {
    if (instance.id === id) {
      return instance;
    }
  }
  return null;
}

// Helper function to sanitize instance for API response
function sanitizeInstance(instance) {
  return {
    id: instance.id,
    userId: instance.userId,
    port: instance.port,
    status: instance.status,
    createdAt: instance.createdAt,
    lastActivity: instance.lastActivity,
    config: {
      maxMemoryMB: instance.config.maxMemoryMB
    }
  };
}

// Helper function for permission check
async function hasPermission(user, permission) {
  const { hasPermission: checkPermission } = await import('../lib/users/rbac.js');
  return checkPermission(user, permission);
}

export default router;
