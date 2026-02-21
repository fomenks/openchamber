# Multiuser Mode Integration Guide

This guide explains how to integrate the multiuser mode with the main OpenChamber server.

## Quick Integration

### 1. Import Routes

Add the multiuser routes to your Express app in `server/index.js`:

```javascript
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import instanceRoutes from './routes/instances.js';
import { 
  isMultiuserEnabled, 
  initializeMultiuserMode,
  setupMultiuserMiddleware 
} from './lib/multiuser-config.js';

// ... after creating Express app

// Initialize multiuser mode
await initializeMultiuserMode();

if (isMultiuserEnabled()) {
  // Setup multiuser middleware (tenant isolation, etc.)
  await setupMultiuserMiddleware(app);
  
  // Register routes
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/instances', instanceRoutes);
  
  console.log('[Server] Multiuser mode enabled');
} else {
  console.log('[Server] Single-user mode');
}
```

### 2. Protect Existing Routes

Wrap existing API routes with authentication middleware:

```javascript
import { requireAuth } from './lib/users/auth.js';
import { requirePermission, PERMISSIONS } from './lib/users/rbac.js';

// Example: Protect settings endpoint
app.get('/api/config/settings',
  requireAuth,
  requirePermission(PERMISSIONS.SETTINGS_READ),
  async (req, res) => {
    // Load user-specific settings
    const settings = await loadUserSettings(req.user.id);
    res.json(settings);
  }
);
```

### 3. Modify OpenCode Instance Management

Replace the single OpenCode instance with the instance pool:

```javascript
import { poolManager } from './lib/opencode/pool.js';

// Instead of single openCodeProcess, use:
async function getOpenCodeForUser(userId) {
  return poolManager.getOrCreateInstance(userId);
}

// Proxy requests to user's instance
app.use('/api', async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const response = await poolManager.proxyRequest(
      req.user.id,
      req.path,
      {
        method: req.method,
        headers: req.headers,
        body: req.method !== 'GET' && req.method !== 'HEAD' 
          ? JSON.stringify(req.body) 
          : undefined
      }
    );
    
    // Forward response
    response.body.pipe(res);
  } catch (err) {
    next(err);
  }
});
```

### 4. Update Settings Persistence

Modify settings endpoints to use tenant-aware storage:

```javascript
// GET /api/config/settings
app.get('/api/config/settings', requireAuth, async (req, res) => {
  try {
    if (!req.tenant) {
      // Fallback for non-multiuser mode
      const settings = await loadSettings();
      return res.json(settings);
    }
    
    // Load user-specific settings
    const fs = await import('fs');
    let settings = {};
    
    try {
      const content = await fs.promises.readFile(
        req.tenant.paths.settings, 
        'utf-8'
      );
      settings = JSON.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Return defaults if no settings exist
        settings = getDefaultSettings();
      } else {
        throw err;
      }
    }
    
    res.json(settings);
  } catch (err) {
    console.error('[Settings] Load error:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// POST /api/config/settings
app.post('/api/config/settings', requireAuth, async (req, res) => {
  try {
    if (!req.tenant) {
      // Fallback for non-multiuser mode
      const settings = await saveSettings(req.body);
      return res.json(settings);
    }
    
    // Check permission
    const isSelfUpdate = true; // User updating own settings
    if (!isSelfUpdate && !await hasPermission(req.user, PERMISSIONS.SETTINGS_WRITE_GLOBAL)) {
      return res.status(403).json({ error: 'Permission denied' });
    }
    
    // Validate and save settings
    const validatedSettings = validateSettings(req.body);
    
    const fs = await import('fs');
    await fs.promises.mkdir(
      path.dirname(req.tenant.paths.settings), 
      { recursive: true }
    );
    await fs.promises.writeFile(
      req.tenant.paths.settings,
      JSON.stringify(validatedSettings, null, 2),
      'utf-8'
    );
    
    res.json(validatedSettings);
  } catch (err) {
    console.error('[Settings] Save error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});
```

### 5. Handle Graceful Shutdown

Ensure instance pool is properly cleaned up on shutdown:

```javascript
import { poolManager } from './lib/opencode/pool.js';

async function gracefulShutdown() {
  console.log('[Server] Shutting down...');
  
  // Dispose all OpenCode instances
  if (isMultiuserEnabled()) {
    await poolManager.dispose();
  } else {
    // Original single-instance cleanup
    if (openCodeProcess) {
      openCodeProcess.kill('SIGTERM');
    }
  }
  
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
```

