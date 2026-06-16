import { useEffect, useState, useRef } from 'react';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { useProjectStore } from '../../store/projectStore';
import Table from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const SEGMENTOS = ['MATERIALES', 'EQUIPOS', 'HERRAMIENTAS', 'SERVICIOS'];

const emptyForm = { nombre: '', nit: '', ciudad: '', segmento: 'MATERIALES', whatsapp: '', email: '' };

const IMPORT_FIELDS = [
  { key: 'nombre', label: 'Nombre', required: true },
  { key: 'nit', label: 'NIT', required: false },
  { key: 'ciudad', label: 'Ciudad', required: false },
  { key: 'whatsapp', label: 'WhatsApp', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'segmento', label: 'Segmento', required: false },
];

// Modal de confirmación del mapeo detectado por IA
function ImportPreviewModal({ analysis, activeProject, onClose, onConfirm }) {
  const [colMap, setColMap] = useState(() => {
    const initial = {};
    IMPORT_FIELDS.forEach((f) => { initial[f.key] = analysis.columnas?.[f.key] || ''; });
    return initial;
  });
  const [linkProject, setLinkProject] = useState(false);
  const [loading, setLoading] = useState(false);

  const isValid = Boolean(colMap.nombre);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm(colMap, linkProject ? activeProject?.id : null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">🤖 Importar proveedores</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <p className="text-xs text-slate-500">
            Hoja: <strong>{analysis.hoja}</strong> — {analysis.totalFilas} filas detectadas
          </p>

          {analysis.razon && (
            <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <span className="text-base flex-shrink-0">🤖</span>
              <p className="text-xs text-blue-800">{analysis.razon}</p>
            </div>
          )}

          {/* Mapeo de columnas (editable) */}
          <div className="space-y-2.5">
            <p className="text-xs font-medium text-slate-600">
              Mapeo detectado por IA — verifica y ajusta si es necesario
            </p>
            {IMPORT_FIELDS.map((f) => (
              <div key={f.key} className="flex items-center gap-3">
                <label className="text-xs font-medium text-slate-700 w-28 flex-shrink-0">
                  {f.label}
                  {f.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                <select
                  value={colMap[f.key]}
                  onChange={(e) => setColMap((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">— Sin mapear —</option>
                  {analysis.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Vista previa con el mapeo aplicado */}
          <div>
            <p className="text-xs font-medium text-slate-600 mb-1.5">Vista previa</p>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    {IMPORT_FIELDS.map((f) => (
                      <th key={f.key} className="px-2 py-1.5 text-left text-slate-600 font-medium whitespace-nowrap">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analysis.preview.map((row, i) => (
                    <tr key={i}>
                      {IMPORT_FIELDS.map((f) => (
                        <td key={f.key} className="px-2 py-1.5 text-slate-700 whitespace-nowrap max-w-[140px] truncate">
                          {colMap[f.key] ? String(row[colMap[f.key]] ?? '') : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Asociar al proyecto activo */}
          {activeProject && (
            <label className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={linkProject}
                onChange={(e) => setLinkProject(e.target.checked)}
                className="w-4 h-4 accent-[#1B6FF5]"
              />
              <span className="text-xs text-slate-700">
                Asociar al proyecto activo: <strong>{activeProject.nombre}</strong>
                <span className="block text-slate-400 mt-0.5">
                  Si no se marca, los proveedores quedan disponibles para toda la empresa.
                </span>
              </span>
            </label>
          )}
        </div>
        <div className="flex items-center gap-3 p-5 border-t border-slate-200">
          <Button onClick={handleConfirm} loading={loading} disabled={!isValid}>
            Importar {analysis.totalFilas} proveedores
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
}

export default function SupplierList() {
  const user = useAuthStore((s) => s.user);
  const activeProject = useProjectStore((s) => s.activeProject);
  const canEdit = ['DIRECTOR', 'APOYO_DIRECTOR'].includes(user?.rol);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef();

  const load = () => {
    setLoading(true);
    api.get('/suppliers')
      .then((r) => setData(r.data.data || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/suppliers', form);
      setShowForm(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  // Paso 1: subir el Excel para análisis con IA (formato libre)
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setAnalyzing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const r = await api.post('/suppliers/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAnalysis(r.data.data);
    } catch (err) {
      alert(err.response?.data?.message || 'Error al analizar el archivo');
    } finally {
      setAnalyzing(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (id) => {
    setDeleting(true);
    try {
      await api.delete(`/suppliers/${id}`);
      setDeleteId(null);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al eliminar el proveedor');
    } finally {
      setDeleting(false);
    }
  };

  // Paso 2: confirmar el mapeo e importar
  const handleConfirmImport = async (columnas, projectId) => {
    try {
      const r = await api.post('/suppliers/confirm', {
        sessionKey: analysis.sessionKey,
        columnas,
        projectId,
      });
      setAnalysis(null);
      load();
      alert(`✅ ${r.data.data.message}`);
    } catch (err) {
      alert(err.response?.data?.message || 'Error al importar');
    }
  };

  const columns = [
    { key: 'nombre', label: 'Nombre' },
    { key: 'nit', label: 'NIT' },
    { key: 'ciudad', label: 'Ciudad' },
    { key: 'segmento', label: 'Segmento', render: (r) => (
      <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{r.segmento}</span>
    )},
    { key: 'proyecto', label: 'Proyecto', render: (r) => (
      r.project
        ? <span className="text-xs text-slate-600">{r.project.nombre}</span>
        : <span className="text-xs text-slate-400">Toda la empresa</span>
    )},
    { key: 'homologado', label: 'Estado', render: (r) => (
      <Badge status={r.homologado ? 'HOMOLOGADO' : 'NO_HOMOLOGADO'} label={r.homologado ? 'HOMOLOGADO' : 'PENDIENTE'} />
    )},
    { key: 'email', label: 'Email' },
    { key: 'whatsapp', label: 'WhatsApp' },
    ...(canEdit ? [{
      key: 'acciones',
      label: '',
      render: (r) => deleteId === r.id ? (
        <div className="flex items-center gap-1.5 justify-end">
          <span className="text-xs text-red-600 whitespace-nowrap">¿Eliminar?</span>
          <Button size="sm" variant="danger" loading={deleting} onClick={() => handleDelete(r.id)}>Sí</Button>
          <Button size="sm" variant="ghost" onClick={() => setDeleteId(null)}>No</Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setDeleteId(r.id)}>🗑️</Button>
        </div>
      ),
    }] : []),
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Proveedores</h1>
          <p className="text-sm text-slate-500 mt-0.5">{data.length} registros</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <input type="file" accept=".xlsx,.xls" ref={fileRef} onChange={handleFileChange} className="hidden" />
            <Button variant="secondary" loading={analyzing} onClick={() => fileRef.current.click()}>
              🤖 Importar Excel con IA
            </Button>
            <Button onClick={() => setShowForm(!showForm)}>
              + Nuevo proveedor
            </Button>
          </div>
        )}
      </div>

      {showForm && (
        <Card title="Nuevo proveedor">
          <form onSubmit={handleSubmit} className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { field: 'nombre', label: 'Nombre *', required: true },
              { field: 'nit', label: 'NIT' },
              { field: 'ciudad', label: 'Ciudad' },
              { field: 'whatsapp', label: 'WhatsApp' },
              { field: 'email', label: 'Email', type: 'email' },
            ].map(({ field, label, required, type = 'text' }) => (
              <div key={field}>
                <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
                <input
                  type={type}
                  required={required}
                  value={form[field]}
                  onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Segmento *</label>
              <select
                value={form.segmento}
                onChange={(e) => setForm({ ...form, segmento: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {SEGMENTOS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-full flex gap-3 justify-end">
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" loading={saving}>Guardar proveedor</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <Table columns={columns} data={data} loading={loading} emptyMessage="Sin proveedores" />
      </Card>

      {analysis && (
        <ImportPreviewModal
          analysis={analysis}
          activeProject={activeProject}
          onClose={() => setAnalysis(null)}
          onConfirm={handleConfirmImport}
        />
      )}
    </div>
  );
}
