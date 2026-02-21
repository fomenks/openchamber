#!/usr/bin/env node

/**
 * Migration Script for Multiuser Mode
 * 
 * This script migrates existing single-user data to multiuser mode.
 * It should be run once when enabling multiuser mode for the first time.
 * 
 * Usage:
 *   node migrate-to-multiuser.js [--admin-username=<name>] [--admin-password=<pass>]
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const LEGACY_CONFIG_DIR = path.join(os.homedir(), '.config', 'openchamber');
const LEGACY_SETTINGS_FILE = path.join(LEGACY_CONFIG_DIR, 'settings.json');
const MULTIUSER_DIR = path.join(LEGACY_CONFIG_DIR, 'multiuser');

// Parse arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.substring(2).split('=');
    acc[key] = value || true;
  }
  return acc;
}, {});

async function main() {
  console.log('='.repeat(60));
  console.log('OpenChamber Multiuser Migration Tool');
  console.log('='.repeat(60));
  console.log();
  
  // Check if already migrated
  if (fs.existsSync(path.join(MULTIUSER_DIR, 'users.json'))) {
    console.log('⚠️  Migration appears to have already been run.');
    console.log('   Found existing multiuser data.');
    console.log();
    console.log('To re-run migration, delete the following directory:');
    console.log(`   ${MULTIUSER_DIR}`);
    console.log();
    process.exit(0);
  }
  
  // Load legacy settings
  console.log('📂 Loading legacy settings...');
  let legacySettings = {};
  
  try {
    if (fs.existsSync(LEGACY_SETTINGS_FILE)) {
      const content = fs.readFileSync(LEGACY_SETTINGS_FILE, 'utf-8');
      legacySettings = JSON.parse(content);
      console.log('   ✓ Loaded settings.json');
    } else {
      console.log('   ⚠️  No existing settings found, starting fresh');
    }
  } catch (err) {
    console.error('   ✗ Failed to load settings:', err.message);
    process.exit(1);
  }
  
  // Create multiuser directory structure
  console.log();
  console.log('📁 Creating multiuser directory structure...');
  
  try {
    fs.mkdirSync(MULTIUSER_DIR, { recursive: true });
    fs.mkdirSync(path.join(MULTIUSER_DIR, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(MULTIUSER_DIR, 'users'), { recursive: true });
    fs.mkdirSync(path.join(MULTIUSER_DIR, 'temp'), { recursive: true });
    console.log('   ✓ Created directories');
  } catch (err) {
    console.error('   ✗ Failed to create directories:', err.message);
    process.exit(1);
  }
  
  // Create admin user
  console.log();
  console.log('👤 Creating administrator account...');
  
  const adminUsername = args['admin-username'] || 'admin';
  const adminPassword = args['admin-password'] || generateSecurePassword();
  const adminEmail = args['admin-email'] || null;
  
  const crypto = await import('crypto');
  const salt = crypto.randomBytes(16);
  const passwordHash = crypto.scryptSync(adminPassword, salt, 64);
  const hashedPassword = `${salt.toString('base64')}$${passwordHash.toString('base64')}`;
  
  const adminUser = {
    id: `user_${crypto.randomBytes(8).toString('hex')}`,
    username: adminUsername.toLowerCase(),
    email: adminEmail,
    passwordHash: hashedPassword,
    role: 'admin',
    isActive: true,
    createdAt: Date.now(),
    lastLoginAt: null,
    preferences: {
      theme: legacySettings.themeId || 'dark',
      language: 'en'
    },
    opencodeConfig: {
      mode: 'dedicated',
      resources: {
        maxMemoryMB: 4096,
        maxDiskGB: 50
      }
    },
    metadata: {
      displayName: 'Administrator',
      avatar: null
    }
  };
  
  // Create users.json
  const usersData = {
    version: '1.0',
    users: [adminUser],
    roles: {
      admin: {
        name: 'Administrator',
        permissions: ['*'],
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
        permissions: ['project:read', 'session:read', 'settings:read'],
        description: 'Read-only access'
      }
    },
    settings: {
      allowRegistration: false,
      defaultRole: 'developer',
      sessionTTL: 12 * 60 * 60 * 1000,
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
  
  try {
    fs.writeFileSync(
      path.join(MULTIUSER_DIR, 'users.json'),
      JSON.stringify(usersData, null, 2),
      'utf-8'
    );
    console.log('   ✓ Created users.json');
  } catch (err) {
    console.error('   ✗ Failed to create users.json:', err.message);
    process.exit(1);
  }
  
  // Migrate legacy data to admin user
  console.log();
  console.log('📦 Migrating legacy data to admin user...');
  
  const adminDataDir = path.join(MULTIUSER_DIR, 'users', adminUser.id);
  
  try {
    fs.mkdirSync(path.join(adminDataDir, 'settings'), { recursive: true });
    fs.mkdirSync(path.join(adminDataDir, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(adminDataDir, 'themes'), { recursive: true });
    fs.mkdirSync(path.join(adminDataDir, 'opencode'), { recursive: true });
    
    // Migrate settings
    const userSettings = {
      ...legacySettings,
      // Remove sensitive or user-specific fields if needed
    };
    
    fs.writeFileSync(
      path.join(adminDataDir, 'settings.json'),
      JSON.stringify(userSettings, null, 2),
      'utf-8'
    );
    
    // Copy custom themes if any
    const legacyThemesDir = path.join(LEGACY_CONFIG_DIR, 'themes');
    if (fs.existsSync(legacyThemesDir)) {
      const themes = fs.readdirSync(legacyThemesDir);
      for (const theme of themes) {
        const src = path.join(legacyThemesDir, theme);
        const dest = path.join(adminDataDir, 'themes', theme);
        fs.copyFileSync(src, dest);
      }
      console.log(`   ✓ Migrated ${themes.length} custom themes`);
    }
    
    console.log('   ✓ Migrated settings and themes');
  } catch (err) {
    console.error('   ✗ Failed to migrate data:', err.message);
    process.exit(1);
  }
  
  // Create migration marker
  console.log();
  console.log('🏷️  Creating migration marker...');
  
  const migrationInfo = {
    migratedAt: Date.now(),
    fromVersion: legacySettings.version || 'legacy',
    toVersion: '1.0',
    adminUserId: adminUser.id,
    originalSettingsPath: LEGACY_SETTINGS_FILE
  };
  
  fs.writeFileSync(
    path.join(MULTIUSER_DIR, '.migration'),
    JSON.stringify(migrationInfo, null, 2),
    'utf-8'
  );
  
  // Summary
  console.log();
  console.log('='.repeat(60));
  console.log('✅ Migration completed successfully!');
  console.log('='.repeat(60));
  console.log();
  console.log('Administrator Account:');
  console.log(`  Username: ${adminUsername}`);
  console.log(`  Password: ${adminPassword}`);
  if (adminEmail) {
    console.log(`  Email:    ${adminEmail}`);
  }
  console.log();
  console.log('Next steps:');
  console.log('  1. Start OpenChamber with multiuser mode:');
  console.log('     OPENCHAMBER_MULTIUSER=true npm run dev');
  console.log();
  console.log('  2. Log in with the admin credentials above');
  console.log();
  console.log('  3. Create additional users via the admin panel');
  console.log();
  console.log('⚠️  IMPORTANT: Save the admin password securely!');
  if (!args['admin-password']) {
    console.log('    The generated password is shown above.');
    console.log('    You can change it after logging in.');
  }
  console.log();
}

function generateSecurePassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
