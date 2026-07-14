import { useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';

// Pantalla para usuarios NO-director de una empresa que aún no completa la
// configuración inicial: no pueden hacer nada hasta que el director termine.
// Se refresca solo cada 30s: cuando el director finaliza, el guard los deja pasar.
export default function PendingSetup() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const refreshUser = useAuthStore((s) => s.refreshUser);

  useEffect(() => {
    const t = setInterval(() => refreshUser(), 30000);
    return () => clearInterval(t);
  }, [refreshUser]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-5">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center space-y-4">
        <div className="text-5xl">🛠️</div>
        <h1 className="text-lg font-bold text-slate-800">Tu empresa aún se está configurando</h1>
        <p className="text-sm text-slate-500">
          Hola {user?.nombre?.split(' ')[0] || ''} 👋. El director de{' '}
          <b>{user?.company?.razonSocial || 'tu empresa'}</b> debe completar la configuración inicial
          (perfil, equipo, proyecto, presupuesto y proveedores) antes de que puedas entrar.
        </p>
        <p className="text-xs text-slate-400">
          Esta pantalla se actualiza sola. En cuanto la configuración esté lista, entrarás automáticamente.
        </p>
        <button
          onClick={logout}
          className="text-xs text-slate-400 hover:text-red-500 transition-colors"
        >
          Cerrar sesión →
        </button>
      </div>
    </div>
  );
}
