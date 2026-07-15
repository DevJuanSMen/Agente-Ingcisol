import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  // Sin timeout, una petición que agarra al servidor en pleno redeploy se cuelga
  // para siempre y deja la UI "cargando" eterna. 60s cubre los análisis con IA
  // (Excel) que son las llamadas más lentas legítimas.
  timeout: 60_000,
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
