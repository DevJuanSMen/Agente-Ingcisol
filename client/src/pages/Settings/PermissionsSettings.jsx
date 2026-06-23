import { useEffect, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const ACCION_LABEL = { ver: 'Ver', crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar' };
const ROL_LABEL = {
  DIRECTOR: 'Director',
  APOYO_DIRECTOR: 'Apoyo Director',
  RESIDENTE: 'Residente',
  ALMACENISTA: 'Almacenista',
  CONTABILIDAD: 'Contabilidad',
};

export default function PermissionsSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [modulos, setModulos] = useState([]);
  const [roles, setRoles] = useState([]);
  const [acciones, setAcciones] = useState([]);
  const [matriz, setMatriz] = useState({});
  const [rolActivo, setRolActivo] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/permissions')
      .then((r) => {
        const d = r.data.data;
        setModulos(d.modulos || []);
        setRoles(d.roles || []);
        setAcciones(d.acciones || []);
        setMatriz(d.matriz || {});
        // Primer rol distinto de DIRECTOR (el director siempre tiene todo)
        setRolActivo((d.roles || []).find((x) => x !== 'DIRECTOR') || null);
      })
      .catch((err) => {
        setError(
          err.response?.status === 404
            ? 'El servidor aún no tiene el módulo de permisos. Falta desplegar los cambios del backend.'
            : err.response?.data?.message || err.message || 'No se pudieron cargar los permisos.'
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const toggle = (rol, modulo, accion) => {
    setMatriz((prev) => {
      const cur = prev[rol]?.[modulo]?.[accion] || false;
      const next = { ...prev[rol]?.[modulo], [accion]: !cur };
      // Si se quita "ver", se quitan también las demás acciones; si se marca otra, se asegura "ver"
      if (accion === 'ver' && cur) {
        next.crear = false; next.editar = false; next.eliminar = false;
      } else if (accion !== 'ver' && !cur) {
        next.ver = true;
      }
      return { ...prev, [rol]: { ...prev[rol], [modulo]: next } };
    });
  };

  const setAllForRole = (rol, value) => {
    setMatriz((prev) => {
      const updated = {};
      for (const m of modulos) {
        updated[m.key] = { ver: value, crear: value, editar: value, eliminar: value };
      }
      return { ...prev, [rol]: updated };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const entries = [];
      for (const rol of roles) {
        if (rol === 'DIRECTOR') continue;
        for (const m of modulos) {
          const p = matriz[rol]?.[m.key] || {};
          entries.push({
            rol, modulo: m.key,
            ver: !!p.ver, crear: !!p.crear, editar: !!p.editar, eliminar: !!p.eliminar,
          });
        }
      }
      const r = await api.put('/permissions', { entries });
      setMatriz(r.data.data.matriz);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      alert(err.response?.data?.message || 'Error al guardar permisos');
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Permisos por rol</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Define qué puede ver y hacer cada rol. El director siempre tiene acceso total.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600 font-medium">✓ Guardado</span>}
          <Button onClick={handleSave} loading={saving}>Guardar cambios</Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {!error && roles.length === 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          No se recibieron roles del servidor. Verifica que el backend esté actualizado.
        </div>
      )}

      {/* Pestañas de rol */}
      <div className="flex gap-1 flex-wrap border-b border-slate-200">
        {roles.filter((r) => r !== 'DIRECTOR').map((rol) => (
          <button
            key={rol}
            onClick={() => setRolActivo(rol)}
            className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors ${
              rolActivo === rol ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {ROL_LABEL[rol] || rol}
          </button>
        ))}
      </div>

      {rolActivo && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-slate-700">
              Permisos de <span className="text-primary">{ROL_LABEL[rolActivo] || rolActivo}</span>
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAllForRole(rolActivo, true)}>Marcar todo</Button>
              <Button size="sm" variant="ghost" onClick={() => setAllForRole(rolActivo, false)}>Quitar todo</Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-2 font-medium text-slate-600">Módulo</th>
                  {acciones.map((a) => (
                    <th key={a} className="text-center py-2 px-2 font-medium text-slate-600 w-24">{ACCION_LABEL[a] || a}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {modulos.map((m) => (
                  <tr key={m.key} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-2 text-slate-700">{m.label}</td>
                    {acciones.map((a) => (
                      <td key={a} className="text-center py-2 px-2">
                        <input
                          type="checkbox"
                          checked={!!matriz[rolActivo]?.[m.key]?.[a]}
                          onChange={() => toggle(rolActivo, m.key, a)}
                          className="w-4 h-4 accent-primary cursor-pointer"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Al marcar Crear/Editar/Eliminar se activa automáticamente Ver. Al quitar Ver se retiran las demás acciones.
          </p>
        </Card>
      )}
    </div>
  );
}
