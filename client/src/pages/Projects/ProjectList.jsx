import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { useProjectStore } from '../../store/projectStore';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const ESTADO_LABEL = {
  PLANIFICADO: { label: 'Planificado', cls: 'bg-slate-100 text-slate-600' },
  EN_EJECUCION: { label: 'En ejecución', cls: 'bg-green-100 text-green-700' },
  FINALIZADO: { label: 'Finalizado', cls: 'bg-blue-100 text-blue-700' },
  SUSPENDIDO: { label: 'Suspendido', cls: 'bg-red-100 text-red-600' },
};

const fmtCOP = (v) => v ? `$${Number(v).toLocaleString('es-CO')} COP` : '—';
const fmtD = (d) => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function ProjectList() {
  const user = useAuthStore((s) => s.user);
  const { projects, activeProject, loadProjects, setActiveProject } = useProjectStore();
  const [activating, setActivating] = useState(null);
  const navigate = useNavigate();
  const canEdit = ['DIRECTOR', 'APOYO_DIRECTOR'].includes(user?.rol);

  useEffect(() => { loadProjects(); }, []);

  const handleActivate = async (project) => {
    if (activating) return;
    setActivating(project.id);
    try {
      await setActiveProject(project);
    } catch {
      alert('Error al activar el proyecto');
    } finally {
      setActivating(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Proyectos</h1>
          <p className="text-sm text-slate-500 mt-0.5">{projects.length} proyecto{projects.length !== 1 ? 's' : ''} registrados</p>
        </div>
        {canEdit && (
          <Link to="/projects/new">
            <Button>+ Nuevo proyecto</Button>
          </Link>
        )}
      </div>

      {projects.length === 0 ? (
        <Card>
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🏗️</div>
            <p className="text-sm font-medium text-slate-600 mb-2">Sin proyectos registrados</p>
            {canEdit && (
              <Link to="/projects/new">
                <Button className="mt-2">Crear primer proyecto</Button>
              </Link>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((project) => {
            const isActive = activeProject?.id === project.id;
            const estadoInfo = ESTADO_LABEL[project.estado] || ESTADO_LABEL.PLANIFICADO;
            return (
              <div
                key={project.id}
                className={`bg-white rounded-xl border-2 shadow-sm transition-all ${
                  isActive ? 'border-primary shadow-primary/10' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Header */}
                <div
                  className="h-2 rounded-t-xl"
                  style={{ backgroundColor: project.color || '#E85D04' }}
                />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-2xl">{project.icono || '🏗️'}</span>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-slate-800 truncate text-sm leading-tight">{project.nombre}</h3>
                        <p className="text-xs text-slate-400 mt-0.5 truncate">{project.contratoNo}</p>
                      </div>
                    </div>
                    {isActive && (
                      <span className="flex-shrink-0 text-xs bg-primary/10 text-primary font-medium px-2 py-0.5 rounded-full">
                        Activo
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 mb-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Estado</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${estadoInfo.cls}`}>
                        {estadoInfo.label}
                      </span>
                    </div>
                    {project.entidad && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Entidad</span>
                        <span className="text-xs text-slate-700 truncate ml-4 text-right">{project.entidad}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Valor contrato</span>
                      <span className="text-xs font-medium text-slate-700">{fmtCOP(project.valor)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Periodo</span>
                      <span className="text-xs text-slate-600">{fmtD(project.inicio)} – {fmtD(project.fin)}</span>
                    </div>
                    <div className="flex items-center gap-3 pt-1">
                      <span className="text-xs text-slate-400">
                        📋 {project._count?.requisitions ?? 0} req.
                      </span>
                      <span className="text-xs text-slate-400">
                        📐 {project._count?.itemsAPU ?? 0} APU
                      </span>
                      <span className="text-xs text-slate-400">
                        📊 {project._count?.budgetSheets ?? 0} hojas
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {!isActive && canEdit && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={activating === project.id}
                        onClick={() => handleActivate(project)}
                      >
                        Activar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate(`/projects/${project.id}/dashboard`)}
                    >
                      Dashboard
                    </Button>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(`/projects/${project.id}/edit`)}
                      >
                        ✏️
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
