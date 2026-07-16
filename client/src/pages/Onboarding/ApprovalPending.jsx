import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

// Pantalla que ve TODO el equipo (director incluido) mientras la empresa ya
// terminó el onboarding pero el superadmin aún no la aprueba, o la rechazó.
// Se refresca sola: en cuanto el superadmin aprueba, el guard los deja pasar.
export default function ApprovalPending() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const navigate = useNavigate();

  useEffect(() => {
    const t = setInterval(() => refreshUser(), 30000);
    return () => clearInterval(t);
  }, [refreshUser]);

  const company = user?.company || {};
  const isDirector = user?.rol === 'DIRECTOR';
  const rejected = company.approvalStatus === 'REJECTED';

  if (rejected) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-5">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center space-y-4">
          <div className="text-5xl">⚠️</div>
          <h1 className="text-lg font-bold text-slate-800">Configuración rechazada</h1>
          <p className="text-sm text-slate-500">
            {company.rejectionReason || 'El equipo de PROCURA AI encontró un problema con la configuración inicial.'}
          </p>
          {isDirector ? (
            <button
              onClick={() => navigate('/onboarding')}
              className="text-sm font-medium text-primary hover:underline"
            >
              Ir a corregir la configuración →
            </button>
          ) : (
            <p className="text-xs text-slate-400">
              Contacta al director de <b>{company.razonSocial || 'tu empresa'}</b> para que la corrija.
            </p>
          )}
          <button onClick={logout} className="block mx-auto text-xs text-slate-400 hover:text-red-500 transition-colors">
            Cerrar sesión →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-5">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center space-y-4">
        <div className="text-5xl">⏳</div>
        <h1 className="text-lg font-bold text-slate-800">Tu cuenta está en revisión</h1>
        <p className="text-sm text-slate-500">
          Hola {user?.nombre?.split(' ')[0] || ''} 👋. El equipo de PROCURA AI está revisando la configuración de{' '}
          <b>{company.razonSocial || 'tu empresa'}</b>. Te avisaremos por WhatsApp en cuanto quede aprobada.
        </p>
        <p className="text-xs text-slate-400">Esta pantalla se actualiza sola.</p>
        <button onClick={logout} className="text-xs text-slate-400 hover:text-red-500 transition-colors">
          Cerrar sesión →
        </button>
      </div>
    </div>
  );
}
