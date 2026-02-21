import React from 'react';
import { useAuthStore } from '../../stores/useAuthStore';

interface PermissionGuardProps {
  permission?: string;
  permissions?: string[];
  requireAll?: boolean;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Component that conditionally renders children based on user permissions
 * 
 * @example
 * // Single permission
 * <PermissionGuard permission="project:write">
 *   <EditButton />
 * </PermissionGuard>
 * 
 * @example
 * // Multiple permissions (any)
 * <PermissionGuard permissions={['user:read', 'user:write']}>
 *   <UserManagement />
 * </PermissionGuard>
 * 
 * @example
 * // All permissions required
 * <PermissionGuard permissions={['project:read', 'project:write']} requireAll={true}>
 *   <ProjectEditor />
 * </PermissionGuard>
 */
export const PermissionGuard: React.FC<PermissionGuardProps> = ({
  permission,
  permissions,
  requireAll = false,
  children,
  fallback = null
}) => {
  const { user, hasPermission } = useAuthStore();

  // Not authenticated
  if (!user) {
    return <>{fallback}</>;
  }

  // Admin has all permissions
  if (user.role === 'admin') {
    return <>{children}</>;
  }

  // Check single permission
  if (permission) {
    return hasPermission(permission) ? <>{children}</> : <>{fallback}</>;
  }

  // Check multiple permissions
  if (permissions && permissions.length > 0) {
    const checkFn = requireAll
      ? (perms: string[]) => perms.every(p => hasPermission(p))
      : (perms: string[]) => perms.some(p => hasPermission(p));

    return checkFn(permissions) ? <>{children}</> : <>{fallback}</>;
  }

  // No permission specified, render children
  return <>{children}</>;
};

interface RoleGuardProps {
  role: string;
  roles?: string[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Component that conditionally renders children based on user role
 * 
 * @example
 * // Single role
 * <RoleGuard role="admin">
 *   <AdminPanel />
 * </RoleGuard>
 * 
 * @example
 * // Multiple roles (any)
 * <RoleGuard roles={['admin', 'developer']}>
 *   <ProjectEditor />
 * </RoleGuard>
 */
export const RoleGuard: React.FC<RoleGuardProps> = ({
  role,
  roles,
  children,
  fallback = null
}) => {
  const { user, hasRole } = useAuthStore();

  // Not authenticated
  if (!user) {
    return <>{fallback}</>;
  }

  // Check single role
  if (role) {
    return hasRole(role) ? <>{children}</> : <>{fallback}</>;
  }

  // Check multiple roles
  if (roles && roles.length > 0) {
    return roles.some(r => hasRole(r)) ? <>{children}</> : <>{fallback}</>;
  }

  return <>{fallback}</>;
};

interface AuthGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  requireAuth?: boolean;
}

/**
 * Component that conditionally renders children based on authentication status
 * 
 * @example
 * // Require authentication
 * <AuthGuard requireAuth={true}>
 *   <ProtectedContent />
 * </AuthGuard>
 * 
 * @example
 * // Show for guests only
 * <AuthGuard requireAuth={false}>
 *   <LoginPrompt />
 * </AuthGuard>
 */
export const AuthGuard: React.FC<AuthGuardProps> = ({
  children,
  fallback = null,
  requireAuth = true
}) => {
  const { isAuthenticated } = useAuthStore();

  if (requireAuth) {
    return isAuthenticated ? <>{children}</> : <>{fallback}</>;
  } else {
    return !isAuthenticated ? <>{children}</> : <>{fallback}</>;
  }
};

export default {
  PermissionGuard,
  RoleGuard,
  AuthGuard
};
