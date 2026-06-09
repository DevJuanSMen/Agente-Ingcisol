import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';
import { useProjectStore } from '../../store/projectStore';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const ICONOS = ['🏗️', '🏫', '🛣️', '🏭', '🏢', '🏠', '🌉', '🏥', '⚡', '💧', '🌿', '🔧'];
const COLORES = [
  '#1B6FF5', '#F5A623', '#22D685', '#A78BFA', '#14B8A6',
  '#F97316', '#EF4444', '#06B6D4', '#8B5CF6', '#10B981',
];

const ESTADOS = [
  { value: 'PLANIFICADO', label: 'Planificado' },
  { value: 'EN_EJECUCION', label: 'En ejecución' },
  { value: 'FINALIZADO', label: 'Finalizado' },
  { value: 'SUSPENDIDO', label: 'Suspendido' },
];

const EMPTY = {
  nombre: '', contratoNo: '', entidad: '', descripcion: '',
  valor: '', inicio: '', fin: '', icono: '🏗️', color: '#1B6FF5', estado: 'PLANIFICADO',
};

export default function ProjectForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { loadProjects } = useProjectStore();
  const isEdit = Boolean(id);

  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEdit);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/projects/${id}`)
      .then(({ data }) => {
        const p = data.data;
        setForm({
          nombre: p.nombre || '',
          contratoNo: p.contratoNo || '',
          entidad: p.entidad || '',
          descripcion: p.descripcion || '',
          valor: p.valor || '',
          inicio: p.inicio ? p.inicio.split('T')[0] : '',
          fin: p.fin ? p.fin.split('T')[0] : '',
          icono: p.icono || '🏗️',
          color: p.color || '#1B6FF5',
          estado: p.estado || 'PLANIFICADO',
        });
      })
      .catch(() => setError('Error al cargar el proyecto'))
      .finally(() => setFetching(false));
  }, [id, isEdit]);

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim() || !form.contratoNo.trim()) {
      return setError('El nombre y número de contrato son obligatorios');
    }
    setLoading(true);
    setError('');
    try {
      if (isEdit) {
        await api.put(`/projects/${id}`, form);
      } else {
        await api.post('/projects', form);
      }
      await loadProjects();
      navigate('/projects');
    } catch (err) {
      setError(err.response?.data?.message || 'Error al guardar');
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">
          {isEdit ? 'Editar proyecto' : 'Nuevo proyecto'}
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {isEdit ? 'Modifica la configuración del proyecto' : 'Configura un nuevo proyecto de construcción'}
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Icono y color */}
        <Card title="Identidad visual">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Ícono</label>
              <div className="flex flex-wrap gap-2">
                {ICONOS.map((ic) => (
                  <button
                    key={ic}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, icono: ic }))}
                    className={`w-10 h-10 text-xl rounded-lg border-2 transition-colors ${
                      form.icono === ic ? 'border-primary bg-primary/10' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Color de acento</label>
              <div className="flex flex-wrap gap-2">
                {COLORES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, color: c }))}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      form.color === c ? 'border-slate-800 scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            {/* Preview */}
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
              <span className="text-2xl">{form.icono}</span>
              <div
                className="w-1 h-10 rounded-full"
                style={{ backgroundColor: form.color }}
              />
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {form.nombre || 'Nombre del proyecto'}
                </p>
                <p className="text-xs text-slate-400">{form.contratoNo || 'Nº Contrato'}</p>
              </div>
            </div>
          </div>
        </Card>

        {/* Datos básicos */}
        <Card title="Información general">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Nombre del proyecto <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.nombre}
                  onChange={set('nombre')}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Ej: IE Liceo Valledupar – Infraestructura"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Número de contrato <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.contratoNo}
                  onChange={set('contratoNo')}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="CONT-2026-EDU-001"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Estado</label>
                <select
                  value={form.estado}
                  onChange={set('estado')}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {ESTADOS.map((e) => (
                    <option key={e.value} value={e.value}>{e.label}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Entidad contratante</label>
                <input
                  value={form.entidad}
                  onChange={set('entidad')}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Secretaría de Educación / INVIAS / Privado"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Descripción</label>
                <textarea
                  value={form.descripcion}
                  onChange={set('descripcion')}
                  rows={2}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  placeholder="Descripción breve del alcance del proyecto"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Datos financieros y temporales */}
        <Card title="Finanzas y cronograma">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-3">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Valor del contrato (COP)</label>
              <input
                type="number"
                value={form.valor}
                onChange={set('valor')}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="999805402"
                min={0}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Fecha inicio</label>
              <input
                type="date"
                value={form.inicio}
                onChange={set('inicio')}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Fecha fin</label>
              <input
                type="date"
                value={form.fin}
                onChange={set('fin')}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </Card>

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" loading={loading}>
            {isEdit ? 'Guardar cambios' : 'Crear proyecto'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/projects')}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
