import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../api/client';

export const useProjectStore = create(
  persist(
    (set, get) => ({
      activeProject: null,
      projects: [],
      loading: false,

      loadProjects: async () => {
        set({ loading: true });
        try {
          const { data } = await api.get('/projects');
          const list = data.data || [];
          set({ projects: list });
          const current = get().activeProject;
          if (current) {
            const updated = list.find((p) => p.id === current.id);
            // Si el proyecto activo persistido no está en la lista del usuario actual
            // (p.ej. quedó en caché de otra sesión), reconciliar con el activo en BD.
            set({ activeProject: updated || list.find((p) => p.activo) || null });
          } else {
            const active = list.find((p) => p.activo);
            if (active) set({ activeProject: active });
          }
        } finally {
          set({ loading: false });
        }
      },

      setActiveProject: async (project) => {
        try {
          await api.put(`/projects/${project.id}/activate`);
          // Recargar lista con estados actualizados
          const { data } = await api.get('/projects');
          const list = data.data || [];
          const updated = list.find((p) => p.id === project.id);
          set({ projects: list, activeProject: updated || project });
        } catch (err) {
          throw err;
        }
      },

      refreshActive: async () => {
        const current = get().activeProject;
        if (!current) return;
        try {
          const { data } = await api.get(`/projects/${current.id}`);
          set({ activeProject: data.data });
        } catch {
          // silencioso
        }
      },

      clearProject: () => set({ activeProject: null }),

      // Limpia todo el estado de proyecto (al cerrar/iniciar sesión) para que
      // no "parpadee" el proyecto de una sesión anterior desde la caché.
      reset: () => set({ activeProject: null, projects: [], loading: false }),
    }),
    {
      name: 'procura-project',
      partialize: (state) => ({ activeProject: state.activeProject }),
    }
  )
);
