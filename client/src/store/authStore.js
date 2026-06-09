import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../api/client';

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      login: async (email, password) => {
        const { data } = await api.post('/auth/login', { email, password });
        set({
          token: data.data.token,
          user: data.data.user,
          isAuthenticated: true,
        });
        return data.data.user;
      },

      logout: () => {
        set({ user: null, token: null, isAuthenticated: false });
      },

      setUser: (user) => set({ user }),

      refreshUser: async () => {
        try {
          const { data } = await api.get('/auth/me');
          set({ user: data.data });
        } catch {
          get().logout();
        }
      },
    }),
    {
      name: 'procura-auth',
      partialize: (state) => ({ token: state.token, user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
