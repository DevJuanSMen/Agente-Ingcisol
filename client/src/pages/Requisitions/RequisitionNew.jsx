import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const emptyItem = () => ({ descripcion: '', cantidad: 1, unidad: 'UND', codigo: '' });

export default function RequisitionNew() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [prioridad, setPrioridad] = useState('MEDIA');
  const [fechaLimite, setFechaLimite] = useState('');
  const [items, setItems] = useState([emptyItem()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/projects').then((r) => {
      const list = r.data.data || [];
      setProjects(list);
      const active = list.find((p) => p.activo);
      if (active) setProjectId(active.id);
    });
  }, []);

  const addItem = () => setItems([...items, emptyItem()]);
  const removeItem = (i) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i, field, value) => {
    const next = [...items];
    next[i] = { ...next[i], [field]: value };
    setItems(next);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!projectId) return setError('Selecciona un proyecto');
    if (items.every((it) => !it.descripcion.trim())) return setError('Agrega al menos un ítem');

    setError('');
    setLoading(true);
    try {
      const validItems = items.filter((it) => it.descripcion.trim());
      await api.post('/requisitions', {
        projectId,
        prioridad,
        fechaLimite: fechaLimite || null,
        canal: 'APP',
        items: validItems,
      });
      navigate('/requisitions');
    } catch (err) {
      setError(err.response?.data?.message || 'Error al crear la requisición');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Nueva Requisición</h1>
        <p className="text-sm text-slate-500 mt-0.5">Completa los datos del pedido de materiales</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
        )}

        <Card title="Datos generales">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Proyecto</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Seleccionar…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Prioridad</label>
              <select
                value={prioridad}
                onChange={(e) => setPrioridad(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="ALTA">Alta</option>
                <option value="MEDIA">Media</option>
                <option value="BAJA">Baja</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Fecha límite</label>
              <input
                type="date"
                value={fechaLimite}
                onChange={(e) => setFechaLimite(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </Card>

        <Card
          title="Ítems solicitados"
          action={
            <Button type="button" variant="secondary" size="sm" onClick={addItem}>
              + Agregar ítem
            </Button>
          }
        >
          <div className="space-y-3">
            <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-slate-500 uppercase px-1">
              <div className="col-span-5">Descripción</div>
              <div className="col-span-2">Cantidad</div>
              <div className="col-span-2">Unidad</div>
              <div className="col-span-2">Cód. APU</div>
              <div className="col-span-1"></div>
            </div>

            {items.map((item, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input
                  className="col-span-5 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Descripción del material"
                  value={item.descripcion}
                  onChange={(e) => updateItem(i, 'descripcion', e.target.value)}
                />
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  value={item.cantidad}
                  onChange={(e) => updateItem(i, 'cantidad', e.target.value)}
                />
                <input
                  className="col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="UND"
                  value={item.unidad}
                  onChange={(e) => updateItem(i, 'unidad', e.target.value)}
                />
                <input
                  className="col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="01.01"
                  value={item.codigo}
                  onChange={(e) => updateItem(i, 'codigo', e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  disabled={items.length === 1}
                  className="col-span-1 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-30 text-center"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => navigate('/requisitions')}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            Enviar requisición
          </Button>
        </div>
      </form>
    </div>
  );
}
