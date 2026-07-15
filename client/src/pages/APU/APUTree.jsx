import { useEffect, useState, useRef } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const fmtCOP = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
const pct = (saldo, total) => {
  if (!total || Number(total) === 0) return 0;
  return Math.round((1 - Number(saldo) / Number(total)) * 100);
};

// Normaliza la ejecución que envía el servidor: % gastado (OC pagadas),
// % comprometido (OC en curso) y saldo disponible sobre el presupuesto.
const getEjecucion = (ejecucion) => {
  const presupuesto = Number(ejecucion?.presupuesto) || 0;
  const gastado = Number(ejecucion?.gastado) || 0;
  const comprometido = Number(ejecucion?.comprometido) || 0;
  if (presupuesto <= 0) return null;
  const pctGastado = Math.min(100, (gastado / presupuesto) * 100);
  const pctComprometido = Math.min(100 - pctGastado, (comprometido / presupuesto) * 100);
  return {
    presupuesto,
    gastado,
    comprometido,
    saldo: Math.max(0, presupuesto - gastado - comprometido),
    pctGastado,
    pctComprometido,
    pctTotal: Math.round(pctGastado + pctComprometido),
  };
};

// Barra de ejecución: segmento sólido = gastado (pagado), segmento claro =
// comprometido (OC emitida/enviada/entregada sin pagar).
const EjecucionBar = ({ ejec, height = 'h-1.5' }) => {
  const color = ejec.pctTotal > 90 ? 'bg-danger' : ejec.pctTotal > 60 ? 'bg-warning' : 'bg-success';
  return (
    <div className={`flex-1 ${height} bg-slate-200 rounded-full overflow-hidden flex`}>
      <div className={`h-full ${color} transition-all`} style={{ width: `${ejec.pctGastado}%` }} />
      <div className={`h-full ${color} opacity-40 transition-all`} style={{ width: `${ejec.pctComprometido}%` }} />
    </div>
  );
};

const TIPO_STYLE = {
  APU:         'bg-blue-100 text-blue-700',
  BASICOS:     'bg-green-100 text-green-700',
  PRESUPUESTO: 'bg-purple-100 text-purple-700',
};

const INSUMO_TIPO_STYLE = {
  MATERIAL:  'bg-blue-50 text-blue-600',
  M_DE_OBRA: 'bg-orange-50 text-orange-600',
  MANO_DE_OBRA: 'bg-orange-50 text-orange-600',
  EQUIPO:    'bg-slate-100 text-slate-600',
  HERRAMIENTA: 'bg-slate-100 text-slate-600',
  OTRO:      'bg-gray-100 text-gray-500',
};

const INSUMO_TIPO_LABEL = {
  MATERIAL:     'Material',
  M_DE_OBRA:    'Mano de obra',
  MANO_DE_OBRA: 'Mano de obra',
  EQUIPO:       'Equipo',
  HERRAMIENTA:  'Herramienta',
  OTRO:         'Otro',
};

