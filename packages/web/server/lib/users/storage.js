import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const fsPromises = fs.promises;

// Default paths for multiuser data
const MULTIUSER_DATA_DIR = process.env.OPENCHAMBER_MULTIUSER_DIR 
  ? path.resolve(process.env.OPENCHAMBER_MULTIUSER_DIR)
  : path.join(os.homedir(), '.config', 'openchamber', 'multiuser');

const USERS_FILE_PATH = path.join(MULTIUSER_DATA_DIR, 'users.json');
const SESSIONS_DIR = path.join(MULTIUSER_DATA_DIR, 'sessions');

// Default roles and permissions
const DEFAULT_ROLES = {
  admin: {
    name: 'Administrator',
    permissions: ['*'], // All permissions
    description: 'Full system access'
  },
  developer: {
    name: 'Developer',
    permissions: [
      'project:read', 'project:write', 'project:delete',
      'session:read', 'session:write', 'session:delete',
      'settings:read', 'settings:write:self',
      'instance:read', 'instance:write',
      'terminal:read', 'terminal:write',
      'git:read', 'git:write'
    ],
    description: 'Standard development access'
  },
  viewer: {
    name: 'Viewer',
    permissions: [
      'project:read',
      'session:read',
      'settings:read'
    ],
    description: 'Read-only access'
  }
};

const DEFAULT_USERS_CONFIG = {
  version: '1.0',
  users: [],
  roles: DEFAULT_ROLES,
  settings: {
    allowRegistration: false,
    defaultRole: 'developer',
    sessionTTL: 12 * 60 * 60 * 1000, // 12 hours
    maxUsers: 100,
    passwordPolicy: {
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChars: true
    }
  }
};

// In-memory cache
let usersCache = null;
let usersCacheTimestamp = 0;
const CACHE_TTL = 5000; // 5 seconds

// File lock for concurrent access
let usersFileLock = Promise.resolve();

/**
 * Ensure multiuser directories exist
 */
async function ensureDirectories() {
  try {
    await fsPromises.mkdir(MULTIUSER_DATA_DIR, { recursive: true });
    await fsPromises.mkdir(SESSIONS_DIR, { recursive: true });
  } catch (err) {
    console.error('[UserStorage] Failed to create directories:', err.message);
    throw err;
  }
}

/**
 * Initialize users file with defaults if it doesn't exist
 */
async function initializeUsersFile() {
  try {
    await fsPromises.access(USERS_FILE_PATH);
  } catch {
    // File doesn't exist, create with defaults
    await saveUsersData(DEFAULT_USERS_CONFIG);
    console.log('[UserStorage] Initialized users file with defaults');
  }
}

/**
 * Load users data from disk with caching
 */
async function loadUsersData() {
  const now = Date.now();
  
  // Return cached data if still valid
  if (usersCache && (now - usersCacheTimestamp) < CACHE_TTL) {
    return usersCache;
  }

  await ensureDirectories();
  await initializeUsersFile();

  try {
    const content = await fsPromises.readFile(USERS_FILE_PATH, 'utf-8');
    const data = JSON.parse(content);
    
    // Ensure required fields exist
    if (!data.roles) data.roles = DEFAULT_ROLES;
    if (!data.settings) data.settings = DEFAULT_USERS_CONFIG.settings;
    
    usersCache = data;
    usersCacheTimestamp = now;
    
    return data;
  } catch (err) {
    console.error('[UserStorage] Failed to load users data:', err.message);
    return DEFAULT_USERS_CONFIG;
  }
}

/**
 * Save users data to disk with file locking
 */
async function saveUsersData(data) {
  return usersFileLock = usersFileLock.then(async () => {
    try {
      await ensureDirectories();
      
      // Write to temp file first, then rename for atomic operation
      const tempPath = `${USERS_FILE_PATH}.tmp`;
      await fsPromises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      await fsPromises.rename(tempPath, USERS_FILE_PATH);
      
      // Update cache
      usersCache = data;
      usersCacheTimestamp = Date.now();
      
      return true;
    } catch (err) {
      console.error('[UserStorage] Failed to save users data:', err.message);
      throw err;
    }
  });
}

/**
 * Generate a unique user ID
 */
