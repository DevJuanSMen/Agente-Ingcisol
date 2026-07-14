import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    // La empresa no ha completado la configuración inicial: llevar al wizard.
    if (
      error.response?.status === 403 &&
      error.response?.data?.code === 'SETUP_INCOMPLETE' &&
      window.location.pathname !== '/onboarding'
    ) {
      window.location.href = '/onboarding';
    }
    return Promise.reject(error);
  }
);

export default api;
