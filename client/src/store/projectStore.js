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
          // Si no hay proyecto activo en store, usar el marcado como activo en BD
          if (!get().activeProject) {
            const active = list.find((p) => p.activo);
            if (active) set({ activeProject: active });
          } else {
            // Actualizar datos del proyecto activo con los más recientes
            const updated = list.find((p) => p.id === get().activeProject?.id);
            if (updated) set({ activeProject: updated });
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
    }),
    {
      name: 'procura-project',
      partialize: (state) => ({ activeProject: state.activeProject }),
    }
  )
);
