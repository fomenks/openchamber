# OpenChamber Multiuser Mode

This document describes the multiuser mode implementation for OpenChamber, enabling multiple users to share a single OpenChamber server with proper authentication, authorization, and resource isolation.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

## Overview

Multiuser mode allows OpenChamber to serve multiple users simultaneously with:

- **User Authentication**: JWT-based authentication with session management
- **Role-Based Access Control (RBAC)**: Fine-grained permission system
- **Tenant Isolation**: Per-user data storage and settings
- **Instance Pooling**: Dedicated or shared OpenCode instances per user
- **Admin Panel**: User and instance management interface

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        OpenChamber Server                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  User A     │  │  User B     │  │  User C     │         │
│  │  (admin)    │  │  (developer)│  │  (viewer)   │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│         ▼                ▼                ▼                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    Auth & RBAC Layer                  │  │
│  │  • JWT authentication  • Role-based permissions       │  │
│  └──────────────────────────────────────────────────────┘  │
│         │                │                │                 │
│         ▼                ▼                ▼                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ User Data   │  │ User Data   │  │ User Data   │         │
│  │ Tenant A    │  │ Tenant B    │  │ Tenant C    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│         │                │                │                 │
│         ▼                ▼                ▼                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ OpenCode    │  │ OpenCode    │  │ OpenCode    │         │
│  │ Instance    │  │ Instance    │  │ Instance    │         │
│  │ port: 9001  │  │ port: 9002  │  │ port: 9003  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

1. **User Management** (`lib/users/`)
   - `storage.js`: User CRUD operations and persistence
   - `auth.js`: JWT authentication and session management
   - `rbac.js`: Role-based access control

2. **Instance Pool** (`lib/opencode/pool.js`)
   - Manages per-user OpenCode instances
   - Port allocation and health monitoring
   - Automatic cleanup of inactive instances

3. **Tenant Isolation** (`lib/middleware/tenant.js`)
   - Per-user data directories
   - Path validation and security

4. **API Routes** (`routes/`)
   - `auth.js`: Authentication endpoints
   - `users.js`: User management endpoints
   - `instances.js`: Instance management endpoints

## Getting Started

### 1. Enable Multiuser Mode

Set the environment variable:

```bash
export OPENCHAMBER_MULTIUSER=true
```

Or add to `.env`:

```
OPENCHAMBER_MULTIUSER=true
```

### 2. Run Migration

If you have existing data, migrate it to multiuser format:

```bash
cd packages/web/server
node scripts/migrate-to-multiuser.js
```

Optional flags:
```bash
node scripts/migrate-to-multiuser.js \
  --admin-username=admin \
  --admin-password=SecurePass123! \
  --admin-email=admin@company.com
```

### 3. Start the Server

```bash
# Development
OPENCHAMBER_MULTIUSER=true npm run dev

# Production
OPENCHAMBER_MULTIUSER=true npm start
```

### 4. First Login

After migration, use the generated admin credentials to log in at:

```
http://localhost:3000
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENCHAMBER_MULTIUSER` | Enable multiuser mode | `false` |
| `JWT_SECRET` | Secret key for JWT tokens | Auto-generated |
| `JWT_ACCESS_TTL` | Access token lifetime (seconds) | `900` (15 min) |
| `JWT_REFRESH_TTL` | Refresh token lifetime (seconds) | `604800` (7 days) |
| `OPENCODE_PORT_RANGE_START` | Start of port range for instances | `9000` |
| `OPENCODE_PORT_RANGE_END` | End of port range for instances | `10000` |
| `OPENCHAMBER_ADMIN_USERNAME` | Initial admin username | `admin` |
| `OPENCHAMBER_ADMIN_PASSWORD` | Initial admin password | Auto-generated |

### User Roles

#### Administrator (`admin`)
- Full system access
- User management
- Global settings
- All instance management

#### Developer (`developer`)
- Create and manage own projects
- Full chat session access
- Terminal access
- Git operations
- Personal settings

#### Viewer (`viewer`)
- Read-only project access
- View chat sessions
- Cannot modify data

### Custom Roles

Admins can create custom roles with specific permissions:

```javascript
// Example: Create a "manager" role
POST /api/users/roles
{
  "name": "manager",
  "permissions": [
    "project:read", "project:write",
    "session:read", "session:write",
    "user:read"
  ],
  "description": "Can manage projects and view users"
}
```

