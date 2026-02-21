/**
 * Multiuser Mode Configuration
 * 
 * This module manages the multiuser mode configuration and feature flags.
 * When enabled, the server switches from single-user to multi-user mode
 * with authentication, RBAC, and per-user OpenCode instances.
 */

import { getSettings } from './lib/users/storage.js';

// Feature flag - can be set via environment variable
const MULTIUSER_ENABLED = process.env.OPENCHAMBER_MULTIUSER === 'true' || 
                          process.env.OPENCHAMBER_MULTIUSER === '1';

// Runtime configuration
let runtimeConfig = {
  enabled: MULTIUSER_ENABLED,
  mode: 'single', // 'single' or 'multi'
  features: {
    authentication: true,
    rbac: true,
    perUserInstances: true,
    tenantIsolation: true
  },
  limits: {
    maxUsers: 100,
    maxInstances: 100,
    maxConcurrentSessions: 1000
  }
};

/**
 * Check if multiuser mode is enabled
 * @returns {boolean}
 */
export function isMultiuserEnabled() {
  return runtimeConfig.enabled;
}

/**
 * Get multiuser configuration
 * @returns {Object}
 */
export function getMultiuserConfig() {
  return { ...runtimeConfig };
}

/**
 * Update multiuser configuration (admin only)
 * @param {Object} updates - Configuration updates
 */
export async function updateMultiuserConfig(updates) {
  runtimeConfig = {
    ...runtimeConfig,
    ...updates,
    features: {
      ...runtimeConfig.features,
      ...(updates.features || {})
    },
    limits: {
      ...runtimeConfig.limits,
      ...(updates.limits || {})
    }
  };
  
  return runtimeConfig;
}

/**
 * Initialize multiuser mode
 * This function checks if multiuser mode should be enabled
 * based on environment variables and settings
 */
export async function initializeMultiuserMode() {
  if (!MULTIUSER_ENABLED) {
    console.log('[Multiuser] Running in single-user mode');
    return false;
  }
  
  try {
    // Load settings from storage
    const settings = await getSettings();
    
    runtimeConfig = {
      ...runtimeConfig,
      enabled: true,
      mode: 'multi',
      features: {
        ...runtimeConfig.features,
        ...(settings.features || {})
      },
      limits: {
        ...runtimeConfig.limits,
        ...(settings.limits || {})
      }
    };
    
    console.log('[Multiuser] Initialized in multi-user mode');
    console.log('[Multiuser] Features:', runtimeConfig.features);
    console.log('[Multiuser] Limits:', runtimeConfig.limits);
    
    return true;
  } catch (err) {
    console.error('[Multiuser] Failed to initialize:', err);
    runtimeConfig.enabled = false;
    return false;
  }
}

/**
 * Check if a specific feature is enabled
 * @param {string} featureName - Feature name
 * @returns {boolean}
 */
export function isFeatureEnabled(featureName) {
  if (!runtimeConfig.enabled) {
    return false;
  }
  
  return runtimeConfig.features[featureName] === true;
}

/**
 * Get middleware configuration based on mode
 * @returns {Object} Middleware configuration
 */
export function getMiddlewareConfig() {
  if (!runtimeConfig.enabled) {
    return {
      requireAuth: false,
      tenantIsolation: false,
      instancePooling: false
    };
  }
  
  return {
    requireAuth: runtimeConfig.features.authentication,
    tenantIsolation: runtimeConfig.features.tenantIsolation,
    instancePooling: runtimeConfig.features.perUserInstances
  };
}

/**
 * Create Express middleware setup for multiuser mode
 * @param {Object} app - Express app
 */
export async function setupMultiuserMiddleware(app) {
  if (!runtimeConfig.enabled) {
    return;
  }
  
  const { tenantIsolation, ensureTenantDirs } = await import('./lib/middleware/tenant.js');
  const { optionalAuth } = await import('./lib/users/auth.js');
  
  // Apply tenant isolation to all routes
  app.use(optionalAuth);
  app.use(tenantIsolation);
  app.use(ensureTenantDirs);
  
  console.log('[Multiuser] Middleware setup complete');
}

/**
 * Create admin user on first run
 * This is called during initialization if no users exist
 */
export async function ensureAdminUser() {
  const { listUsers, createUser } = await import('./lib/users/storage.js');
  
  try {
    const userList = await listUsers({ limit: 1 });
    
    if (userList.total === 0) {
      console.log('[Multiuser] No users found, creating admin user...');
      
      // Get admin credentials from environment or use defaults
      const adminUsername = process.env.OPENCHAMBER_ADMIN_USERNAME || 'admin';
      const adminPassword = process.env.OPENCHAMBER_ADMIN_PASSWORD || generateSecurePassword();
      const adminEmail = process.env.OPENCHAMBER_ADMIN_EMAIL;
      
      const admin = await createUser({
        username: adminUsername,
        password: adminPassword,
        email: adminEmail,
        role: 'admin',
        displayName: 'Administrator'
      });
      
      console.log('[Multiuser] Admin user created:');
      console.log(`  Username: ${admin.username}`);
      if (!process.env.OPENCHAMBER_ADMIN_PASSWORD) {
        console.log(`  Password: ${adminPassword}`);
        console.log('  WARNING: Please change the default password!');
      }
      
      return admin;
    }
  } catch (err) {
    console.error('[Multiuser] Failed to ensure admin user:', err);
    throw err;
  }
  
  return null;
}

/**
 * Generate a secure random password
 */
function generateSecurePassword() {
  const crypto = require('crypto');
  return crypto.randomBytes(16).toString('base64url');
}

export default {
  isMultiuserEnabled,
  getMultiuserConfig,
  updateMultiuserConfig,
  initializeMultiuserMode,
  isFeatureEnabled,
  getMiddlewareConfig,
  setupMultiuserMiddleware,
  ensureAdminUser
};