// ── Insumos table expandible bajo cada ítem APU ───────────────────────────────
function InsumosTable({ insumos, apuCodigo }) {
  if (!insumos || insumos.length === 0) return null;

  const byTipo = {};
  for (const ins of insumos) {
    const t = ins.tipo || 'OTRO';
    if (!byTipo[t]) byTipo[t] = [];
    byTipo[t].push(ins);
  }

  return (
    <div className="mt-1 ml-4 border-l-2 border-blue-100 pl-3">
      <div className="overflow-x-auto rounded-lg border border-slate-100">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-3 py-1.5 text-left text-slate-500 font-semibold w-24">Tipo</th>
              <th className="px-3 py-1.5 text-left text-slate-500 font-semibold">Descripción del insumo</th>
              <th className="px-3 py-1.5 text-center text-slate-500 font-semibold w-16">Und</th>
              <th className="px-3 py-1.5 text-right text-slate-500 font-semibold w-20">Rend.</th>
              <th className="px-3 py-1.5 text-right text-slate-500 font-semibold w-28">V. Unitario</th>
              <th className="px-3 py-1.5 text-right text-slate-500 font-semibold w-28">V. Parcial</th>
              <th className="px-3 py-1.5 text-left text-slate-500 font-semibold w-40">Ejecución</th>
            </tr>
          </thead>
          <tbody>
            {insumos.map((ins, i) => {
              const ejec = getEjecucion(ins.ejecucion);
              return (
              <tr key={ins.id || i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-3 py-1.5">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${INSUMO_TIPO_STYLE[ins.tipo] || INSUMO_TIPO_STYLE.OTRO}`}>
                    {INSUMO_TIPO_LABEL[ins.tipo] || ins.tipo}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-700">{ins.descripcion}</td>
                <td className="px-3 py-1.5 text-center text-slate-500">{ins.unidad}</td>
                <td className="px-3 py-1.5 text-right text-slate-600 font-mono">
                  {Number(ins.rendimiento).toLocaleString('es-CO', { maximumFractionDigits: 4 })}
                </td>
                <td className="px-3 py-1.5 text-right text-slate-700">{fmtCOP(ins.precioUnitario)}</td>
                <td className="px-3 py-1.5 text-right font-semibold text-slate-800">{fmtCOP(ins.precioTotal)}</td>
                <td className="px-3 py-1.5">
                  {ejec ? (
                    <div
                      className="flex items-center gap-2"
                      title={`Gastado ${fmtCOP(ejec.gastado)}${ejec.comprometido > 0 ? ` · Comprometido ${fmtCOP(ejec.comprometido)}` : ''} de ${fmtCOP(ejec.presupuesto)} · Saldo ${fmtCOP(ejec.saldo)}`}
                    >
                      <EjecucionBar ejec={ejec} height="h-1" />
                      <span className="text-xs text-slate-400 w-8 text-right flex-shrink-0">{ejec.pctTotal}%</span>
                    </div>
                  ) : (
                    <span className="text-slate-300 text-xs">—</span>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200">
              <td colSpan={5} className="px-3 py-1.5 text-xs font-semibold text-slate-600 text-right">
                Costo unitario total
              </td>
              <td className="px-3 py-1.5 text-right text-sm font-bold text-slate-800">
                {fmtCOP(insumos.reduce((s, ins) => s + Number(ins.precioTotal || 0), 0))}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── APU Item row ──────────────────────────────────────────────────────────────
const ItemRow = ({ item }) => {
  const [expanded, setExpanded] = useState(false);
  const ejec = getEjecucion(item.ejecucion);
  // Fallback para respuestas sin ejecución (servidor viejo): solo saldoValor.
  const ejecutado = ejec ? ejec.pctTotal : pct(item.saldoValor, item.cantidad * item.precioUnitario);
  const hasInsumos = item.insumos && item.insumos.length > 0;

  return (
    <div className="rounded-lg mb-1">
      {/* Header row */}
      <div
        className={`py-2 px-3 rounded-lg transition-colors ${hasInsumos ? 'cursor-pointer hover:bg-blue-50/50' : 'hover:bg-slate-50'}`}
        onClick={() => hasInsumos && setExpanded((p) => !p)}
      >
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            {hasInsumos && (
              <span className="text-slate-300 text-xs flex-shrink-0">{expanded ? '▼' : '▶'}</span>
            )}
            <span className="text-xs text-slate-400 font-mono flex-shrink-0 w-20">{item.codigo}</span>
            <span className="text-sm text-slate-700 truncate">{item.descripcion}</span>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0 ml-4">
            <span className="text-xs text-slate-500">{item.unidad}</span>
            <span className="text-xs font-semibold text-slate-700">{fmtCOP(item.precioUnitario)}</span>
            {hasInsumos && (
              <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">
                {item.insumos.length} insumos
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 pl-6">
          {ejec ? (
            <EjecucionBar ejec={ejec} />
          ) : (
            <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${ejecutado > 90 ? 'bg-danger' : ejecutado > 60 ? 'bg-warning' : 'bg-success'}`}
                style={{ width: `${ejecutado}%` }}
              />
            </div>
          )}
          <span className="text-xs text-slate-400 w-10 text-right">{ejecutado}%</span>
          <span className="text-xs text-slate-500 w-28 text-right">
            Saldo: {fmtCOP(ejec ? ejec.saldo : item.saldoValor)}
          </span>
        </div>
        {ejec && (ejec.gastado > 0 || ejec.comprometido > 0) && (
          <p className="text-xs text-slate-400 pl-6 mt-1">
            Gastado {fmtCOP(ejec.gastado)}
            {ejec.comprometido > 0 && <> · Comprometido {fmtCOP(ejec.comprometido)}</>}
            {' '}de {fmtCOP(ejec.presupuesto)}
          </p>
        )}
      </div>

      {/* Insumos expandidos */}
      {expanded && hasInsumos && (
        <InsumosTable insumos={item.insumos} apuCodigo={item.codigo} />
      )}
    </div>
  );
};

// ── Chapter row ───────────────────────────────────────────────────────────────
const ChapterRow = ({ capitulo }) => {
  const [open, setOpen] = useState(true);
  const totalAPUs = capitulo.items.length;
  const totalValor = capitulo.items.reduce(
    (s, it) => s + Number(it.precioUnitario || 0) * Number(it.cantidad || 0), 0
  );

  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors"
      >
        <span className="text-slate-400">{open ? '▼' : '▶'}</span>
        <span className="text-sm font-bold">Capítulo {capitulo.capitulo}</span>
        <span className="text-xs text-slate-400 ml-2">{totalAPUs} ítems APU</span>
        <span className="text-xs text-slate-300 ml-auto">{fmtCOP(totalValor)}</span>
      </button>
      {open && (
        <div className="mt-1 ml-2 border-l-2 border-slate-200 pl-3">
          {capitulo.items.map((item) => <ItemRow key={item.id} item={item} />)}
        </div>
      )}
    </div>
  );
};

// ── Excel/PDF grid modal ──────────────────────────────────────────────────────
function ItemImportGrid({ items: initial, sheets, onImport, onClose }) {
  const [rows, setRows]     = useState(() => initial.map((it, i) => ({ ...it, _id: i, selected: true })));
  const [filter, setFilter] = useState('TODOS');
  const [search, setSearch] = useState('');
  const [sheetFilter, setSheetFilter] = useState('TODOS');
  const [importing, setImporting]     = useState(false);

  const updateRow = (id, field, value) =>
    setRows((prev) => prev.map((r) => r._id === id ? { ...r, [field]: value } : r));

  const toggleSelect = (id) => updateRow(id, 'selected', !rows.find((r) => r._id === id).selected);

  const filteredRows = rows.filter((r) => {
    if (filter !== 'TODOS' && r.tipo !== filter) return false;
    if (sheetFilter !== 'TODOS' && r._sheet !== sheetFilter) return false;
    if (search && !r.descripcion?.toLowerCase().includes(search.toLowerCase()) &&
        !(r.codigo || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const toggleAll = () => {
    const ids    = filteredRows.map((r) => r._id);
    const allSel = ids.every((id) => rows.find((r) => r._id === id).selected);
    setRows((prev) => prev.map((r) => ids.includes(r._id) ? { ...r, selected: !allSel } : r));
  };

  const selectedCount  = rows.filter((r) => r.selected).length;
  const uniqueSheets   = [...new Set(rows.map((r) => r._sheet).filter(Boolean))];

  const handleImport = async () => {
    const toImport = rows.filter((r) => r.selected);
    if (!toImport.length) return;
    setImporting(true);
    try { await onImport(toImport); }
    finally { setImporting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-auto py-6 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-800">Seleccionar ítems del Excel</h2>
            {sheets && sheets.length > 0 && (
              <p className="text-xs text-slate-500 mt-0.5">
                {sheets.filter((s) => !s.omitida).map((s) => `${s.nombre} (${s.tipo}: ${s.total} filas)`).join(' · ')}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
        </div>

        <div className="flex items-center gap-2 px-6 py-3 bg-slate-50 border-b border-slate-200 flex-wrap">
          <input type="text" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
          {uniqueSheets.length > 1 && (
            <select value={sheetFilter} onChange={(e) => setSheetFilter(e.target.value)}
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none">
              <option value="TODOS">Todas las hojas</option>
              {uniqueSheets.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <div className="flex gap-1">
            {['TODOS', 'APU', 'BASICOS', 'PRESUPUESTO'].map((t) => {
              const count = t === 'TODOS' ? rows.length : rows.filter((r) => r.tipo === t).length;
              if (t !== 'TODOS' && count === 0) return null;
              return (
                <button key={t} onClick={() => setFilter(t)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${filter === t ? 'bg-primary text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100'}`}>
                  {t === 'TODOS' ? `Todos (${count})` : `${t} (${count})`}
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-auto max-h-[55vh]">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-800 text-white">
                <th className="w-10 px-3 py-2.5">
                  <input type="checkbox" checked={filteredRows.length > 0 && filteredRows.every((r) => r.selected)}
                    onChange={toggleAll} className="w-4 h-4 accent-primary" />
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 w-8">#</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold w-24">Código</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold">Descripción</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold w-20">Unidad</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold w-24">Cantidad</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold w-32">Precio Unit.</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold w-28">Tipo</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, idx) => (
                <tr key={row._id}
                  className={`border-b transition-colors ${row.selected ? 'border-blue-100 bg-white hover:bg-blue-50/30' : 'border-slate-100 bg-slate-50 opacity-50'}`}>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={row.selected} onChange={() => toggleSelect(row._id)} className="w-4 h-4 accent-primary" />
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400 text-center bg-slate-50 border-r border-slate-200 select-none">{idx + 1}</td>
                  <td className="px-2 py-1.5 border-r border-slate-100">
                    <input value={row.codigo || ''} onChange={(e) => updateRow(row._id, 'codigo', e.target.value)}
                      className="w-full px-2 py-1 text-xs font-mono bg-transparent border border-transparent focus:border-blue-400 focus:bg-white rounded focus:outline-none" placeholder="—" />
                  </td>
                  <td className="px-2 py-1.5 border-r border-slate-100">
                    <input value={row.descripcion} onChange={(e) => updateRow(row._id, 'descripcion', e.target.value)}
                      className="w-full px-2 py-1 text-xs bg-transparent border border-transparent focus:border-blue-400 focus:bg-white rounded focus:outline-none" />
                  </td>
                  <td className="px-2 py-1.5 border-r border-slate-100">
                    <input value={row.unidad || ''} onChange={(e) => updateRow(row._id, 'unidad', e.target.value)}
                      className="w-full px-2 py-1 text-xs uppercase bg-transparent border border-transparent focus:border-blue-400 focus:bg-white rounded focus:outline-none" placeholder="UND" />
                  </td>
                  <td className="px-2 py-1.5 border-r border-slate-100">
                    <input type="number" value={row.cantidad || ''} onChange={(e) => updateRow(row._id, 'cantidad', e.target.value)}
                      className="w-full px-2 py-1 text-xs text-right bg-transparent border border-transparent focus:border-blue-400 focus:bg-white rounded focus:outline-none" placeholder="0" />
                  </td>
                  <td className="px-2 py-1.5 border-r border-slate-100">
                    <input type="number" value={row.precioUnitario || ''} onChange={(e) => updateRow(row._id, 'precioUnitario', e.target.value)}
                      className="w-full px-2 py-1 text-xs text-right bg-transparent border border-transparent focus:border-blue-400 focus:bg-white rounded focus:outline-none" placeholder="0" />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <select value={row.tipo || 'APU'} onChange={(e) => updateRow(row._id, 'tipo', e.target.value)}
                      className={`text-xs px-2 py-1 rounded-full font-semibold border-0 cursor-pointer focus:outline-none ${TIPO_STYLE[row.tipo] || TIPO_STYLE.APU}`}>
                      <option value="APU">APU</option>
                      <option value="BASICOS">BÁSICOS</option>
                      <option value="PRESUPUESTO">PRESUPUESTO</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredRows.length === 0 && <div className="text-center py-10 text-sm text-slate-400">Sin resultados</div>}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <span className="text-sm text-slate-600">
            <strong className="text-slate-800">{selectedCount}</strong> de {rows.length} ítems seleccionados
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleImport} loading={importing} disabled={selectedCount === 0}>
              Importar {selectedCount > 0 ? `${selectedCount} ítems` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const EMPTY_ITEM = { codigo: '', descripcion: '', unidad: 'UND', cantidad: '', precioUnitario: '' };

export default function APUTree() {
  const [treeData, setTreeData]   = useState(null);
  const [loading, setLoading]     = useState(true);
  const [parsing, setParsing]     = useState(false);
  const [previewData, setPreview] = useState(null);
  const [importResult, setResult] = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState(EMPTY_ITEM);
  const [saving, setSaving]       = useState(false);
  const xlsxRef                   = useRef();

  const load = () => {
    setLoading(true);
    api.get('/apu')
      .then((r) => setTreeData(r.data.data))
      .catch(() => setTreeData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleExcelChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setParsing(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const r = await api.post('/apu/preview-excel', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(r.data.data);
    } catch (err) {
      alert(err.response?.data?.message || 'Error al analizar el Excel.');
    } finally {
      setParsing(false);
      e.target.value = '';
    }
  };

  const handleGridImport = async (items) => {
    const r = await api.post('/apu/import-multi', { items });
    const { counts } = r.data.data;
    setPreview(null);
    setResult([
      counts.apu    > 0 && { nombre: 'APU',            tipo: 'APU',     count: counts.apu },
      counts.basicos > 0 && { nombre: 'Precios Básicos', tipo: 'BASICOS', count: counts.basicos },
    ].filter(Boolean));
    load();
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/apu', form);
      setForm(EMPTY_ITEM);
      setShowForm(false);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al crear el ítem APU');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">APU</h1>
          <p className="text-sm text-slate-500 mt-0.5">{treeData?.project?.nombre || 'Sin proyecto activo'}</p>
        </div>
        <div className="flex gap-2">
          <input type="file" accept=".xlsx,.xls" ref={xlsxRef} onChange={handleExcelChange} className="hidden" />
          <Button variant="secondary" loading={parsing} onClick={() => xlsxRef.current.click()}>
            {parsing ? 'Analizando…' : '🤖 Importar desde Excel'}
          </Button>
          <Button onClick={() => setShowForm((p) => !p)}>+ Añadir APU manual</Button>
        </div>
      </div>

      <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
        <span className="text-base flex-shrink-0">💡</span>
        <p>
          Sube tu Excel de APU. La IA detecta las columnas y muestra los ítems en una grilla para importar.
          Haz clic en el <strong>▶</strong> de cada ítem APU para ver el desglose de insumos (materiales, mano de obra, equipo).
        </p>
      </div>

      {showForm && (
        <Card title="Nuevo ítem APU">
          <form onSubmit={handleAddItem} className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Código *</label>
              <input required value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                placeholder="ACA-01" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div className="col-span-1 md:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Descripción *</label>
              <input required value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                placeholder="Estuco y pintura en muros" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Unidad</label>
              <input value={form.unidad} onChange={(e) => setForm({ ...form, unidad: e.target.value })}
                placeholder="m² / UND / ML" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Cantidad *</label>
              <input required type="number" step="any" min="0" value={form.cantidad}
                onChange={(e) => setForm({ ...form, cantidad: e.target.value })}
                placeholder="100" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Precio unitario (COP) *</label>
              <input required type="number" step="any" min="0" value={form.precioUnitario}
                onChange={(e) => setForm({ ...form, precioUnitario: e.target.value })}
                placeholder="24405" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div className="col-span-full flex items-center justify-between">
              <p className="text-xs text-slate-400">
                Valor total: <strong className="text-slate-600">{fmtCOP((parseFloat(form.cantidad)||0)*(parseFloat(form.precioUnitario)||0))}</strong>
              </p>
              <div className="flex gap-3">
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
                <Button type="submit" loading={saving}>Guardar ítem</Button>
              </div>
            </div>
          </form>
        </Card>
      )}

      {importResult && (
        <Card>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700 mb-3">Importación completada</p>
            {importResult.map((r) => (
              <div key={r.nombre} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-600">{r.nombre}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${TIPO_STYLE[r.tipo] || 'bg-slate-100 text-slate-500'}`}>{r.tipo}</span>
                </div>
                <span className="text-xs text-slate-500">{r.count} registros importados</span>
              </div>
            ))}
            <button onClick={() => setResult(null)} className="text-xs text-slate-400 hover:text-slate-600 mt-2">Cerrar</button>
          </div>
        </Card>
      )}

      {!treeData || treeData.tree?.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="text-5xl mb-4">📐</div>
            <p className="text-sm font-medium text-slate-600 mb-2">Sin ítems APU cargados</p>
            <p className="text-xs text-slate-400 mb-4">
              Sube un Excel y la IA extrae los ítems para que elijas cuáles importar.
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button variant="secondary" onClick={() => xlsxRef.current.click()} loading={parsing}>
                🤖 Importar desde Excel
              </Button>
              <Button onClick={() => setShowForm(true)}>+ Añadir APU manual</Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-xs text-slate-400 mb-3">
            Haz clic en <strong>▶</strong> para ver el desglose de insumos de cada APU
          </p>
          {treeData.tree.map((cap) => <ChapterRow key={cap.capitulo} capitulo={cap} />)}
        </Card>
      )}

      {previewData && (
        <ItemImportGrid
          items={previewData.items || []}
          sheets={previewData.sheets || []}
          onImport={handleGridImport}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
