import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

// ── Helpers ───────────────────────────────────────────────────────────────────

const HINTS = {
  codigo:         ['codigo', 'cod', 'item', 'ref', 'ape', 'code'],
  descripcion:    ['descripcion', 'descripción', 'nombre', 'description', 'detalle', 'actividad', 'concepto'],
  unidad:         ['unidad', 'und', 'unit', 'u.m', 'um'],
  cantidad:       ['cantidad', 'qty', 'cant'],
  precioUnitario: ['precio', 'valor', 'price', 'pu', 'vr unit', 'precio_unitario', 'p.u', 'costo'],
};

function autoDetect(headers, fieldKey) {
  const hints = HINTS[fieldKey] || [];
  return headers.find((h) => hints.some((hint) => h.toLowerCase().includes(hint))) || '';
}

// ── Per-sheet configurator ────────────────────────────────────────────────────

function SheetConfigurator({ sheet, onChange }) {
  const [included, setIncluded]     = useState(true);
  const [selCols, setSelCols]       = useState(() => new Set(sheet.headers));
  const [renames, setRenames]       = useState({});   // {originalCol: newName}
  const [previewOpen, setPreview]   = useState(true);

  // Notifica cambios al padre
  useEffect(() => {
    const activeHeaders = sheet.headers.filter((h) => selCols.has(h));
    const activeFilas   = sheet.filas.map((row) => {
      const out = {};
      for (const h of activeHeaders) {
        out[renames[h] || h] = row[h];
      }
      return out;
    });
    onChange({
      nombre:   sheet.nombre,
      orden:    sheet.orden,
      headers:  activeHeaders.map((h) => renames[h] || h),
      filas:    activeFilas,
      included,
    });
  }, [included, selCols, renames]);

  const toggleCol = (h) =>
    setSelCols((prev) => {
      const next = new Set(prev);
      next.has(h) ? next.delete(h) : next.add(h);
      return next;
    });

  const selectAll  = () => setSelCols(new Set(sheet.headers));
  const clearAll   = () => setSelCols(new Set());

  const previewRows = sheet.filas.slice(0, 6);
  const activeH     = sheet.headers.filter((h) => selCols.has(h));

  return (
    <div className={`rounded-2xl border-2 transition-colors overflow-hidden ${
      included ? 'border-primary/40 bg-white' : 'border-slate-200 bg-slate-50 opacity-60'
    }`}>
      {/* Sheet header */}
      <div className="flex items-center gap-3 px-5 py-3.5 bg-slate-800 text-white">
        <button
          type="button"
          onClick={() => setIncluded((p) => !p)}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
            included ? 'bg-primary border-primary' : 'border-slate-400'
          }`}
        >
          {included && <span className="text-white text-xs leading-none">✓</span>}
        </button>
        <span className="font-semibold text-sm">{sheet.nombre}</span>
        <span className="text-slate-400 text-xs ml-1">
          {sheet.filas.length} filas · {sheet.headers.length} columnas
          {included && ` · ${selCols.size} seleccionadas`}
        </span>
        {included && (
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            className="ml-auto text-slate-400 hover:text-white text-xs"
          >
            {previewOpen ? '▲ Ocultar' : '▼ Expandir'}
          </button>
        )}
      </div>

      {included && previewOpen && (
        <div className="p-4 space-y-4">

          {/* Column selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Columnas a incluir
              </p>
              <div className="flex gap-2 text-xs">
                <button onClick={selectAll} className="text-primary hover:underline">Todas</button>
                <span className="text-slate-300">·</span>
                <button onClick={clearAll} className="text-slate-400 hover:underline">Ninguna</button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="w-10 px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={selCols.size === sheet.headers.length}
                        onChange={(e) => e.target.checked ? selectAll() : clearAll()}
                        className="w-3.5 h-3.5 accent-primary"
                      />
                    </th>
                    {sheet.headers.map((h) => (
                      <th
                        key={h}
                        className={`px-3 py-2 text-left font-semibold whitespace-nowrap border-r border-slate-200 last:border-0 ${
                          selCols.has(h) ? 'text-slate-700' : 'text-slate-300'
                        }`}
                      >
                        <label className="flex flex-col gap-1 cursor-pointer">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={selCols.has(h)}
                              onChange={() => toggleCol(h)}
                              className="w-3.5 h-3.5 accent-primary flex-shrink-0"
                            />
                            <span className="truncate max-w-[120px]" title={h}>{h}</span>
                          </div>
                          {/* Rename input */}
                          {selCols.has(h) && (
                            <input
                              type="text"
                              value={renames[h] ?? ''}
                              onChange={(e) =>
                                setRenames((p) => {
                                  const n = { ...p };
                                  if (e.target.value.trim()) n[h] = e.target.value;
                                  else delete n[h];
                                  return n;
                                })
                              }
                              placeholder={h}
                              className="w-full px-1.5 py-0.5 border border-slate-300 rounded text-xs font-normal text-slate-600 focus:outline-none focus:border-primary"
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                        </label>
                      </th>
                    ))}
                  </tr>
                </thead>

                {/* Preview rows */}
                <tbody>
                  {previewRows.map((row, ri) => (
                    <tr key={ri} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-2 py-1.5 text-center text-slate-300 text-xs">{ri + 1}</td>
                      {sheet.headers.map((h) => (
                        <td
                          key={h}
                          className={`px-3 py-1.5 whitespace-nowrap border-r border-slate-100 last:border-0 max-w-[160px] truncate ${
                            selCols.has(h) ? 'text-slate-700' : 'text-slate-300 bg-slate-50'
                          }`}
                          title={String(row[h] ?? '')}
                        >
                          {String(row[h] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {sheet.filas.length > 6 && (
              <p className="text-xs text-slate-400 text-center mt-1.5">
                Vista previa de 6 / {sheet.filas.length} filas
              </p>
            )}
          </div>

          {/* Summary of selected cols */}
          {activeH.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activeH.map((h) => (
                <span key={h} className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-medium">
                  {renames[h] || h}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Import-as modal (APU / Basics) — kept from original ──────────────────────

const APU_FIELDS    = ['codigo','descripcion','unidad','cantidad','precioUnitario'];
const BASICS_FIELDS = ['codigo','descripcion','unidad','precioUnitario'];
const FIELD_LABELS  = { codigo:'Código', descripcion:'Descripción', unidad:'Unidad', cantidad:'Cantidad', precioUnitario:'Precio Unit.' };
const REQUIRED      = { codigo:true, descripcion:true, cantidad:true, precioUnitario:true };

function ImportAsModal({ sheet, type, projectId, onClose }) {
  const fields = type === 'apu' ? APU_FIELDS : BASICS_FIELDS;
  const [colMap, setColMap] = useState(() => {
    const m = {};
    fields.forEach((f) => { m[f] = autoDetect(sheet.headers, f); });
    return m;
  });
  const [loading, setLoading] = useState(false);

  const preview = useMemo(() =>
    sheet.filas.slice(0, 3).map((row) => {
      const out = {};
      fields.forEach((f) => { out[f] = colMap[f] ? String(row[colMap[f]] ?? '—') : '—'; });
      return out;
    }), [colMap]);

  const isValid = fields.filter((f) => REQUIRED[f]).every((f) => colMap[f]);

  const handleImport = async () => {
    setLoading(true);
    try {
      const endpoint = type === 'apu'
        ? `/budget/${projectId}/sheets/${sheet.id}/import-apu`
        : `/budget/${projectId}/sheets/${sheet.id}/import-basics`;
      const { data } = await api.post(endpoint, { colMap });
      alert(`${data.data.count} ítems importados correctamente.`);
      onClose();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al importar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-800">
            {type === 'apu' ? 'Importar como APU' : 'Importar como Precios Básicos'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <p className="text-xs text-slate-500">
            Hoja: <strong>{sheet.nombre}</strong> — {sheet.filas?.length} filas
          </p>
          <div className="space-y-2">
            {fields.map((f) => (
              <div key={f} className="flex items-center gap-3">
                <label className="w-32 text-xs font-medium text-slate-700 flex-shrink-0">
                  {FIELD_LABELS[f]}{REQUIRED[f] && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                <select
                  value={colMap[f]}
                  onChange={(e) => setColMap((p) => ({ ...p, [f]: e.target.value }))}
                  className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">— Sin mapear —</option>
                  {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Mini preview */}
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {fields.map((f) => <th key={f} className="px-2 py-1.5 text-left text-slate-600 font-medium">{FIELD_LABELS[f]}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.map((row, i) => (
                  <tr key={i}>
                    {fields.map((f) => (
                      <td key={f} className="px-2 py-1.5 text-slate-700 truncate max-w-[100px]">{row[f]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {type === 'apu' && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              Esto reemplazará todos los ítems APU actuales del proyecto.
            </div>
          )}
        </div>
        <div className="flex gap-2 px-6 py-4 border-t border-slate-200">
          <Button onClick={handleImport} loading={loading} disabled={!isValid}>
            Importar {sheet.filas?.length} filas
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
}

// ── Cross-reference modal — kept from original ────────────────────────────────

function CrossModal({ sheets, projectId, onClose }) {
  const [s1, setS1] = useState('');
  const [s2, setS2] = useState('');
  const [col1, setCol1] = useState('');
  const [col2, setCol2] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const sheet1 = sheets.find((s) => s.id === s1);
  const sheet2 = sheets.find((s) => s.id === s2);

  const handleCross = async () => {
    if (!s1 || !s2 || !col1 || !col2) return;
    setLoading(true);
    try {
      const { data } = await api.post(`/budget/${projectId}/cross`, {
        sheet1Id: s1, sheet2Id: s2, keyCol1: col1, keyCol2: col2,
      });
      setResult(data.data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-800">Cruce de información entre hojas</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {!result ? (
            <>
              <p className="text-xs text-slate-500">
                Selecciona dos hojas y la columna común para encontrar coincidencias y enriquecer los datos.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-700">Hoja base</label>
                  <select value={s1} onChange={(e) => { setS1(e.target.value); setCol1(''); }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                    <option value="">Seleccionar…</option>
                    {sheets.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                  {sheet1 && (
                    <select value={col1} onChange={(e) => setCol1(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                      <option value="">Columna clave…</option>
                      {(sheet1.headers || []).map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-700">Hoja a cruzar</label>
                  <select value={s2} onChange={(e) => { setS2(e.target.value); setCol2(''); }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                    <option value="">Seleccionar…</option>
                    {sheets.filter((s) => s.id !== s1).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                  {sheet2 && (
                    <select value={col2} onChange={(e) => setCol2(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                      <option value="">Columna clave…</option>
                      {(sheet2.headers || []).map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  )}
                </div>
              </div>
              <Button onClick={handleCross} loading={loading} disabled={!s1||!s2||!col1||!col2} className="w-full justify-center">
                Ejecutar cruce
              </Button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-slate-700">{result.hoja1} × {result.hoja2}</span>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                  {result.totalCruces} / {result.totalHoja1} coincidencias
                </span>
              </div>
              <div className="overflow-auto max-h-72 border border-slate-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 sticky top-0">
                    <tr>
                      {result.filas[0] && Object.keys(result.filas[0]).filter((k) => k !== '_cruce').map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left font-medium text-slate-600 whitespace-nowrap">{h}</th>
                      ))}
                      <th className="px-2 py-1.5 text-left font-medium text-slate-600 bg-blue-50">Cruce</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.filas.slice(0, 50).map((row, ri) => (
                      <tr key={ri} className={row._cruce ? 'bg-green-50' : ''}>
                        {Object.entries(row).filter(([k]) => k !== '_cruce').map(([k, v]) => (
                          <td key={k} className="px-2 py-1.5 text-slate-700 whitespace-nowrap max-w-[150px] truncate">{String(v ?? '')}</td>
                        ))}
                        <td className="px-2 py-1.5 bg-blue-50">
                          {row._cruce ? <span className="text-green-600 font-medium">✓</span> : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setResult(null)}>Nuevo cruce</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BudgetUpload() {
  const { id: projectId }  = useParams();
  const user               = useAuthStore((s) => s.user);
  const canEdit            = ['DIRECTOR', 'APOYO_DIRECTOR'].includes(user?.rol);
  const fileRef            = useRef();

  const [projectName, setProjectName]   = useState('');
  const [savedSheets, setSavedSheets]   = useState([]);
  const [loadingSheets, setLoading]     = useState(true);

  // Parsed Excel sheets (raw from client XLSX)
  const [rawSheets, setRawSheets]       = useState([]);   // from client xlsx parse
  const [configured, setConfigured]     = useState({});  // { [nombre]: { nombre, headers, filas, included } }
  const [parsing, setParsing]           = useState(false);
  const [saving, setSaving]             = useState(false);

  // Modals
  const [importModal, setImportModal]   = useState(null); // { sheet, type }
  const [crossSheets, setCrossSheets]   = useState(null); // null | full sheet array
  const [deleteId, setDeleteId]         = useState(null);
  const [deleting, setDeleting]         = useState(false);

  const loadSaved = useCallback(async () => {
    setLoading(true);
    try {
      const [projRes, sheetsRes] = await Promise.all([
        api.get(`/projects/${projectId}`),
        api.get(`/budget/${projectId}/sheets`),
      ]);
      setProjectName(projRes.data.data.nombre);
      setSavedSheets(sheetsRes.data.data || []);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  // ── Parse Excel client-side ────────────────────────────────────────────────
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setParsing(true);
    setRawSheets([]);
    setConfigured({});

    try {
      const buffer = await file.arrayBuffer();
      const wb     = XLSX.read(buffer, { cellDates: true });
      const sheets = wb.SheetNames.map((name, idx) => {
        const ws      = wb.Sheets[name];
        const filas   = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const headers = filas.length > 0 ? Object.keys(filas[0]) : [];
        return { nombre: name, orden: idx, headers, filas };
      }).filter((s) => s.filas.length > 0);

      setRawSheets(sheets);
    } catch (err) {
      alert('Error al leer el archivo: ' + err.message);
    } finally {
      setParsing(false);
    }
  };

  // Callback por hoja
  const handleSheetChange = useCallback((data) => {
    setConfigured((prev) => ({ ...prev, [data.nombre]: data }));
  }, []);

  // ── Save selected sheets ────────────────────────────────────────────────────
  const handleSave = async () => {
    const toSave = Object.values(configured).filter((s) => s.included);
    if (!toSave.length) return alert('Selecciona al menos una hoja');

    setSaving(true);
    try {
      await api.post(`/budget/${projectId}/sheets`, {
        sheets: toSave.map(({ included: _, ...rest }) => rest),
      });
      await loadSaved();
      setRawSheets([]);
      setConfigured({});
    } catch (err) {
      alert(err.response?.data?.message || 'Error al guardar las hojas');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async (sheetId) => {
    setDeleting(true);
    try {
      await api.delete(`/budget/${projectId}/sheets/${sheetId}`);
      await loadSaved();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al eliminar');
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  };

  // ── Open import modal (needs full filas from server) ──────────────────────
  const openImport = async (savedSheet, type) => {
    try {
      const { data } = await api.get(`/budget/${projectId}/sheets/${savedSheet.id}`);
      setImportModal({ sheet: data.data, type });
    } catch {
      alert('Error al cargar la hoja');
    }
  };

  // ── Open cross modal ───────────────────────────────────────────────────────
  const openCross = async () => {
    try {
      const full = await Promise.all(
        savedSheets.map((s) =>
          api.get(`/budget/${projectId}/sheets/${s.id}`).then((r) => r.data.data)
        )
      );
      setCrossSheets(full);
    } catch {
      alert('Error al cargar las hojas');
    }
  };

  const includedCount = Object.values(configured).filter((s) => s.included).length;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Presupuesto</h1>
          <p className="text-sm text-slate-500 mt-0.5">{projectName || '…'}</p>
        </div>
        <div className="flex items-center gap-2">
          {savedSheets.length >= 2 && (
            <Button variant="secondary" size="sm" onClick={openCross}>
              Cruzar hojas
            </Button>
          )}
          {canEdit && (
            <>
              <input
                type="file"
                accept=".xlsx,.xls"
                ref={fileRef}
                onChange={handleFileChange}
                className="hidden"
              />
              <Button loading={parsing} onClick={() => fileRef.current?.click()}>
                {parsing ? 'Leyendo Excel…' : '📤 Cargar Excel'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Info banner */}
      {rawSheets.length === 0 && savedSheets.length === 0 && !loadingSheets && (
        <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
          <span className="text-base">💡</span>
          <p>
            Sube el Excel del presupuesto. Por cada hoja puedes elegir qué columnas incluir y renombrarlas
            antes de guardar. Las hojas guardadas pueden importarse como APU o Precios Básicos.
          </p>
        </div>
      )}

      {/* ── Excel configurator ── */}
      {rawSheets.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-800">
                {rawSheets.length} hoja{rawSheets.length !== 1 ? 's' : ''} detectadas
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Activa las hojas que deseas guardar y elige qué columnas incluir. Puedes renombrarlas.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setRawSheets([]); setConfigured({}); }}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                loading={saving}
                disabled={includedCount === 0}
                onClick={handleSave}
              >
                Guardar {includedCount > 0 ? `${includedCount} hoja${includedCount !== 1 ? 's' : ''}` : ''}
              </Button>
            </div>
          </div>

          {/* One configurator per sheet */}
          {rawSheets.map((sheet) => (
            <SheetConfigurator
              key={sheet.nombre}
              sheet={sheet}
              onChange={handleSheetChange}
            />
          ))}

          {/* Sticky save bar */}
          <div className="sticky bottom-4 flex justify-end">
            <div className="bg-white border border-slate-200 shadow-lg rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-sm text-slate-600">
                {includedCount} hoja{includedCount !== 1 ? 's' : ''} seleccionada{includedCount !== 1 ? 's' : ''}
              </span>
              <Button loading={saving} disabled={includedCount === 0} onClick={handleSave}>
                Guardar y continuar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Saved sheets ── */}
      <Card title={`Hojas guardadas (${savedSheets.length})`}>
        {loadingSheets ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : savedSheets.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">📊</div>
            <p className="text-sm font-medium text-slate-600 mb-1">Sin hojas cargadas</p>
            <p className="text-xs text-slate-400">
              Sube un archivo Excel para gestionar el presupuesto del proyecto
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {savedSheets.map((sheet) => (
              <div
                key={sheet.id}
                className="flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xl flex-shrink-0">📋</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{sheet.nombre}</p>
                    <p className="text-xs text-slate-400">
                      Actualizada {new Date(sheet.updatedAt).toLocaleDateString('es-CO')}
                    </p>
                  </div>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => openImport(sheet, 'apu')}
                      title="Importar como APU"
                    >
                      📐 APU
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => openImport(sheet, 'basics')}
                      title="Importar como Precios Básicos"
                    >
                      💲 Básicos
                    </Button>
                    {deleteId === sheet.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-red-600">¿Eliminar?</span>
                        <Button size="sm" variant="danger" loading={deleting} onClick={() => handleDelete(sheet.id)}>Sí</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteId(null)}>No</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setDeleteId(sheet.id)}>🗑️</Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Modals */}
      {importModal && (
        <ImportAsModal
          sheet={importModal.sheet}
          type={importModal.type}
          projectId={projectId}
          onClose={() => setImportModal(null)}
        />
      )}
      {crossSheets && (
        <CrossModal
          sheets={crossSheets}
          projectId={projectId}
          onClose={() => setCrossSheets(null)}
        />
      )}
    </div>
  );
}