function generateUserId() {
  return `user_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Hash a password using scrypt
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * Verify a password against a hash
 */
function verifyPassword(password, hashedPassword) {
  try {
    const [saltBase64, hashBase64] = hashedPassword.split('$');
    if (!saltBase64 || !hashBase64) return false;
    
    const salt = Buffer.from(saltBase64, 'base64');
    const expectedHash = Buffer.from(hashBase64, 'base64');
    const candidateHash = crypto.scryptSync(password, salt, 64);
    
    return crypto.timingSafeEqual(candidateHash, expectedHash);
  } catch {
    return false;
  }
}

/**
 * Validate password against policy
 */
function validatePassword(password, policy) {
  const errors = [];
  
  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters`);
  }
  
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain uppercase letters');
  }
  
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain lowercase letters');
  }
  
  if (policy.requireNumbers && !/\d/.test(password)) {
    errors.push('Password must contain numbers');
  }
  
  if (policy.requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain special characters');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate username format
 */
function validateUsername(username) {
  if (typeof username !== 'string' || username.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return { valid: false, error: 'Username can only contain letters, numbers, underscores, and hyphens' };
  }
  
  return { valid: true };
}

/**
 * Validate email format
 */
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }
  return { valid: true };
}

/**
 * Get user data directory path
 */
export function getUserDataPath(userId) {
  return path.join(MULTIUSER_DATA_DIR, 'users', userId);
}

/**
 * Ensure user data directory exists
 */
export async function ensureUserDataDir(userId) {
  const userDir = getUserDataPath(userId);
  const subdirs = ['settings', 'projects', 'themes', 'opencode'];
  
  try {
    await fsPromises.mkdir(userDir, { recursive: true });
    
    for (const subdir of subdirs) {
      await fsPromises.mkdir(path.join(userDir, subdir), { recursive: true });
    }
    
    return userDir;
  } catch (err) {
    console.error(`[UserStorage] Failed to create user dir for ${userId}:`, err.message);
    throw err;
  }
}

/**
 * Create a new user
 */
export async function createUser(userData) {
  const data = await loadUsersData();
  
  // Check max users limit
  if (data.users.length >= data.settings.maxUsers) {
    throw new Error('Maximum number of users reached');
  }
  
  // Validate username
  const usernameValidation = validateUsername(userData.username);
  if (!usernameValidation.valid) {
    throw new Error(usernameValidation.error);
  }
  
  // Check for duplicate username
  if (data.users.some(u => u.username.toLowerCase() === userData.username.toLowerCase())) {
    throw new Error('Username already exists');
  }
  
  // Validate email if provided
  if (userData.email) {
    const emailValidation = validateEmail(userData.email);
    if (!emailValidation.valid) {
      throw new Error(emailValidation.error);
    }
    
    // Check for duplicate email
    if (data.users.some(u => u.email?.toLowerCase() === userData.email.toLowerCase())) {
      throw new Error('Email already exists');
    }
  }
  
  // Validate password
  const passwordValidation = validatePassword(userData.password, data.settings.passwordPolicy);
  if (!passwordValidation.valid) {
    throw new Error(passwordValidation.errors.join(', '));
  }
  
  // Validate role
  const role = userData.role || data.settings.defaultRole;
  if (!data.roles[role]) {
    throw new Error(`Invalid role: ${role}`);
  }
  
  const now = Date.now();
  const newUser = {
    id: generateUserId(),
    username: userData.username.toLowerCase(),
    email: userData.email?.toLowerCase() || null,
    passwordHash: hashPassword(userData.password),
    role,
    isActive: userData.isActive !== false, // default to true
    createdAt: now,
    lastLoginAt: null,
    preferences: {
      theme: 'dark',
      language: 'en',
      ...userData.preferences
    },
    opencodeConfig: {
      mode: 'dedicated', // or 'shared'
      resources: {
        maxMemoryMB: 2048,
        maxDiskGB: 10,
        ...userData.opencodeConfig?.resources
      },
      ...userData.opencodeConfig
    },
    metadata: {
      displayName: userData.displayName || userData.username,
      avatar: userData.avatar || null,
      ...userData.metadata
    }
  };
  
  data.users.push(newUser);
  await saveUsersData(data);
  
  // Create user data directory
  await ensureUserDataDir(newUser.id);
  
  // Return user without password hash
  const { passwordHash, ...userWithoutPassword } = newUser;
  return userWithoutPassword;
}

/**
 * Get user by ID
 */
