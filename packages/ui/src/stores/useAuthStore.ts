import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as authApi from '../lib/authApi';

interface User {
  id: string;
  username: string;
  email?: string;
  role: string;
  preferences?: {
    theme?: string;
    language?: string;
  };
  metadata?: {
    displayName?: string;
    avatar?: string;
  };
}

interface AuthState {
  // State
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshSession: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
  clearError: () => void;
  
  // Getters
  hasRole: (role: string) => boolean;
  hasPermission: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      isAuthenticated: false,
      user: null,
      isLoading: false,
      error: null,

      // Login action
      login: async (username: string, password: string) => {
        set({ isLoading: true, error: null });
        
        try {
          const response = await authApi.login(username, password);
          
          // Store tokens if provided
          if (response.accessToken) {
            authApi.storeTokens(response.accessToken, response.refreshToken);
          }
          
          set({
            isAuthenticated: true,
            user: response.user,
            isLoading: false,
            error: null
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Login failed';
          set({
            isAuthenticated: false,
            user: null,
            isLoading: false,
            error: errorMessage
          });
          throw err;
        }
      },

      // Logout action
      logout: async () => {
        set({ isLoading: true });
        
        try {
          await authApi.logout();
        } catch (err) {
          console.error('Logout error:', err);
        } finally {
          authApi.clearTokens();
          set({
            isAuthenticated: false,
            user: null,
            isLoading: false,
            error: null
          });
        }
      },

      // Logout from all sessions
      logoutAll: async () => {
        set({ isLoading: true });
        
        try {
          await authApi.logoutAllSessions();
        } catch (err) {
          console.error('Logout all error:', err);
        } finally {
          authApi.clearTokens();
          set({
            isAuthenticated: false,
            user: null,
            isLoading: false,
            error: null
          });
        }
      },

      // Refresh session
      refreshSession: async () => {
        try {
          await authApi.refreshToken();
          const userData = await authApi.getCurrentUser();
          
          if (userData) {
            set({
              isAuthenticated: true,
              user: userData.user,
              error: null
            });
          }
        } catch (err) {
          console.error('Session refresh error:', err);
          authApi.clearTokens();
          set({
            isAuthenticated: false,
            user: null
          });
        }
      },

      // Check authentication status
      checkAuth: async () => {
        try {
          const session = await authApi.checkSession();
          
          if (session.authenticated) {
            const userData = await authApi.getCurrentUser();
            if (userData) {
              set({
                isAuthenticated: true,
                user: userData.user,
                error: null
              });
              return true;
            }
          }
          
          set({
            isAuthenticated: false,
            user: null
          });
          return false;
        } catch (err) {
          console.error('Auth check error:', err);
          set({
            isAuthenticated: false,
            user: null
          });
          return false;
        }
      },

      // Clear error
      clearError: () => set({ error: null }),

      // Check if user has specific role
      hasRole: (role: string) => {
        const user = get().user;
        return user?.role === role;
      },

      // Check if user has specific permission
      hasPermission: (permission: string) => {
        const user = get().user;
        if (!user) return false;
        
        // Admin has all permissions
        if (user.role === 'admin') return true;
        
        // TODO: Implement permission checking based on role permissions
        // For now, just check basic role-based access
        const rolePermissions: Record<string, string[]> = {
          developer: [
            'project:read', 'project:write',
            'session:read', 'session:write',
            'settings:read', 'settings:write:self'
          ],
          viewer: ['project:read', 'session:read', 'settings:read']
        };
        
        const permissions = rolePermissions[user.role] || [];
        return permissions.includes(permission) || permissions.includes('*');
      }
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        user: state.user
      })
    }
  )
);

export default useAuthStore;
