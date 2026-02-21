import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/useAuthStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAuth?: boolean;
  permission?: string;
  permissions?: string[];
  role?: string;
  roles?: string[];
  redirectTo?: string;
  fallback?: React.ReactNode;
}

/**
 * ProtectedRoute component for guarding routes based on authentication and permissions
 * 
 * @example
 * // Basic auth protection
 * <Route path="/dashboard" element={
 *   <ProtectedRoute>
 *     <Dashboard />
 *   </ProtectedRoute>
 * } />
 * 
 * @example
 * // Require specific role
 * <Route path="/admin" element={
 *   <ProtectedRoute role="admin" redirectTo="/unauthorized">
 *     <AdminPanel />
 *   </ProtectedRoute>
 * } />
 * 
 * @example
 * // Require specific permission
 * <Route path="/projects/:id/edit" element={
 *   <ProtectedRoute permission="project:write">
 *     <ProjectEditor />
 *   </ProtectedRoute>
 * } />
 * 
 * @example
 * // Guest only (not authenticated)
 * <Route path="/login" element={
 *   <ProtectedRoute requireAuth={false} redirectTo="/dashboard">
 *     <LoginPage />
 *   </ProtectedRoute>
 * } />
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requireAuth = true,
  permission,
  permissions,
  role,
  roles,
  redirectTo = '/login',
  fallback
}) => {
  const location = useLocation();
  const { isAuthenticated, user, hasPermission, hasRole, isLoading } = useAuthStore();

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Check authentication
  if (requireAuth && !isAuthenticated) {
    // Redirect to login, save intended destination
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  // For guest-only routes
  if (!requireAuth && isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  // If not authenticated at this point, render children (for guest routes)
  if (!isAuthenticated) {
    return <>{children}</>;
  }

  // Check role
  if (role && !hasRole(role)) {
    return fallback ? <>{fallback}</> : <Navigate to="/unauthorized" replace />;
  }

  // Check multiple roles
  if (roles && roles.length > 0 && !roles.some(r => hasRole(r))) {
    return fallback ? <>{fallback}</> : <Navigate to="/unauthorized" replace />;
  }

  // Check single permission
  if (permission && !hasPermission(permission)) {
    return fallback ? <>{fallback}</> : <Navigate to="/unauthorized" replace />;
  }

  // Check multiple permissions
  if (permissions && permissions.length > 0) {
    const hasAllPermissions = permissions.every(p => hasPermission(p));
    if (!hasAllPermissions) {
      return fallback ? <>{fallback}</> : <Navigate to="/unauthorized" replace />;
    }
  }

  // All checks passed, render children
  return <>{children}</>;
};

interface PermissionRouteProps {
  children: React.ReactNode;
  permission: string;
  fallback?: React.ReactNode;
}

/**
 * Simplified route guard for single permission
 */
export const PermissionRoute: React.FC<PermissionRouteProps> = ({
  children,
  permission,
  fallback
}) => (
  <ProtectedRoute permission={permission} fallback={fallback}>
    {children}
  </ProtectedRoute>
);

interface AdminRouteProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Route guard for admin-only routes
 */
export const AdminRoute: React.FC<AdminRouteProps> = ({ children, fallback }) => (
  <ProtectedRoute role="admin" fallback={fallback}>
    {children}
  </ProtectedRoute>
);

export default ProtectedRoute;
