import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../api/client';

// Carga los permisos del rol actual (matriz configurada por el director)
const fetchPermissions = async (set) => {
  try {
    const { data } = await api.get('/permissions/me');
    set({ permissions: data.data.permisos || {} });
  } catch {
    set({ permissions: {} });
  }
};

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      permissions: {},

      login: async (email, password) => {
        const { data } = await api.post('/auth/login', { email, password });
        set({
          token: data.data.token,
          user: data.data.user,
          isAuthenticated: true,
        });
        await fetchPermissions(set);
        return data.data.user;
      },

      register: async (payload) => {
        const { data } = await api.post('/auth/register', payload);
        set({
          token: data.data.token,
          user: data.data.user,
          isAuthenticated: true,
        });
        await fetchPermissions(set);
        return data.data.user;
      },

      logout: () => {
        set({ user: null, token: null, isAuthenticated: false, permissions: {} });
      },

      setUser: (user) => set({ user }),

      refreshUser: async () => {
        try {
          const { data } = await api.get('/auth/me');
          set({ user: data.data });
          await fetchPermissions(set);
        } catch {
          get().logout();
        }
      },

      loadPermissions: () => fetchPermissions(set),

      // ¿El usuario puede `accion` (ver|crear|editar|eliminar) en `modulo`?
      can: (modulo, accion = 'ver') => {
        const { user, permissions } = get();
        if (user?.rol === 'DIRECTOR') return true;
        return !!permissions?.[modulo]?.[accion];
      },
    }),
    {
      name: 'procura-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        permissions: state.permissions,
      }),
    }
  )
);

// Hook de conveniencia para gating en componentes
export const useCan = (modulo, accion = 'ver') =>
  useAuthStore((s) => {
    if (s.user?.rol === 'DIRECTOR') return true;
    return !!s.permissions?.[modulo]?.[accion];
  });
