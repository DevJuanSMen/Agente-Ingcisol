import { useState, useRef, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { useProjectStore } from '../../store/projectStore';

const fmtCOP = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;

const INSUMO_TIPO_STYLE = {
  MATERIAL:  'bg-blue-50 text-blue-600',
  M_DE_OBRA: 'bg-orange-50 text-orange-600',
  EQUIPO:    'bg-slate-100 text-slate-600',
  OTRO:      'bg-gray-100 text-gray-500',
};
const INSUMO_TIPO_LABEL = { MATERIAL: 'Material', M_DE_OBRA: 'M. Obra', EQUIPO: 'Equipo', OTRO: 'Otro' };

// ── Pestaña: ítems APU (editable, con insumos expandibles) ────────────────────
function ApuTab({ items, setItems }) {
  const [expanded, setExpanded] = useState(null);

  const update = (i, field, value) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  const remove = (i) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div className="overflow-auto max-h-[52vh]">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="bg-slate-800 text-white">
            <th className="px-2 py-2 w-8"></th>
            <th className="px-2 py-2 text-left w-24">Código</th>
            <th className="px-2 py-2 text-left">Descripción</th>
            <th className="px-2 py-2 text-left w-16">Und</th>
            <th className="px-2 py-2 text-left w-40">Capítulo</th>
            <th className="px-2 py-2 text-right w-24">Cantidad</th>
            <th className="px-2 py-2 text-right w-28">P. Unitario</th>
            <th className="px-2 py-2 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <Fragment key={it.codigo + i}>
              <tr className="border-b border-slate-100 hover:bg-blue-50/30">
                <td className="px-2 py-1 text-center">
                  {it.insumos?.length > 0 ? (
                    <button onClick={() => setExpanded(expanded === i ? null : i)} className="text-slate-400 hover:text-primary">
                      {expanded === i ? '▼' : '▶'}
                    </button>
                  ) : (
                    <span className="text-[9px] text-amber-500" title="Sin insumos vinculados">⚠</span>
                  )}
                </td>
                <td className="px-1 py-1">
                  <input value={it.codigo} onChange={(e) => update(i, 'codigo', e.target.value)}
                    className="w-full px-1 py-0.5 font-mono bg-transparent border border-transparent focus:border-blue-400 focus:bg-white rounded focus:outline-none" />
                  {!(it.insumos?.length > 0) && (
                    <span className="block text-[9px] text-amber-500 leading-none mt-0.5">sin insumos</span>
                  )}
                </td>
                <td className="px-1 py-1">
                  <input value={it.descripcion} onChange={(e) => update(i, 'descripcion', e.target.value)}
                    className="w-full px-1 py-0.5 bg-transparent border border-transparent focus:border-blue-400 focus:bg-white rounded focus:outline-none" />
                </td>
                <td className="px-1 py-1">
                  <input value={it.unidad} onChange={(e) => update(i, 'unidad', e.target.value)}
                    className="w-full px-1 py-0.5 bg-transparent border border-transparent focus:border-blue-400 focus:bg-white rounded focus:outline-none" />
                </td>
                <td className="px-1 py-1">
                  <input value={it.capitulo || ''} onChange={(e) => update(i, 'capitulo', e.target.value)}
                    className="w-full px-1 py-0.5 text-slate-500 bg-transparent border border-transparent focus:border-blue-400 focus:bg-white rounded focus:outline-none" />
                </td>
                <td className="px-1 py-1">
                  <input type="number" value={it.cantidad} onChange={(e) => update(i, 'cantidad', e.target.value)}
                    className="w-full px-1 py-0.5 text-right bg-transparent border border-transparent focus:border-blue-400 focus:bg-white rounded focus:outline-none" />
                </td>
                <td className="px-1 py-1">
                  <input type="number" value={it.precioUnitario} onChange={(e) => update(i, 'precioUnitario', e.target.value)}
                    className="w-full px-1 py-0.5 text-right bg-transparent border border-transparent focus:border-blue-400 focus:bg-white rounded focus:outline-none" />
                </td>
                <td className="px-1 py-1 text-center">
                  <button onClick={() => remove(i)} className="text-slate-300 hover:text-red-400">&times;</button>
                </td>
              </tr>
              {expanded === i && it.insumos?.length > 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-2 bg-slate-50">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400 border-b border-slate-200">
                          <th className="px-2 py-1 text-left w-24">Tipo</th>
                          <th className="px-2 py-1 text-left">Insumo</th>
                          <th className="px-2 py-1 text-left w-16">Und</th>
                          <th className="px-2 py-1 text-right w-20">Rend.</th>
                          <th className="px-2 py-1 text-right w-24">V. Unit.</th>
                          <th className="px-2 py-1 text-right w-24">V. Parcial</th>
                        </tr>
                      </thead>
                      <tbody>
                        {it.insumos.map((ins, k) => (
                          <tr key={k} className="border-b border-slate-100 last:border-0">
                            <td className="px-2 py-1">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${INSUMO_TIPO_STYLE[ins.tipo] || INSUMO_TIPO_STYLE.OTRO}`}>
                                {INSUMO_TIPO_LABEL[ins.tipo] || ins.tipo}
                              </span>
                            </td>
                            <td className="px-2 py-1 text-slate-600">{ins.descripcion}</td>
                            <td className="px-2 py-1 text-slate-500">{ins.unidad}</td>
                            <td className="px-2 py-1 text-right font-mono text-slate-500">{Number(ins.rendimiento).toLocaleString('es-CO', { maximumFractionDigits: 4 })}</td>
                            <td className="px-2 py-1 text-right text-slate-600">{fmtCOP(ins.precioUnitario)}</td>
                            <td className="px-2 py-1 text-right font-semibold text-slate-700">{fmtCOP(ins.precioTotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Pestaña genérica: precios (básicos / insumos) ─────────────────────────────
function PriceTab({ items, setItems, showInsumos }) {
  const [expanded, setExpanded] = useState(null);
  const update = (i, field, value) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  const remove = (i) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div className="overflow-auto max-h-[52vh]">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="bg-slate-800 text-white">
            {showInsumos && <th className="px-2 py-2 w-8"></th>}
            <th className="px-2 py-2 text-left w-28">Código</th>
            <th className="px-2 py-2 text-left">Descripción</th>
            <th className="px-2 py-2 text-left w-20">Und</th>
            <th className="px-2 py-2 text-right w-32">P. Unitario</th>
            <th className="px-2 py-2 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <Fragment key={it.codigo + i}>
              <tr className="border-b border-slate-100 hover:bg-green-50/30">
                {showInsumos && (
                  <td className="px-2 py-1 text-center">
                    {it.insumos?.length > 0 && (
                      <button onClick={() => setExpanded(expanded === i ? null : i)} className="text-slate-400 hover:text-primary">
                        {expanded === i ? '▼' : '▶'}
                      </button>
                    )}
                  </td>
                )}
                <td className="px-1 py-1">
                  <input value={it.codigo} onChange={(e) => update(i, 'codigo', e.target.value)}
                    className="w-full px-1 py-0.5 font-mono bg-transparent border border-transparent focus:border-green-400 focus:bg-white rounded focus:outline-none" />
                </td>
                <td className="px-1 py-1">
                  <input value={it.descripcion} onChange={(e) => update(i, 'descripcion', e.target.value)}
                    className="w-full px-1 py-0.5 bg-transparent border border-transparent focus:border-green-400 focus:bg-white rounded focus:outline-none" />
                </td>
                <td className="px-1 py-1">
                  <input value={it.unidad} onChange={(e) => update(i, 'unidad', e.target.value)}
                    className="w-full px-1 py-0.5 bg-transparent border border-transparent focus:border-green-400 focus:bg-white rounded focus:outline-none" />
                </td>
                <td className="px-1 py-1">
                  <input type="number" value={it.precioUnitario} onChange={(e) => update(i, 'precioUnitario', e.target.value)}
                    className="w-full px-1 py-0.5 text-right bg-transparent border border-transparent focus:border-green-400 focus:bg-white rounded focus:outline-none" />
                </td>
                <td className="px-1 py-1 text-center">
                  <button onClick={() => remove(i)} className="text-slate-300 hover:text-red-400">&times;</button>
                </td>
              </tr>
              {showInsumos && expanded === i && it.insumos?.length > 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-2 bg-slate-50">
                    <table className="w-full text-xs">
                      <tbody>
                        {it.insumos.map((ins, k) => (
                          <tr key={k} className="border-b border-slate-100 last:border-0">
                            <td className="px-2 py-1 w-24">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${INSUMO_TIPO_STYLE[ins.tipo] || INSUMO_TIPO_STYLE.OTRO}`}>
                                {INSUMO_TIPO_LABEL[ins.tipo] || ins.tipo}
                              </span>
                            </td>
                            <td className="px-2 py-1 text-slate-600">{ins.descripcion}</td>
                            <td className="px-2 py-1 text-slate-500 w-16">{ins.unidad}</td>
                            <td className="px-2 py-1 text-right text-slate-600 w-24">{fmtCOP(ins.precioUnitario)}</td>
                            <td className="px-2 py-1 text-right font-semibold text-slate-700 w-24">{fmtCOP(ins.precioTotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Modal con pestañas ────────────────────────────────────────────────────────
function ImportModal({ data, onClose, onConfirm }) {
  const [tab, setTab]   = useState('apu');
  const [apu, setApu]   = useState(data.apuItems || []);
  const [basicos, setBasicos] = useState(data.basicPrices || []);
  const [insumos, setInsumos] = useState(data.insumos || []);
  const [saving, setSaving]   = useState(false);

  const tabs = [
    { key: 'apu',      label: `Presupuesto / APU (${apu.length})` },
    { key: 'basicos',  label: `Básicos (${basicos.length})` },
    { key: 'insumos',  label: `Insumos (${insumos.length})` },
  ];

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await onConfirm({ apuItems: apu, basicPrices: basicos, insumos });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-auto py-6 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-800">Revisar e importar presupuesto maestro</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Hojas detectadas:{' '}
              {Object.entries(data.sheetsDetectadas)
                .map(([k, v]) => `${k.toUpperCase()} → ${v || '—'}`)
                .join('  ·  ')}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
        </div>

        {data.resumen?.apuSinInsumos > 0 && (
          <div className="mx-6 mt-3 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <span className="text-base flex-shrink-0">⚠️</span>
            <p className="text-xs text-amber-800">
              <strong>{data.resumen.apuSinInsumos}</strong> de {data.resumen.apu} ítems APU no tienen insumos vinculados
              (marcados con <span className="text-amber-700 font-semibold">sin insumos</span>). Revisa que las hojas se hayan
              detectado bien; puedes corregir el desglose antes de importar.
            </p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 border-b border-slate-200">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors ${
                tab === t.key ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-100'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-4 py-3">
          {tab === 'apu'     && <ApuTab items={apu} setItems={setApu} />}
          {tab === 'basicos' && <PriceTab items={basicos} setItems={setBasicos} showInsumos />}
          {tab === 'insumos' && <PriceTab items={insumos} setItems={setInsumos} showInsumos={false} />}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <span className="text-sm text-slate-600">
            <strong>{apu.length}</strong> ítems APU · <strong>{basicos.length}</strong> básicos · <strong>{insumos.length}</strong> insumos
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleConfirm} loading={saving}>Importar todo</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────
export default function MasterImport() {
  const navigate = useNavigate();
  const activeProject = useProjectStore((s) => s.activeProject);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult]   = useState(null);
  const fileRef = useRef();

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setParsing(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/master-import/preview', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setPreview(r.data.data);
    } catch (err) {
      alert(err.response?.data?.message || 'Error al analizar el Excel.');
    } finally {
      setParsing(false);
      e.target.value = '';
    }
  };

  const handleConfirm = async (payload) => {
    const r = await api.post('/master-import/confirm', payload);
    setPreview(null);
    setResult(r.data.data);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Importar Presupuesto Maestro</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {activeProject ? `Proyecto activo: ${activeProject.nombre}` : 'Sin proyecto activo'}
        </p>
      </div>

      <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700">
        <span className="text-lg flex-shrink-0">📘</span>
        <div>
          <p className="font-semibold">Un solo archivo para todo el proyecto</p>
          <p className="text-xs mt-1 text-blue-600">
            Sube el Excel maestro. El sistema lee automáticamente las hojas <b>PRESUPUESTO</b>, <b>APUs</b>, <b>BASICOS</b> e <b>INSUMOS</b>,
            arma la lista de ítems APU con su desglose de insumos, los precios básicos y la base de insumos. Podrás revisar y editar todo antes de guardar.
          </p>
        </div>
      </div>

      {!activeProject && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          Selecciona un proyecto activo antes de importar.
        </div>
      )}

      <Card>
        <div className="text-center py-10">
          <div className="text-5xl mb-4">📂</div>
          <p className="text-sm font-medium text-slate-600 mb-2">Sube tu Excel de presupuesto</p>
          <p className="text-xs text-slate-400 mb-5">Formato .xlsx con hojas PRESUPUESTO, APUs, BASICOS, INSUMOS</p>
          <input type="file" accept=".xlsx,.xls" ref={fileRef} onChange={handleFile} className="hidden" />
          <Button loading={parsing} disabled={!activeProject} onClick={() => fileRef.current.click()}>
            {parsing ? 'Analizando…' : 'Seleccionar archivo'}
          </Button>
        </div>
      </Card>

      {result && (
        <Card>
          <div className="text-center py-6">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-base font-bold text-slate-700 mb-1">Importación completada</p>
            <p className="text-sm text-slate-500 mb-4">
              {result.counts.apu} ítems APU y {result.counts.basicos} precios básicos guardados en <b>{result.proyecto}</b>
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button variant="secondary" onClick={() => navigate('/apu')}>Ver APU</Button>
              <Button variant="secondary" onClick={() => navigate('/basic-prices')}>Ver Básicos</Button>
            </div>
          </div>
        </Card>
      )}

      {preview && (
        <ImportModal data={preview} onClose={() => setPreview(null)} onConfirm={handleConfirm} />
      )}
    </div>
  );
}