## API Reference

### Authentication

#### POST /api/auth/login
Login with username and password.

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "yourpassword"
  }'
```

Response:
```json
{
  "success": true,
  "user": {
    "id": "user_abc123",
    "username": "admin",
    "role": "admin"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 900
}
```

#### POST /api/auth/logout
Logout and invalidate tokens.

```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer <access_token>"
```

#### POST /api/auth/refresh
Refresh access token.

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<refresh_token>"
  }'
```

### User Management (Admin Only)

#### GET /api/users
List all users.

```bash
curl http://localhost:3000/api/users \
  -H "Authorization: Bearer <access_token>"
```

#### POST /api/users
Create a new user.

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "john",
    "password": "SecurePass123!",
    "email": "john@company.com",
    "role": "developer"
  }'
```

#### PUT /api/users/:id
Update user.

```bash
curl -X PUT http://localhost:3000/api/users/user_abc123 \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "admin",
    "isActive": true
  }'
```

#### DELETE /api/users/:id
Delete user.

```bash
curl -X DELETE http://localhost:3000/api/users/user_abc123 \
  -H "Authorization: Bearer <access_token>"
```

### Instance Management

#### GET /api/instances
List instances (own instances or all with `?all=true` for admins).

```bash
curl http://localhost:3000/api/instances \
  -H "Authorization: Bearer <access_token>"
```

#### POST /api/instances
Create or ensure instance.

```bash
curl -X POST http://localhost:3000/api/instances \
  -H "Authorization: Bearer <access_token>"
```

#### POST /api/instances/:id/restart
Restart instance.

```bash
curl -X POST http://localhost:3000/api/instances/instance_xyz789/restart \
  -H "Authorization: Bearer <access_token>"
```

#### DELETE /api/instances/:id
Destroy instance.

```bash
curl -X DELETE http://localhost:3000/api/instances/instance_xyz789 \
  -H "Authorization: Bearer <access_token>"
```

## Security

### Authentication
- JWT tokens with configurable TTL
- Secure password hashing (scrypt)
- Rate limiting on login attempts
- Session tracking and invalidation

### Authorization
- Role-based access control
- Permission checking on all endpoints
- Ownership validation for resources

### Data Isolation
- Per-user data directories
- Path traversal prevention
- No cross-tenant data access

### Instance Security
- Random passwords per instance
- Localhost-only binding
- Automatic cleanup of idle instances

## Troubleshooting

### Instance Won't Start

Check logs:
```bash
# Server logs will show OpenCode output
# Look for [OpenCode:<userId>] messages
```

Common issues:
- Port conflict: Ensure port range is available
- Missing opencode binary: Verify opencode is in PATH
- Resource limits: Check maxMemoryMB setting

### Cannot Login

Check:
1. User exists and is active: `GET /api/users`
2. Password is correct (case-sensitive)
3. Not rate limited (wait 15 minutes after 5 failed attempts)
4. JWT secret is consistent across restarts

### Data Not Isolated

Verify:
1. Multiuser mode is enabled: Check `OPENCHAMBER_MULTIUSER=true`
2. Tenant middleware is loaded
3. User data directories exist: `~/.config/openchamber/multiuser/users/<userId>/`

### Migration Issues

If migration fails:
1. Check file permissions
2. Ensure legacy settings.json is valid JSON
3. Manually backup before retrying
4. Check console output for specific errors

## Migration from Single-User

To migrate existing data:

1. Stop the server
2. Run migration script
3. Note the generated admin password
4. Start with multiuser mode enabled
5. Log in and create additional users

The migration:
- Creates admin user
- Moves settings to user directory
- Copies custom themes
- Leaves original data intact (for rollback)

## Development

### Adding New Permissions

1. Add to `PERMISSIONS` in `lib/users/rbac.js`:
```javascript
export const PERMISSIONS = {
  // ... existing permissions
  NEW_FEATURE: 'feature:action'
};
```

2. Update role definitions in `lib/users/storage.js`

3. Use in routes:
```javascript
router.get('/feature', 
  requireAuth,
  requirePermission(PERMISSIONS.NEW_FEATURE),
  handler
);
```

### Testing

Run tests:
```bash
npm test -- packages/web/server/lib/users/
```

## License

Same as OpenChamber project.