export async function getUserById(userId) {
  const data = await loadUsersData();
  const user = data.users.find(u => u.id === userId);
  
  if (!user) return null;
  
  const { passwordHash, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

/**
 * Get user by username
 */
export async function getUserByUsername(username) {
  const data = await loadUsersData();
  const user = data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  
  if (!user) return null;
  
  return user;
}

/**
 * Get user by email
 */
export async function getUserByEmail(email) {
  if (!email) return null;
  
  const data = await loadUsersData();
  const user = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
  
  if (!user) return null;
  
  return user;
}

/**
 * Authenticate user with username/password
 */
export async function authenticateUser(username, password) {
  const user = await getUserByUsername(username);
  
  if (!user) {
    return { success: false, error: 'Invalid credentials' };
  }
  
  if (!user.isActive) {
    return { success: false, error: 'Account is disabled' };
  }
  
  if (!verifyPassword(password, user.passwordHash)) {
    return { success: false, error: 'Invalid credentials' };
  }
  
  // Update last login time
  const data = await loadUsersData();
  const userIndex = data.users.findIndex(u => u.id === user.id);
  if (userIndex >= 0) {
    data.users[userIndex].lastLoginAt = Date.now();
    await saveUsersData(data);
  }
  
  const { passwordHash, ...userWithoutPassword } = user;
  return { success: true, user: userWithoutPassword };
}

/**
 * Update user
 */
export async function updateUser(userId, updates) {
  const data = await loadUsersData();
  const userIndex = data.users.findIndex(u => u.id === userId);
  
  if (userIndex === -1) {
    throw new Error('User not found');
  }
  
  const user = data.users[userIndex];
  const allowedUpdates = ['email', 'role', 'isActive', 'preferences', 'opencodeConfig', 'metadata'];
  
  for (const key of allowedUpdates) {
    if (updates[key] !== undefined) {
      if (key === 'preferences' || key === 'opencodeConfig' || key === 'metadata') {
        user[key] = { ...user[key], ...updates[key] };
      } else {
        user[key] = updates[key];
      }
    }
  }
  
  // Special handling for password change
  if (updates.password) {
    const passwordValidation = validatePassword(updates.password, data.settings.passwordPolicy);
    if (!passwordValidation.valid) {
      throw new Error(passwordValidation.errors.join(', '));
    }
    user.passwordHash = hashPassword(updates.password);
  }
  
  user.updatedAt = Date.now();
  await saveUsersData(data);
  
  const { passwordHash, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

/**
 * Delete user
 */
export async function deleteUser(userId) {
  const data = await loadUsersData();
  const userIndex = data.users.findIndex(u => u.id === userId);
  
  if (userIndex === -1) {
    throw new Error('User not found');
  }
  
  // Remove user from list
  data.users.splice(userIndex, 1);
  await saveUsersData(data);
  
  // Optionally: clean up user data directory
  // await fsPromises.rm(getUserDataPath(userId), { recursive: true, force: true });
  
  return true;
}

/**
 * List all users
 */
export async function listUsers(options = {}) {
  const data = await loadUsersData();
  let users = data.users.map(u => {
    const { passwordHash, ...userWithoutPassword } = u;
    return userWithoutPassword;
  });
  
  // Filter by role
  if (options.role) {
    users = users.filter(u => u.role === options.role);
  }
  
  // Filter by active status
  if (options.isActive !== undefined) {
    users = users.filter(u => u.isActive === options.isActive);
  }
  
  // Pagination
  const page = options.page || 1;
  const limit = options.limit || 50;
  const start = (page - 1) * limit;
  const paginatedUsers = users.slice(start, start + limit);
  
  return {
    users: paginatedUsers,
    total: users.length,
    page,
    limit,
    totalPages: Math.ceil(users.length / limit)
  };
}

/**
 * Get role definition
 */
export async function getRole(roleName) {
  const data = await loadUsersData();
  return data.roles[roleName] || null;
}

/**
 * List all roles
 */
export async function listRoles() {
  const data = await loadUsersData();
  return data.roles;
}

/**
 * Create or update role
 */
export async function saveRole(roleName, roleData) {
  const data = await loadUsersData();
  
  data.roles[roleName] = {
    name: roleData.name || roleName,
    permissions: roleData.permissions || [],
    description: roleData.description || ''
  };
  
  await saveUsersData(data);
  return data.roles[roleName];
}

/**
 * Delete role (cannot delete if users are assigned)
 */
export async function deleteRole(roleName) {
  const data = await loadUsersData();
  
  // Check if any users have this role
  const usersWithRole = data.users.filter(u => u.role === roleName);
  if (usersWithRole.length > 0) {
    throw new Error(`Cannot delete role: ${usersWithRole.length} users are assigned to it`);
  }
  
  delete data.roles[roleName];
  await saveUsersData(data);
  
  return true;
}

/**
 * Update global settings
 */
export async function updateSettings(settings) {
  const data = await loadUsersData();
  data.settings = { ...data.settings, ...settings };
  await saveUsersData(data);
  return data.settings;
}

/**
 * Get global settings
 */
export async function getSettings() {
  const data = await loadUsersData();
  return data.settings;
}

/**
 * Invalidate cache (useful for testing or manual updates)
 */
export function invalidateCache() {
  usersCache = null;
  usersCacheTimestamp = 0;
}

/**
 * Get multiuser data directory path
 */
export function getMultiuserDataDir() {
  return MULTIUSER_DATA_DIR;
}

export default {
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
};
