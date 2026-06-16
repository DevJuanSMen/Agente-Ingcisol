import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const newApuItem  = ()  => ({ tipo: 'APU', apuId: '', descripcion: '', unidad: '', codigo: '', cantidad: 1 });
const newFreeItem = ()  => ({ tipo: 'LIBRE', descripcion: '', unidad: 'UND', codigo: '', cantidad: 1 });

// Dropdown con búsqueda para APU items
function ApuSelect({ apuList, value, onChange }) {
  const [query, setQuery]   = useState('');
  const [open, setOpen]     = useState(false);
  const wrapRef             = useRef();

  const filtered = apuList.filter(
    (a) =>
      a.descripcion.toLowerCase().includes(query.toLowerCase()) ||
      a.codigo.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 40);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = apuList.find((a) => a.id === value);

  return (
    <div className="relative" ref={wrapRef}>
      <div
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm cursor-pointer flex items-center justify-between gap-2 bg-white focus-within:ring-2 focus-within:ring-primary focus-within:border-primary"
        onClick={() => setOpen((p) => !p)}
      >
        {selected ? (
          <span className="text-slate-700 truncate">
            <span className="text-slate-400 font-mono text-xs mr-1">{selected.codigo}</span>
            {selected.descripcion}
          </span>
        ) : (
          <span className="text-slate-400">Buscar ítem APU…</span>
        )}
        <span className="text-slate-400 flex-shrink-0">▾</span>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar código o descripción…"
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="text-center py-4 text-xs text-slate-400">Sin resultados</div>
            )}
            {filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                className="w-full flex items-start gap-2 px-3 py-2 hover:bg-primary/5 text-left border-b border-slate-50 last:border-0"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(a); setQuery(''); setOpen(false); }}
              >
                <span className="text-xs text-slate-400 font-mono w-16 flex-shrink-0 mt-0.5">{a.codigo}</span>
                <div className="min-w-0">
                  <p className="text-sm text-slate-700 truncate">{a.descripcion}</p>
                  <p className="text-xs text-slate-400">{a.unidad} — Saldo: {Number(a.saldoCantidad || 0).toLocaleString('es-CO')}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RequisitionNew() {
  const navigate = useNavigate();
  const [projects, setProjects]       = useState([]);
  const [projectId, setProjectId]     = useState('');
  const [apuList, setApuList]         = useState([]);
  const [apuLoading, setApuLoading]   = useState(false);
  const [prioridad, setPrioridad]     = useState('MEDIA');
  const [fechaLimite, setFechaLimite] = useState('');
  const [items, setItems]             = useState([newApuItem()]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  // Carga proyectos
  useEffect(() => {
    api.get('/projects').then((r) => {
      const list = r.data.data || [];
      setProjects(list);
      const active = list.find((p) => p.activo);
      if (active) setProjectId(active.id);
    });
  }, []);

  // Carga APUs cuando cambia el proyecto
  useEffect(() => {
    if (!projectId) { setApuList([]); return; }
    setApuLoading(true);
    api.get('/apu')
      .then((r) => {
        // La respuesta es un árbol por capítulos; aplanar a lista plana
        const treeData = r.data.data;
        const all = (treeData?.tree || []).flatMap((cap) => cap.items || []);
        setApuList(all);
      })
      .catch(() => setApuList([]))
      .finally(() => setApuLoading(false));
  }, [projectId]);

  const addItem = (tipo) => {
    setItems((prev) => [...prev, tipo === 'APU' ? newApuItem() : newFreeItem()]);
  };

  const removeItem = (i) => {
    if (items.length === 1) return;
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  };

  const updateItem = (i, field, value) => {
    setItems((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
  };

  const selectApu = (i, apu) => {
    setItems((prev) => {
      const next = [...prev];
      next[i] = {
        ...next[i],
        apuId: apu.id,
        descripcion: apu.descripcion,
        unidad: apu.unidad,
        codigo: apu.codigo,
      };
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!projectId) return setError('Selecciona un proyecto');

    const validItems = items.filter((it) => it.descripcion?.trim());
    if (!validItems.length) return setError('Agrega al menos un ítem con descripción');

    setError('');
    setLoading(true);
    try {
      await api.post('/requisitions', {
        projectId,
        prioridad,
        fechaLimite: fechaLimite || null,
        canal: 'APP',
        items: validItems.map((it) => ({
          descripcion: it.descripcion,
          cantidad: parseFloat(it.cantidad) || 1,
          unidad: it.unidad || 'UND',
          codigo: it.codigo || '',
        })),
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
        <p className="text-sm text-slate-500 mt-0.5">Solicita materiales del APU o agrega ítems libres</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
        )}

        <Card title="Datos generales">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
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
            <div className="flex gap-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => addItem('APU')}
                disabled={apuLoading || apuList.length === 0}
              >
                + Del APU
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => addItem('LIBRE')}
              >
                + Libre
              </Button>
            </div>
          }
        >
          {apuLoading && (
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
              <div className="w-3 h-3 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
              Cargando ítems APU del proyecto…
            </div>
          )}

          {!apuLoading && projectId && apuList.length === 0 && (
            <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              Este proyecto no tiene ítems APU cargados. Solo puedes agregar ítems libres.
            </div>
          )}

          <div className="space-y-3">
            {items.map((item, i) => (
              <div
                key={i}
                className={`rounded-xl border p-3 space-y-2 ${
                  item.tipo === 'APU' ? 'border-blue-200 bg-blue-50/30' : 'border-slate-200 bg-white'
                }`}
              >
                {/* Tipo badge + remove */}
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    item.tipo === 'APU' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {item.tipo === 'APU' ? 'Del APU' : 'Ítem libre'}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    disabled={items.length === 1}
                    className="text-slate-300 hover:text-red-400 transition-colors disabled:opacity-30 text-lg leading-none"
                  >
                    &times;
                  </button>
                </div>

                {item.tipo === 'APU' ? (
                  // Fila APU: dropdown searchable + cantidad
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="block text-xs text-slate-500 mb-1">Ítem APU</label>
                      <ApuSelect
                        apuList={apuList}
                        value={item.apuId}
                        onChange={(apu) => selectApu(i, apu)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">
                        Cantidad <span className="text-slate-400">({item.unidad || '—'})</span>
                      </label>
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        required
                        value={item.cantidad}
                        onChange={(e) => updateItem(i, 'cantidad', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="1"
                      />
                    </div>
                    {/* Campos de solo lectura si hay APU seleccionado */}
                    {item.descripcion && (
                      <div className="col-span-3 flex items-center gap-3 text-xs text-slate-500 bg-white rounded-lg px-3 py-2 border border-slate-200">
                        <span className="font-mono text-slate-400">{item.codigo}</span>
                        <span className="font-medium text-slate-700 truncate">{item.descripcion}</span>
                        <span className="ml-auto flex-shrink-0">{item.unidad}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  // Fila libre: campos editables
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-5">
                      <label className="block text-xs text-slate-500 mb-1">Descripción</label>
                      <input
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="Material o actividad…"
                        value={item.descripcion}
                        onChange={(e) => updateItem(i, 'descripcion', e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-slate-500 mb-1">Cantidad</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        value={item.cantidad}
                        onChange={(e) => updateItem(i, 'cantidad', e.target.value)}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-slate-500 mb-1">Unidad</label>
                      <input
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary uppercase"
                        placeholder="UND"
                        value={item.unidad}
                        onChange={(e) => updateItem(i, 'unidad', e.target.value.toUpperCase())}
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-xs text-slate-500 mb-1">Cód. APU (opcional)</label>
                      <input
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="01.01"
                        value={item.codigo}
                        onChange={(e) => updateItem(i, 'codigo', e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-400 mt-3">
            Los ítems del APU se validan automáticamente contra el presupuesto del proyecto.
          </p>
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
