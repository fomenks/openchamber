/**
 * Authentication Components
 * 
 * This module exports all authentication-related components and utilities
 * for the OpenChamber multiuser mode.
 */

export { LoginForm } from './LoginForm';
export { UserMenu } from './UserMenu';
export { PermissionGuard, RoleGuard, AuthGuard } from './PermissionGuard';
export { ProtectedRoute, PermissionRoute, AdminRoute } from './ProtectedRoute';

// Re-export store
export { useAuthStore } from '../../stores/useAuthStore';

// Re-export API
export * as authApi from '../../lib/authApi';
