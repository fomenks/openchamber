import path from 'path';
import { getUserDataPath, ensureUserDataDir, getMultiuserDataDir } from '../users/storage.js';

/**
 * Tenant isolation middleware
 * Attaches tenant-specific paths and data to the request object
 */
export function tenantIsolation(req, res, next) {
  // Skip if no authenticated user
  if (!req.user) {
    return next();
  }
  
  const userId = req.user.id;
  const tenantId = userId; // In this implementation, tenant = user
  
  // Set up tenant paths
  req.tenant = {
    id: tenantId,
    userId: userId,
    paths: {
      root: getUserDataPath(userId),
      settings: path.join(getUserDataPath(userId), 'settings.json'),
      projects: path.join(getUserDataPath(userId), 'projects.json'),
      themes: path.join(getUserDataPath(userId), 'themes'),
      opencode: path.join(getUserDataPath(userId), 'opencode'),
      temp: path.join(getMultiuserDataDir(), 'temp', userId)
    }
  };
  
  next();
}

/**
 * Middleware to ensure tenant directories exist
 */
export async function ensureTenantDirs(req, res, next) {
  if (!req.user) {
    return next();
  }
  
  try {
    await ensureUserDataDir(req.user.id);
    next();
  } catch (err) {
    console.error('[Tenant] Failed to ensure directories:', err);
    res.status(500).json({ error: 'Failed to initialize user workspace' });
  }
}

/**
 * Get tenant-scoped file path
 * @param {string} tenantId - Tenant ID (user ID)
 * @param {string} filePath - Relative file path
 * @returns {string} Absolute path within tenant directory
 */
export function getTenantPath(tenantId, filePath) {
  const tenantRoot = getUserDataPath(tenantId);
  
  // Prevent directory traversal
  const resolved = path.resolve(tenantRoot, filePath);
  if (!resolved.startsWith(tenantRoot)) {
    throw new Error('Path traversal detected');
  }
  
  return resolved;
}

/**
 * Validate that a path belongs to the tenant
 * @param {string} tenantId - Tenant ID
 * @param {string} checkPath - Path to validate
 * @returns {boolean}
 */
export function isPathInTenant(tenantId, checkPath) {
  const tenantRoot = getUserDataPath(tenantId);
  const resolved = path.resolve(checkPath);
  return resolved.startsWith(tenantRoot);
}

/**
 * Tenant-aware settings loader
 * Wraps the existing settings system to add tenant isolation
 */
export function createTenantSettingsLoader(baseSettingsLoader) {
  return {
    /**
     * Load settings for the current tenant
     */
    async load(req) {
      if (!req.tenant) {
        // Fallback to base loader if no tenant
        return baseSettingsLoader.load();
      }
      
      try {
        const fs = await import('fs');
        const content = await fs.promises.readFile(req.tenant.paths.settings, 'utf-8');
        return JSON.parse(content);
      } catch (err) {
        if (err.code === 'ENOENT') {
          // Return default settings if file doesn't exist
          return baseSettingsLoader.getDefaults?.() || {};
        }
        throw err;
      }
    },
    
    /**
     * Save settings for the current tenant
     */
    async save(req, settings) {
      if (!req.tenant) {
        throw new Error('Tenant context required');
      }
      
      const fs = await import('fs');
      await fs.promises.mkdir(path.dirname(req.tenant.paths.settings), { recursive: true });
      await fs.promises.writeFile(
        req.tenant.paths.settings,
        JSON.stringify(settings, null, 2),
        'utf-8'
      );
      
      return settings;
    }
  };
}

/**
 * Middleware to inject tenant-aware services into request
 */
export function injectTenantServices(services) {
  return (req, res, next) => {
    if (!req.tenant) {
      return next();
    }
    
    // Create tenant-scoped service instances
    req.tenantServices = {};
    
    for (const [name, serviceFactory] of Object.entries(services)) {
      req.tenantServices[name] = serviceFactory(req.tenant);
    }
    
    next();
  };
}

export default {
  tenantIsolation,
  ensureTenantDirs,
  getTenantPath,
  isPathInTenant,
  createTenantSettingsLoader,
  injectTenantServices
};