## Environment Variables

Add these to your environment:

```bash
# Enable multiuser mode
OPENCHAMBER_MULTIUSER=true

# JWT Configuration
JWT_SECRET=your-secret-key-here
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=604800

# Instance Pool Configuration
OPENCODE_PORT_RANGE_START=9000
OPENCODE_PORT_RANGE_END=10000

# Initial Admin User
OPENCHAMBER_ADMIN_USERNAME=admin
OPENCHAMBER_ADMIN_PASSWORD=secure-password
OPENCHAMBER_ADMIN_EMAIL=admin@example.com
```

## Frontend Integration

### 1. Add Auth Provider

Wrap your app with auth provider in `main.tsx`:

```tsx
import { useEffect } from 'react';
import { useAuthStore } from './stores/useAuthStore';

function App() {
  const { checkAuth, isAuthenticated } = useAuthStore();
  
  useEffect(() => {
    checkAuth();
  }, []);
  
  // ... rest of app
}
```

### 2. Add Login Page

Create a login page that uses the LoginForm component:

```tsx
// pages/LoginPage.tsx
import { LoginForm } from '../components/auth';
import { useNavigate } from 'react-router-dom';

export function LoginPage() {
  const navigate = useNavigate();
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md">
        <LoginForm 
          onSuccess={() => navigate('/dashboard')}
        />
      </div>
    </div>
  );
}
```

### 3. Protect Routes

Use ProtectedRoute in your router:

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute, AdminRoute } from './components/auth';
import { LoginPage } from './pages/LoginPage';
import { Dashboard } from './pages/Dashboard';
import { AdminPanel } from './pages/AdminPanel';

function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={
          <ProtectedRoute requireAuth={false} redirectTo="/dashboard">
            <LoginPage />
          </ProtectedRoute>
        } />
        
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
        
        <Route path="/admin" element={
          <AdminRoute>
            <AdminPanel />
          </AdminRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}
```

### 4. Add User Menu

Add the UserMenu to your header:

```tsx
import { UserMenu } from './components/auth';

function Header() {
  return (
    <header className="flex items-center justify-between p-4 border-b">
      <h1>OpenChamber</h1>
      <UserMenu />
    </header>
  );
}
```

## Testing

### Unit Tests

Example test for auth flow:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { createUser, authenticateUser } from './lib/users/storage.js';

describe('User Authentication', () => {
  beforeEach(async () => {
    // Clear test data
  });
  
  it('should create and authenticate a user', async () => {
    const user = await createUser({
      username: 'testuser',
      password: 'TestPass123!',
      role: 'developer'
    });
    
    expect(user.username).toBe('testuser');
    
    const auth = await authenticateUser('testuser', 'TestPass123!');
    expect(auth.success).toBe(true);
    expect(auth.user.username).toBe('testuser');
  });
});
```

### Integration Tests

Test API endpoints:

```javascript
describe('Auth API', () => {
  it('should login and return tokens', async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'adminpass'
      })
    });
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.accessToken).toBeDefined();
    expect(data.user).toBeDefined();
  });
});
```

## Troubleshooting

### Common Issues

1. **CORS errors**: Ensure cookies are sent with `credentials: 'include'`
2. **Token expired**: Check JWT_TTL settings and implement refresh logic
3. **Instance won't start**: Verify opencode binary is in PATH and ports are available
4. **Permission denied**: Check user role and permissions in users.json

### Debug Mode

Enable debug logging:

```bash
DEBUG=openchamber:multiuser npm run dev
```

### Check Instance Status

```bash
curl http://localhost:3000/api/instances \
  -H "Authorization: Bearer <token>"
```

## Migration Checklist

- [ ] Backup existing data
- [ ] Run migration script
- [ ] Save generated admin password
- [ ] Update server code with new routes
- [ ] Modify settings endpoints
- [ ] Test authentication flow
- [ ] Create additional users
- [ ] Verify instance isolation
- [ ] Update documentation

## Performance Considerations

1. **Instance Pool**: Monitor memory usage with many instances
2. **JWT Validation**: Consider caching user data
3. **File Storage**: Use SSD for better I/O performance
4. **Database**: For large deployments, consider migrating to PostgreSQL

## Next Steps

1. Implement admin UI for user management
2. Add user groups and team functionality
3. Implement resource quotas
4. Add audit logging
5. Integrate with external auth providers (LDAP, OAuth)
