import { useEffect, useState } from 'react';
import api from '../../api/client';
import Table from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const ROLES = ['DIRECTOR', 'APOYO_DIRECTOR', 'RESIDENTE', 'ALMACENISTA', 'CONTABILIDAD'];
const emptyForm = { nombre: '', email: '', password: '', whatsapp: '', rol: 'RESIDENTE', topeAprobacion: 0 };

const fmtCOP = (v) => v ? `$${Number(v).toLocaleString('es-CO')}` : '—';

export default function UsersSettings() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/users')
      .then((r) => setUsers(r.data.data || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditUser(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (u) => {
    setEditUser(u);
    setForm({ nombre: u.nombre, email: u.email, password: '', whatsapp: u.whatsapp || '', rol: u.rol, topeAprobacion: u.topeAprobacion || 0 });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editUser) {
        await api.put(`/users/${editUser.id}`, form);
      } else {
        await api.post('/users', form);
      }
      setShowForm(false);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id) => {
    if (!window.confirm('¿Desactivar este usuario?')) return;
    try {
      await api.delete(`/users/${id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const columns = [
    { key: 'nombre', label: 'Nombre' },
    { key: 'email', label: 'Email' },
    { key: 'rol', label: 'Rol', render: (r) => (
      <span className="text-xs font-medium text-slate-600">{r.rol.replace('_', ' ')}</span>
    )},
    { key: 'topeAprobacion', label: 'Tope Aprobación', render: (r) => (
      r.rol === 'APOYO_DIRECTOR' ? fmtCOP(r.topeAprobacion) : '—'
    )},
    { key: 'activo', label: 'Estado', render: (r) => (
      <Badge status={r.activo ? 'APROBADA' : 'RECHAZADA'} label={r.activo ? 'ACTIVO' : 'INACTIVO'} />
    )},
    { key: 'actions', label: 'Acciones', render: (r) => (
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Editar</Button>
        {r.activo && (
          <Button size="sm" variant="danger" onClick={() => handleDeactivate(r.id)}>Desactivar</Button>
        )}
      </div>
    )},
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Gestión de Usuarios</h1>
          <p className="text-sm text-slate-500 mt-0.5">{users.length} usuarios</p>
        </div>
        <Button onClick={openCreate}>+ Nuevo usuario</Button>
      </div>

      {showForm && (
        <Card title={editUser ? 'Editar usuario' : 'Nuevo usuario'}>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nombre completo *</label>
              <input
                required
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
              <input
                type="email"
                required
                disabled={!!editUser}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-50"
              />
            </div>

            {!editUser && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Contraseña *</label>
                <input
                  type="password"
                  required
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">WhatsApp</label>
              <input
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                placeholder="573xxxxxxxxx"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Rol *</label>
              <select
                value={form.rol}
                onChange={(e) => setForm({ ...form, rol: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
              </select>
            </div>

            {form.rol === 'APOYO_DIRECTOR' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tope de aprobación (COP)</label>
                <input
                  type="number"
                  min="0"
                  value={form.topeAprobacion}
                  onChange={(e) => setForm({ ...form, topeAprobacion: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            )}

            <div className="col-span-full flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" loading={saving}>
                {editUser ? 'Guardar cambios' : 'Crear usuario'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <Table columns={columns} data={users} loading={loading} emptyMessage="Sin usuarios" />
      </Card>
    </div>
  );
}
