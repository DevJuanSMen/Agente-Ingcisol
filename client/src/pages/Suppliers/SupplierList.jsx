import { useEffect, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import Table from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const SEGMENTOS = ['MATERIALES', 'EQUIPOS', 'HERRAMIENTAS', 'SERVICIOS'];

const emptyForm = { nombre: '', nit: '', ciudad: '', segmento: 'MATERIALES', whatsapp: '', email: '' };

export default function SupplierList() {
  const user = useAuthStore((s) => s.user);
  const canEdit = ['DIRECTOR', 'APOYO_DIRECTOR'].includes(user?.rol);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
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

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      await api.post('/suppliers/import', { suppliers: rows });
      load();
      alert(`✅ Proveedores importados`);
    } catch (err) {
      alert('Error al importar');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const columns = [
    { key: 'nombre', label: 'Nombre' },
    { key: 'nit', label: 'NIT' },
    { key: 'ciudad', label: 'Ciudad' },
    { key: 'segmento', label: 'Segmento', render: (r) => (
      <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{r.segmento}</span>
    )},
    { key: 'homologado', label: 'Estado', render: (r) => (
      <Badge status={r.homologado ? 'HOMOLOGADO' : 'NO_HOMOLOGADO'} label={r.homologado ? 'HOMOLOGADO' : 'PENDIENTE'} />
    )},
    { key: 'email', label: 'Email' },
    { key: 'whatsapp', label: 'WhatsApp' },
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
            <Button variant="secondary" loading={importing} onClick={() => fileRef.current.click()}>
              📤 Importar Excel
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
    </div>
  );
}
