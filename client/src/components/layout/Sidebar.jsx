import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useProjectStore } from '../../store/projectStore';

const ALL_ROUTES = [
  { path: '/', label: 'Dashboard', icon: '📊', roles: ['DIRECTOR', 'APOYO_DIRECTOR', 'RESIDENTE', 'ALMACENISTA', 'CONTABILIDAD'] },
  { path: '/projects', label: 'Proyectos', icon: '🏗️', roles: ['DIRECTOR', 'APOYO_DIRECTOR', 'RESIDENTE', 'ALMACENISTA', 'CONTABILIDAD'] },
  { path: '/delegations', label: 'Delegaciones', icon: '🤝', roles: ['DIRECTOR', 'APOYO_DIRECTOR', 'RESIDENTE', 'ALMACENISTA'] },
  { divider: true, label: 'Operaciones', roles: ['DIRECTOR', 'APOYO_DIRECTOR', 'RESIDENTE', 'ALMACENISTA', 'CONTABILIDAD'] },
  { path: '/requisitions', label: 'Requisiciones', icon: '📋', roles: ['DIRECTOR', 'APOYO_DIRECTOR', 'RESIDENTE', 'ALMACENISTA'] },
  { path: '/quotations', label: 'Cotizaciones', icon: '💬', roles: ['DIRECTOR', 'APOYO_DIRECTOR'] },
  { path: '/orders', label: 'Órdenes de Compra', icon: '📦', roles: ['DIRECTOR', 'APOYO_DIRECTOR', 'CONTABILIDAD'] },
  { path: '/tracking', label: 'Seguimiento', icon: '🚦', roles: ['DIRECTOR', 'APOYO_DIRECTOR', 'RESIDENTE', 'ALMACENISTA', 'CONTABILIDAD'] },
  { divider: true, label: 'Configuración', roles: ['DIRECTOR', 'APOYO_DIRECTOR'] },
  { path: '/import', label: 'Importar Presupuesto', icon: '📂', roles: ['DIRECTOR', 'APOYO_DIRECTOR'] },
  { path: '/apu', label: 'APU', icon: '📐', roles: ['DIRECTOR', 'APOYO_DIRECTOR'] },
  { path: '/basic-prices', label: 'Básicos e Insumos', icon: '🧱', roles: ['DIRECTOR', 'APOYO_DIRECTOR'] },
  { path: '/suppliers', label: 'Proveedores', icon: '🏭', roles: ['DIRECTOR', 'APOYO_DIRECTOR'] },
  { path: '/company', label: 'Empresa', icon: '🏢', roles: ['DIRECTOR', 'APOYO_DIRECTOR'] },
  { path: '/settings/users', label: 'Usuarios', icon: '👥', roles: ['DIRECTOR'] },
  { path: '/settings/whatsapp', label: 'Bot WhatsApp', icon: '💬', roles: ['DIRECTOR', 'APOYO_DIRECTOR'] },
];

const ESTADO_COLOR = {
  PLANIFICADO: '#94a3b8',
  EN_EJECUCION: '#22D685',
  FINALIZADO: '#1B6FF5',
  SUSPENDIDO: '#EF4444',
};

function ProjectSelector() {
  const { projects, activeProject, setActiveProject } = useProjectStore();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(null);

  const handleSelect = async (project) => {
    if (project.id === activeProject?.id) { setOpen(false); return; }
    setSwitching(project.id);
    try {
      await setActiveProject(project);
    } catch {
      // silencioso
    } finally {
      setSwitching(null);
      setOpen(false);
    }
  };

  return (
    <div className="px-3 py-2 border-b border-slate-700">
      <p className="text-xs text-slate-500 mb-1.5 font-medium uppercase tracking-wide">Proyecto activo</p>
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-2 bg-slate-800 hover:bg-slate-700 rounded-lg px-2.5 py-2 transition-colors text-left"
      >
        <span className="text-base flex-shrink-0">
          {activeProject?.icono || '🏗️'}
        </span>
        <span className="text-xs font-medium text-white truncate flex-1">
          {activeProject?.nombre || 'Sin proyecto activo'}
        </span>
        <span className="text-slate-400 text-xs flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-1 bg-slate-800 rounded-lg overflow-hidden border border-slate-700">
          {projects.length === 0 ? (
            <p className="text-xs text-slate-500 p-3">Sin proyectos</p>
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelect(p)}
                disabled={switching !== null}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-700 transition-colors ${
                  activeProject?.id === p.id ? 'bg-slate-700' : ''
                }`}
              >
                {switching === p.id ? (
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                ) : (
                  <span className="text-sm flex-shrink-0">{p.icono || '🏗️'}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-white truncate">{p.nombre}</p>
                  <p className="text-xs text-slate-400 truncate">{p.contratoNo}</p>
                </div>
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: ESTADO_COLOR[p.estado] || '#94a3b8' }}
                />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ open, onClose }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const visibleRoutes = ALL_ROUTES.filter((r) => r.roles?.includes(user?.rol));

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 left-0 h-full w-60 bg-slate-900 text-white z-30 flex flex-col
          transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
      >
        {/* Logo */}
        <div className="h-14 flex flex-col justify-center px-5 border-b border-slate-700 flex-shrink-0">
          <span className="text-base font-bold text-white tracking-tight leading-tight">
            PROCURA <span className="text-primary">AI</span>
          </span>
          <span className="text-[10px] text-slate-400 leading-tight">
            Tu agente de compras 24/7
          </span>
        </div>

        {/* Selector de proyecto */}
        <ProjectSelector />

        {/* Navegación */}
        <nav className="flex-1 overflow-y-auto py-3 px-3">
          {visibleRoutes.map((route, idx) => {
            if (route.divider) {
              return (
                <p key={idx} className="text-xs text-slate-500 font-medium uppercase tracking-wide px-3 pt-4 pb-1.5">
                  {route.label}
                </p>
              );
            }
            return (
              <NavLink
                key={route.path}
                to={route.path}
                end={route.path === '/'}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg mb-0.5 text-sm transition-colors
                  ${isActive
                    ? 'bg-primary text-white font-medium'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`
                }
              >
                <span>{route.icon}</span>
                <span>{route.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Usuario y logout */}
        <div className="p-4 border-t border-slate-700 flex-shrink-0">
          <div className="text-xs text-slate-400 mb-0.5 truncate">{user?.nombre}</div>
          <div className="text-xs text-slate-500 mb-3">{user?.rol?.replace(/_/g, ' ')}</div>
          <button
            onClick={logout}
            className="w-full text-left text-xs text-slate-400 hover:text-red-400 transition-colors"
          >
            Cerrar sesión →
          </button>
        </div>
      </aside>
    </>
  );
}
