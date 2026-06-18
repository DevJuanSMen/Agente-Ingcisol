import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';

const fmtCOP = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;

export default function BasicPriceList() {
  const user = useAuthStore((s) => s.user);
  const canEdit = ['DIRECTOR', 'APOYO_DIRECTOR'].includes(user?.rol);
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState('TODOS'); // TODOS | BASICO | INSUMO
  const [deleteId, setDeleteId] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/basic-prices')
      .then((r) => setData(r.data.data || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    try {
      await api.delete(`/basic-prices/${id}`);
      setDeleteId(null);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al eliminar');
    }
  };

  const filtered = data.filter((b) => {
    if (filter === 'BASICO' && !b.codigo.toUpperCase().startsWith('BASICO')) return false;
    if (filter === 'INSUMO' && !b.codigo.toUpperCase().startsWith('INS')) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!b.descripcion.toLowerCase().includes(q) && !b.codigo.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const nBasicos = data.filter((b) => b.codigo.toUpperCase().startsWith('BASICO')).length;
  const nInsumos = data.filter((b) => b.codigo.toUpperCase().startsWith('INS')).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Precios Básicos e Insumos</h1>
          <p className="text-sm text-slate-500 mt-0.5">{nBasicos} básicos compuestos · {nInsumos} insumos · {data.length} total</p>
        </div>
      </div>

      <Card>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar código o descripción…"
            className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="flex gap-1">
            {['TODOS', 'BASICO', 'INSUMO'].map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  filter === f ? 'bg-primary text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100'
                }`}>
                {f === 'TODOS' ? 'Todos' : f === 'BASICO' ? 'Básicos' : 'Insumos'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center py-10 text-sm text-slate-400">Sin resultados</p>
        ) : (
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 w-28">Código</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Descripción</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 w-20">Unidad</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 w-32">P. Unitario</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 w-40">Fuente</th>
                  {canEdit && <th className="w-12"></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => {
                  const isBasic = b.codigo.toUpperCase().startsWith('BASICO');
                  return (
                    <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${isBasic ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-600'}`}>
                          {b.codigo}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">{b.descripcion}</td>
                      <td className="px-3 py-2 text-slate-500">{b.unidad}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">{fmtCOP(b.precioUnitario)}</td>
                      <td className="px-3 py-2 text-xs text-slate-400">{b.fuente || '—'}</td>
                      {canEdit && (
                        <td className="px-2 py-2 text-right">
                          {deleteId === b.id ? (
                            <div className="flex items-center gap-1 justify-end">
                              <Button size="sm" variant="danger" onClick={() => handleDelete(b.id)}>Sí</Button>
                              <Button size="sm" variant="ghost" onClick={() => setDeleteId(null)}>No</Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => setDeleteId(b.id)}>🗑️</Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
