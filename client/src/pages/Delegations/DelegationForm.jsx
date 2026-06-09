import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { useProjectStore } from '../../store/projectStore';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

export default function DelegationForm() {
  const user = useAuthStore((s) => s.user);
  const { projects, activeProject } = useProjectStore();
  const navigate = useNavigate();

  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({
    projectId: activeProject?.id || '',
    delegadoId: '',
    tarea: '',
    descripcion: '',
    fechaLimite: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/users')
      .then(({ data }) => {
        const list = (data.data || []).filter((u) => u.id !== user?.id);
        setUsers(list);
      })
      .catch(() => setUsers([]));
  }, [user]);

  const set = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.projectId || !form.delegadoId || !form.tarea.trim()) {
      return setError('Proyecto, usuario delegado y tarea son obligatorios');
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/delegations', form);
      navigate('/delegations');
    } catch (err) {
      setError(err.response?.data?.message || 'Error al crear la delegación');
    } finally {
      setLoading(false);
    }
  };

  const rolLabel = {
    DIRECTOR: 'Director',
    APOYO_DIRECTOR: 'Apoyo Director',
    RESIDENTE: 'Residente',
    ALMACENISTA: 'Almacenista',
    CONTABILIDAD: 'Contabilidad',
  };

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">Nueva delegación</h1>
        <p className="text-sm text-slate-500 mt-0.5">Asigna una tarea a un miembro del equipo</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
      )}

      <form onSubmit={handleSubmit}>
        <Card>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Proyecto <span className="text-red-500">*</span>
              </label>
              <select
                value={form.projectId}
                onChange={set('projectId')}
                required
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Seleccionar proyecto…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.icono || '🏗️'} {p.nombre}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Delegar a <span className="text-red-500">*</span>
              </label>
              <select
                value={form.delegadoId}
                onChange={set('delegadoId')}
                required
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Seleccionar persona…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre} — {rolLabel[u.rol] || u.rol}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Tarea <span className="text-red-500">*</span>
              </label>
              <input
                value={form.tarea}
                onChange={set('tarea')}
                required
                placeholder="Ej: Revisar cotizaciones de acero estructural"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Descripción</label>
              <textarea
                value={form.descripcion}
                onChange={set('descripcion')}
                rows={3}
                placeholder="Instrucciones o contexto adicional…"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Fecha límite</label>
              <input
                type="date"
                value={form.fechaLimite}
                onChange={set('fechaLimite')}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Preview */}
            {form.delegadoId && form.tarea && (
              <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-600">
                <strong>{user?.nombre}</strong> delega a{' '}
                <strong>{users.find((u) => u.id === form.delegadoId)?.nombre}</strong>:{' '}
                "{form.tarea}"
                {form.fechaLimite && ` · Límite: ${new Date(form.fechaLimite).toLocaleDateString('es-CO')}`}
              </div>
            )}
          </div>
        </Card>

        <div className="flex items-center gap-3 mt-5">
          <Button type="submit" loading={loading}>
            Crear delegación
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/delegations')}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
