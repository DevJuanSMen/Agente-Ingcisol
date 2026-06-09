import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

// ─── Utilidades ───────────────────────────────────────────────────────────────

function SheetPreview({ sheet }) {
  if (!sheet) return null;
  const previewRows = sheet.filas.slice(0, 5);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-100">
            {sheet.headers.map((h) => (
              <th key={h} className="px-2 py-1.5 text-left text-slate-600 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {previewRows.map((row, ri) => (
            <tr key={ri} className="hover:bg-slate-50">
              {sheet.headers.map((h) => (
                <td key={h} className="px-2 py-1.5 text-slate-700 whitespace-nowrap max-w-[200px] truncate">
                  {String(row[h] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sheet.filas.length > 5 && (
        <p className="text-xs text-slate-400 mt-2 text-center">
          … y {sheet.filas.length - 5} filas más ({sheet.filas.length} total)
        </p>
      )}
    </div>
  );
}

function CrossModal({ sheets, onClose, onCross }) {
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
      const res = await onCross(s1, s2, col1, col2);
      setResult(res);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">🔗 Cruce de información</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {!result ? (
            <>
              <p className="text-xs text-slate-500">
                Selecciona dos hojas y la columna común para encontrar coincidencias y enriquecer los datos.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Hoja base</label>
                  <select
                    value={s1}
                    onChange={(e) => { setS1(e.target.value); setCol1(''); }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Seleccionar…</option>
                    {sheets.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                  {sheet1 && (
                    <select
                      value={col1}
                      onChange={(e) => setCol1(e.target.value)}
                      className="w-full mt-2 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Columna clave…</option>
                      {sheet1.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Hoja a cruzar</label>
                  <select
                    value={s2}
                    onChange={(e) => { setS2(e.target.value); setCol2(''); }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Seleccionar…</option>
                    {sheets.filter((s) => s.id !== s1).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                  {sheet2 && (
                    <select
                      value={col2}
                      onChange={(e) => setCol2(e.target.value)}
                      className="w-full mt-2 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Columna clave…</option>
                      {sheet2.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  )}
                </div>
              </div>
              <Button
                onClick={handleCross}
                loading={loading}
                disabled={!s1 || !s2 || !col1 || !col2}
                className="w-full justify-center"
              >
                Ejecutar cruce
              </Button>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-slate-700">
                  {result.hoja1} × {result.hoja2}
                </span>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                  {result.totalCruces} / {result.totalHoja1} coincidencias
                </span>
                <span className="text-xs text-slate-400">
                  Columna: {result.keyCol1} = {result.keyCol2}
                </span>
              </div>
              <div className="overflow-x-auto max-h-64">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 sticky top-0">
                    <tr>
                      {result.filas[0] && Object.keys(result.filas[0]).filter((k) => k !== '_cruce').map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left text-slate-600 font-medium whitespace-nowrap">{h}</th>
                      ))}
                      <th className="px-2 py-1.5 text-left text-slate-600 font-medium whitespace-nowrap bg-blue-50">Cruce</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.filas.slice(0, 50).map((row, ri) => (
                      <tr key={ri} className={row._cruce ? 'bg-green-50' : ''}>
                        {Object.entries(row).filter(([k]) => k !== '_cruce').map(([k, v]) => (
                          <td key={k} className="px-2 py-1.5 text-slate-700 whitespace-nowrap max-w-[150px] truncate">
                            {String(v ?? '')}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 bg-blue-50">
                          {row._cruce ? (
                            <span className="text-green-600 font-medium">✓ Coincide</span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button variant="secondary" onClick={() => setResult(null)} className="w-full justify-center">
                Nuevo cruce
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal de mapeo de columnas ───────────────────────────────────────────────

const APU_FIELDS = [
  { key: 'codigo', label: 'Código', required: true },
  { key: 'descripcion', label: 'Descripción', required: true },
  { key: 'unidad', label: 'Unidad', required: false },
  { key: 'cantidad', label: 'Cantidad', required: true },
  { key: 'precioUnitario', label: 'Precio Unitario', required: true },
];

const BASICS_FIELDS = [
  { key: 'codigo', label: 'Código', required: true },
  { key: 'descripcion', label: 'Descripción', required: true },
  { key: 'unidad', label: 'Unidad', required: false },
  { key: 'precioUnitario', label: 'Precio Unitario', required: true },
];

const HINTS = {
  codigo: ['codigo', 'code', 'item', 'cod', 'ref', 'ape'],
  descripcion: ['descripcion', 'descripción', 'nombre', 'description', 'detalle', 'actividad', 'concepto'],
  unidad: ['unidad', 'und', 'unit', 'u.m', 'um'],
  cantidad: ['cantidad', 'qty', 'quantity', 'cant', 'q'],
  precioUnitario: ['precio', 'valor', 'price', 'pu', 'vr unit', 'precio_unitario', 'p.u'],
};

function autoDetect(headers, fieldKey) {
  const hints = HINTS[fieldKey] || [];
  return headers.find((h) => hints.some((hint) => h.toLowerCase().includes(hint))) || '';
}

function ImportModal({ sheet, type, onClose, onImport }) {
  const fields = type === 'apu' ? APU_FIELDS : BASICS_FIELDS;
  const [colMap, setColMap] = useState(() => {
    const initial = {};
    fields.forEach((f) => { initial[f.key] = autoDetect(sheet.headers, f.key); });
    return initial;
  });
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState([]);

  useEffect(() => {
    const p = sheet.filas.slice(0, 3).map((row) => {
      const mapped = {};
      fields.forEach((f) => { mapped[f.label] = colMap[f.key] ? String(row[colMap[f.key]] ?? '') : '—'; });
      return mapped;
    });
    setPreview(p);
  }, [colMap]);

  const isValid = fields.filter((f) => f.required).every((f) => colMap[f.key]);

  const handleImport = async () => {
    setLoading(true);
    try {
      await onImport(colMap);
    } finally {
      setLoading(false);
    }
  };

  const title = type === 'apu' ? '📐 Importar como APU' : '💲 Importar como Precios Básicos';
  const warning = type === 'apu'
    ? 'Esto reemplazará todos los ítems APU actuales del proyecto.'
    : 'Esto actualizará o creará precios básicos de la empresa por código.';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <p className="text-xs text-slate-500">
            Hoja: <strong>{sheet.nombre}</strong> — {sheet.filas.length} filas, {sheet.headers.length} columnas
          </p>

          {/* Mapeo de columnas */}
          <div className="space-y-2.5">
            {fields.map((f) => (
              <div key={f.key} className="flex items-center gap-3">
                <label className="text-xs font-medium text-slate-700 w-32 flex-shrink-0">
                  {f.label}
                  {f.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                <select
                  value={colMap[f.key]}
                  onChange={(e) => setColMap((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">— Sin mapear —</option>
                  {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Preview */}
          {preview.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-600 mb-1.5">Vista previa (3 filas)</p>
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      {fields.map((f) => (
                        <th key={f.key} className="px-2 py-1.5 text-left text-slate-600 font-medium whitespace-nowrap">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.map((row, i) => (
                      <tr key={i}>
                        {fields.map((f) => (
                          <td key={f.key} className="px-2 py-1.5 text-slate-700 whitespace-nowrap max-w-[140px] truncate">
                            {row[f.label]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Warning */}
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <span className="text-base flex-shrink-0">⚠️</span>
            <p className="text-xs text-amber-800">{warning}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-5 border-t border-slate-200">
          <Button onClick={handleImport} loading={loading} disabled={!isValid}>
            Importar {sheet.filas.length} filas
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ──────────────────────────────────────────────────────────

export default function BudgetUpload() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canEdit = ['DIRECTOR', 'APOYO_DIRECTOR'].includes(user?.rol);
  const fileRef = useRef();

  const [projectName, setProjectName] = useState('');
  const [savedSheets, setSavedSheets] = useState([]);
  const [loadingSheets, setLoadingSheets] = useState(true);

  // Estado del flujo de carga de Excel
  const [parsedSheets, setParsedSheets] = useState([]); // hojas del Excel parseado
  const [selectedSheets, setSelectedSheets] = useState(new Set()); // índices seleccionados
  const [previewIndex, setPreviewIndex] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCross, setShowCross] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadSaved = useCallback(async () => {
    setLoadingSheets(true);
    try {
      const [projRes, sheetsRes] = await Promise.all([
        api.get(`/projects/${projectId}`),
        api.get(`/budget/${projectId}/sheets`),
      ]);
      setProjectName(projRes.data.data.nombre);
      setSavedSheets(sheetsRes.data.data || []);
    } catch {
      // silencioso
    } finally {
      setLoadingSheets(false);
    }
  }, [projectId]);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  // Parsear el archivo Excel cuando el usuario lo selecciona
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setParsing(true);
    setParsedSheets([]);
    setSelectedSheets(new Set());
    setPreviewIndex(null);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { cellDates: true });

      const sheets = wb.SheetNames.map((name, idx) => {
        const ws = wb.Sheets[name];
        const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const headers = raw.length > 0 ? Object.keys(raw[0]) : [];
        return { nombre: name, orden: idx, headers, filas: raw };
      });

      setParsedSheets(sheets);
      // Si solo hay una hoja, la seleccionamos automáticamente
      if (sheets.length === 1) {
        setSelectedSheets(new Set([0]));
        setPreviewIndex(0);
      } else {
        setPreviewIndex(0);
      }
    } catch (err) {
      alert('Error al leer el archivo Excel: ' + err.message);
    } finally {
      setParsing(false);
    }
  };

  const toggleSheet = (idx) => {
    setSelectedSheets((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const handleSave = async () => {
    if (selectedSheets.size === 0) return alert('Selecciona al menos una hoja');
    setSaving(true);
    try {
      const toSave = [...selectedSheets].map((idx) => parsedSheets[idx]);
      await api.post(`/budget/${projectId}/sheets`, { sheets: toSave });
      await loadSaved();
      setParsedSheets([]);
      setSelectedSheets(new Set());
      setPreviewIndex(null);
    } catch (err) {
      alert(err.response?.data?.message || 'Error al guardar las hojas');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (sheetId) => {
    setDeleting(true);
    try {
      await api.delete(`/budget/${projectId}/sheets/${sheetId}`);
      await loadSaved();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al eliminar la hoja');
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  };

  const handleCross = async (s1, s2, col1, col2) => {
    const { data } = await api.post(`/budget/${projectId}/cross`, {
      sheet1Id: s1, sheet2Id: s2, keyCol1: col1, keyCol2: col2,
    });
    return data.data;
  };

  const getSheetData = async (sheetId) => {
    const { data } = await api.get(`/budget/${projectId}/sheets/${sheetId}`);
    return data.data;
  };

  const [importModal, setImportModal] = useState(null); // { sheet, type: 'apu'|'basics' }

  const openImport = async (savedSheet, type) => {
    try {
      const full = await getSheetData(savedSheet.id);
      setImportModal({ sheet: full, type });
    } catch {
      alert('Error al cargar la hoja');
    }
  };

  const handleImport = async (colMap) => {
    const { sheet, type } = importModal;
    const endpoint = type === 'apu'
      ? `/budget/${projectId}/sheets/${sheet.id}/import-apu`
      : `/budget/${projectId}/sheets/${sheet.id}/import-basics`;
    try {
      const { data } = await api.post(endpoint, { colMap });
      alert(`✅ ${data.data.count} ítems importados correctamente.`);
      setImportModal(null);
    } catch (err) {
      alert(err.response?.data?.message || 'Error al importar');
    }
  };

  const [crossSheets, setCrossSheets] = useState([]);
  const openCross = async () => {
    try {
      const full = await Promise.all(savedSheets.map((s) => getSheetData(s.id)));
      setCrossSheets(full);
      setShowCross(true);
    } catch {
      alert('Error al cargar las hojas');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Presupuesto / Hojas Excel</h1>
          <p className="text-sm text-slate-500 mt-0.5 truncate">{projectName || '...'}</p>
        </div>
        <div className="flex items-center gap-2">
          {savedSheets.length >= 2 && (
            <Button variant="secondary" size="sm" onClick={openCross}>
              🔗 Cruzar hojas
            </Button>
          )}
          {canEdit && (
            <>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                ref={fileRef}
                onChange={handleFileChange}
                className="hidden"
              />
              <Button loading={parsing} onClick={() => fileRef.current?.click()}>
                📤 Cargar Excel
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Flujo de selección de hojas */}
      {parsedSheets.length > 0 && (
        <Card>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">
                  Hojas detectadas en el Excel
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {parsedSheets.length} hoja{parsedSheets.length !== 1 ? 's' : ''} encontrada{parsedSheets.length !== 1 ? 's' : ''}.
                  Selecciona las que deseas guardar.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedSheets(new Set(parsedSheets.map((_, i) => i)))}
                  className="text-xs text-primary hover:underline"
                >
                  Seleccionar todas
                </button>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={() => setSelectedSheets(new Set())}
                  className="text-xs text-slate-400 hover:underline"
                >
                  Ninguna
                </button>
              </div>
            </div>

            {/* Lista de hojas con checkbox */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {parsedSheets.map((sheet, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => { toggleSheet(idx); setPreviewIndex(idx); }}
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                    selectedSheets.has(idx)
                      ? 'border-primary bg-primary/5'
                      : 'border-slate-200 hover:border-slate-300'
                  } ${previewIndex === idx ? 'ring-2 ring-primary/30' : ''}`}
                >
                  <span className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    selectedSheets.has(idx) ? 'bg-primary border-primary' : 'border-slate-300'
                  }`}>
                    {selectedSheets.has(idx) && <span className="text-white text-xs">✓</span>}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{sheet.nombre}</p>
                    <p className="text-xs text-slate-400">
                      {sheet.filas.length} filas · {sheet.headers.length} columnas
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setPreviewIndex(idx); }}
                    className="ml-auto text-xs text-slate-400 hover:text-primary flex-shrink-0"
                  >
                    Vista
                  </button>
                </button>
              ))}
            </div>

            {/* Preview de la hoja seleccionada */}
            {previewIndex !== null && parsedSheets[previewIndex] && (
              <div>
                <p className="text-xs font-medium text-slate-600 mb-2">
                  Vista previa: <strong>{parsedSheets[previewIndex].nombre}</strong>
                </p>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <SheetPreview sheet={parsedSheets[previewIndex]} />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={handleSave}
                loading={saving}
                disabled={selectedSheets.size === 0}
              >
                Guardar {selectedSheets.size > 0 ? `${selectedSheets.size} hoja${selectedSheets.size !== 1 ? 's' : ''}` : ''}
              </Button>
              <Button
                variant="secondary"
                onClick={() => { setParsedSheets([]); setSelectedSheets(new Set()); }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Hojas guardadas */}
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
                className="flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg flex-shrink-0">📋</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{sheet.nombre}</p>
                    <p className="text-xs text-slate-400">
                      Hoja {sheet.orden + 1} · Guardada {new Date(sheet.updatedAt).toLocaleDateString('es-CO')}
                    </p>
                  </div>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => openImport(sheet, 'apu')} title="Importar como APU">
                      📐
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openImport(sheet, 'basics')} title="Importar como Precios Básicos">
                      💲
                    </Button>
                    {deleteId === sheet.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-600">¿Eliminar?</span>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={deleting}
                          onClick={() => handleDelete(sheet.id)}
                        >
                          Sí
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteId(null)}>No</Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteId(sheet.id)}
                      >
                        🗑️
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {showCross && (
        <CrossModal
          sheets={crossSheets}
          onClose={() => { setShowCross(false); setCrossSheets([]); }}
          onCross={handleCross}
        />
      )}

      {importModal && (
        <ImportModal
          sheet={importModal.sheet}
          type={importModal.type}
          onClose={() => setImportModal(null)}
          onImport={handleImport}
        />
      )}
    </div>
  );
}
