import { useEffect, useState, useRef } from 'react';
import api from '../../api/client';
import { useCan } from '../../store/authStore';
import { useProjectStore } from '../../store/projectStore';
import Table from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const SEGMENTOS = ['MATERIALES', 'EQUIPOS', 'HERRAMIENTAS', 'SERVICIOS'];

const emptyForm = { nombre: '', nit: '', ciudad: '', segmento: 'MATERIALES', whatsapp: '', email: '' };

// Ventana editable con TODAS las filas del Excel (estilo importación de presupuesto).
// El director ve la tabla completa, ajusta lo que necesite y la importa tal cual.
function SupplierImportModal({ analysis, activeProject, onClose, onConfirm }) {
  const [rows, setRows] = useState(() => analysis.rows || []);
  const [linkProject, setLinkProject] = useState(false);
  const [loading, setLoading] = useState(false);

  const update = (i, field, value) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  const remove = (i) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const validRows = rows.filter((r) => String(r.nombre || '').trim());

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm(validRows, linkProject ? activeProject?.id : null);
    } finally {
      setLoading(false);
    }
  };

  const cell = 'w-full px-1.5 py-1 bg-transparent border border-transparent focus:border-primary focus:bg-white rounded focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-auto py-6 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-800">Revisar e importar proveedores</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Hoja <strong>{analysis.hoja}</strong> · {rows.length} filas detectadas — edita lo que necesites antes de importar
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {analysis.razon && (
          <div className="mx-6 mt-4 flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <span className="text-base flex-shrink-0">🤖</span>
            <p className="text-xs text-blue-800">{analysis.razon}</p>
          </div>
        )}

        <div className="px-4 py-3">
          <div className="overflow-auto max-h-[52vh] border border-slate-200 rounded-lg">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-ink-800 text-white">
                  <th className="px-2 py-2 text-left">Nombre</th>
                  <th className="px-2 py-2 text-left w-32">NIT</th>
                  <th className="px-2 py-2 text-left w-32">Ciudad</th>
                  <th className="px-2 py-2 text-left w-36">WhatsApp</th>
                  <th className="px-2 py-2 text-left w-44">Email</th>
                  <th className="px-2 py-2 text-left w-36">Segmento</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-orange-50/30">
                    <td className="px-1 py-1">
                      <input value={r.nombre || ''} onChange={(e) => update(i, 'nombre', e.target.value)} className={cell} />
                    </td>
                    <td className="px-1 py-1">
                      <input value={r.nit || ''} onChange={(e) => update(i, 'nit', e.target.value)} className={cell} />
                    </td>
                    <td className="px-1 py-1">
                      <input value={r.ciudad || ''} onChange={(e) => update(i, 'ciudad', e.target.value)} className={cell} />
                    </td>
                    <td className="px-1 py-1">
                      <input value={r.whatsapp || ''} onChange={(e) => update(i, 'whatsapp', e.target.value)} className={cell} />
                    </td>
                    <td className="px-1 py-1">
                      <input value={r.email || ''} onChange={(e) => update(i, 'email', e.target.value)} className={cell} />
                    </td>
                    <td className="px-1 py-1">
                      <select value={r.segmento || 'MATERIALES'} onChange={(e) => update(i, 'segmento', e.target.value)}
                        className="w-full px-1.5 py-1 bg-transparent border border-transparent focus:border-primary focus:bg-white rounded focus:outline-none">
                        {SEGMENTOS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button onClick={() => remove(i)} className="text-slate-300 hover:text-red-400">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {activeProject && (
            <label className="flex items-center gap-2.5 mt-3 p-3 bg-slate-50 rounded-lg cursor-pointer">
              <input type="checkbox" checked={linkProject} onChange={(e) => setLinkProject(e.target.checked)}
                className="w-4 h-4 accent-primary" />
              <span className="text-xs text-slate-700">
                Asociar al proyecto activo: <strong>{activeProject.nombre}</strong>
                <span className="block text-slate-400 mt-0.5">
                  Si no se marca, los proveedores quedan disponibles para toda la empresa.
                </span>
              </span>
            </label>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <span className="text-sm text-slate-600"><strong>{validRows.length}</strong> proveedores a importar</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleConfirm} loading={loading} disabled={validRows.length === 0}>
              Importar {validRows.length} proveedores
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// `embedded`: dentro del wizard de onboarding (sin título propio).
// `onChanged`: avisa al contenedor cuando cambia el directorio de proveedores.
export default function SupplierList({ embedded = false, onChanged }) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const canCreate = useCan('suppliers', 'crear');
  const canDelete = useCan('suppliers', 'eliminar');
  const canEdit = canCreate; // mismos botones de alta/importación
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
      onChanged?.();
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

  // Paso 2: importar las filas (editadas) tal cual las dejó el director
  const handleConfirmImport = async (suppliers, projectId) => {
    try {
      const r = await api.post('/suppliers/import', { suppliers, projectId });
      setAnalysis(null);
      load();
      onChanged?.();
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
    ...(canDelete ? [{
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
          {!embedded && <h1 className="text-xl font-bold text-slate-800">Proveedores</h1>}
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
        <SupplierImportModal
          analysis={analysis}
          activeProject={activeProject}
          onClose={() => setAnalysis(null)}
          onConfirm={handleConfirmImport}
        />
      )}
    </div>
  );
}
