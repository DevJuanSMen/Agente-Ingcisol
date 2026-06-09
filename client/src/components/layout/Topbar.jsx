import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useProjectStore } from '../../store/projectStore';

export default function Topbar({ onMenuClick }) {
  const user = useAuthStore((s) => s.user);
  const { activeProject } = useProjectStore();
  const navigate = useNavigate();

  const initials = user?.nombre
    ? user.nombre.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
    : '?';

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-4 sticky top-0 z-10">
      {/* Hamburger */}
      <button
        className="lg:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
        onClick={onMenuClick}
        aria-label="Abrir menú"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Proyecto activo */}
      <button
        className="flex-1 min-w-0 flex items-center gap-2 text-left hover:bg-slate-50 rounded-lg px-2 py-1 -ml-2 transition-colors"
        onClick={() => navigate('/projects')}
        title="Ir a proyectos"
      >
        {activeProject ? (
          <>
            <span className="text-base flex-shrink-0">{activeProject.icono || '🏗️'}</span>
            <div className="min-w-0">
              <span className="text-sm font-medium text-slate-700 truncate block">
                {activeProject.nombre}
              </span>
              <span className="text-xs text-slate-400 truncate block hidden sm:block">
                {activeProject.contratoNo}
              </span>
            </div>
          </>
        ) : (
          <span className="text-xs text-warning font-medium">Sin proyecto activo — click para seleccionar</span>
        )}
      </button>

      {/* Avatar */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-xs text-slate-500 hidden sm:block max-w-[120px] truncate">{user?.email}</span>
        <div
          className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-xs font-semibold cursor-default select-none"
          title={user?.nombre}
        >
          {initials}
        </div>
      </div>
    </header>
  );
}
