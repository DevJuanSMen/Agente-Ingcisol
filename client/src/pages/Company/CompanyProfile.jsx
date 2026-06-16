import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import SignaturePad from '../../components/ui/SignaturePad';

export default function CompanyProfile() {
  const user = useAuthStore((s) => s.user);
  const isDirector = user?.rol === 'DIRECTOR';

  const [company, setCompany] = useState(null);
  const [form, setForm] = useState({
    razonSocial: '', nit: '', representanteLegal: '', emailCorporativo: '',
    telefono: '', direccion: '', ciudad: '', banco: '', tipoCuenta: '', numeroCuenta: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingLogo, setSavingLogo] = useState(false);
  const [savingFirma, setSavingFirma] = useState(false);
  const [showSignaturePad, setShowSignaturePad] = useState(false);

  const logoRef = useRef();

  const load = () => {
    setLoading(true);
    api.get('/company')
      .then((r) => {
        setCompany(r.data.data);
        const d = r.data.data;
        setForm({
          razonSocial: d.razonSocial || '',
          nit: d.nit || '',
          representanteLegal: d.representanteLegal || '',
          emailCorporativo: d.emailCorporativo || '',
          telefono: d.telefono || '',
          direccion: d.direccion || '',
          ciudad: d.ciudad || '',
          banco: d.banco || '',
          tipoCuenta: d.tipoCuenta || '',
          numeroCuenta: d.numeroCuenta || '',
        });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await api.put('/company', form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      alert(err.response?.data?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('El logo debe pesar menos de 2 MB');
      return;
    }
    setSavingLogo(true);
    try {
      const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const r = await api.post('/company/logo', { dataUrl });
      setCompany((prev) => ({ ...prev, logoUrl: r.data.data.logoUrl }));
    } catch (err) {
      alert(err.response?.data?.message || 'Error al guardar el logo');
    } finally {
      setSavingLogo(false);
      e.target.value = '';
    }
  };

  const handleFirmaSave = async (dataUrl) => {
    setSavingFirma(true);
    setShowSignaturePad(false);
    try {
      const r = await api.post('/company/firma', { dataUrl });
      setCompany((prev) => ({ ...prev, firmaUrl: r.data.data.firmaUrl }));
    } catch (err) {
      alert(err.response?.data?.message || 'Error al guardar la firma');
    } finally {
      setSavingFirma(false);
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
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Perfil de Empresa</h1>
        <p className="text-sm text-slate-500 mt-0.5">Datos generales, logo y firma digital</p>
      </div>

      {/* Información básica */}
      <Card title="Información básica">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Razón social</label>
              <input
                type="text"
                value={form.razonSocial}
                onChange={(e) => setForm({ ...form, razonSocial: e.target.value })}
                disabled={!isDirector}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">NIT</label>
              <input
                type="text"
                value={form.nit}
                onChange={(e) => setForm({ ...form, nit: e.target.value })}
                disabled={!isDirector}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Representante legal</label>
              <input
                type="text"
                value={form.representanteLegal}
                onChange={(e) => setForm({ ...form, representanteLegal: e.target.value })}
                disabled={!isDirector}
                placeholder="Nombre completo"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email corporativo</label>
              <input
                type="email"
                value={form.emailCorporativo}
                onChange={(e) => setForm({ ...form, emailCorporativo: e.target.value })}
                disabled={!isDirector}
                placeholder="contacto@empresa.com"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Teléfono</label>
              <input
                type="text"
                value={form.telefono}
                onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                disabled={!isDirector}
                placeholder="6055XXXXXX"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Ciudad</label>
              <input
                type="text"
                value={form.ciudad}
                onChange={(e) => setForm({ ...form, ciudad: e.target.value })}
                disabled={!isDirector}
                placeholder="Valledupar"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Dirección</label>
              <input
                type="text"
                value={form.direccion}
                onChange={(e) => setForm({ ...form, direccion: e.target.value })}
                disabled={!isDirector}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <p className="text-sm font-semibold text-slate-700 mb-1">Datos bancarios</p>
            <p className="text-xs text-slate-400 mb-3">Se incluirán en las órdenes de compra para pagos y facturación.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Banco</label>
                <input
                  type="text"
                  value={form.banco}
                  onChange={(e) => setForm({ ...form, banco: e.target.value })}
                  disabled={!isDirector}
                  placeholder="Bancolombia"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Tipo de cuenta</label>
                <select
                  value={form.tipoCuenta}
                  onChange={(e) => setForm({ ...form, tipoCuenta: e.target.value })}
                  disabled={!isDirector}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-50 disabled:text-slate-500"
                >
                  <option value="">Seleccionar…</option>
                  <option value="AHORROS">Ahorros</option>
                  <option value="CORRIENTE">Corriente</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Número de cuenta</label>
                <input
                  type="text"
                  value={form.numeroCuenta}
                  onChange={(e) => setForm({ ...form, numeroCuenta: e.target.value })}
                  disabled={!isDirector}
                  placeholder="000-000000-00"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>
            </div>
          </div>

          {isDirector && (
            <div className="flex items-center gap-3">
              <Button type="submit" loading={saving}>Guardar cambios</Button>
              {saved && <span className="text-sm text-green-600 font-medium">✓ Guardado</span>}
            </div>
          )}
        </form>
      </Card>

      {/* Logo */}
      <Card title="Logo corporativo">
        <div className="flex items-start gap-5">
          <div className="flex-shrink-0">
            {company?.logoUrl ? (
              <img
                src={company.logoUrl}
                alt="Logo"
                className="w-24 h-24 object-contain border border-slate-200 rounded-xl bg-white p-1"
              />
            ) : (
              <div className="w-24 h-24 border-2 border-dashed border-slate-300 rounded-xl flex items-center justify-center">
                <span className="text-3xl">🏢</span>
              </div>
            )}
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-sm text-slate-600">
              {company?.logoUrl ? 'Logo cargado correctamente.' : 'Sin logo. Sube una imagen PNG o JPG (máx 2 MB).'}
            </p>
            <p className="text-xs text-slate-400">Aparecerá en las órdenes de compra y documentos generados.</p>
            {isDirector && (
              <>
                <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoChange} />
                <Button size="sm" variant="secondary" loading={savingLogo} onClick={() => logoRef.current.click()}>
                  {company?.logoUrl ? 'Cambiar logo' : 'Subir logo'}
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Firma digital */}
      <Card title="Firma digital">
        <div className="flex items-start gap-5">
          <div className="flex-shrink-0">
            {company?.firmaUrl ? (
              <img
                src={company.firmaUrl}
                alt="Firma"
                className="w-40 h-20 object-contain border border-slate-200 rounded-xl bg-white p-2"
              />
            ) : (
              <div className="w-40 h-20 border-2 border-dashed border-slate-300 rounded-xl flex items-center justify-center">
                <span className="text-2xl">✍️</span>
              </div>
            )}
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-sm text-slate-600">
              {company?.firmaUrl ? 'Firma registrada.' : 'Sin firma. Dibuja tu firma para usarla en las órdenes de compra.'}
            </p>
            <p className="text-xs text-slate-400">Se incrustará automáticamente en los PDF de OC generados.</p>
            {isDirector && (
              <Button size="sm" variant="secondary" loading={savingFirma} onClick={() => setShowSignaturePad(true)}>
                {company?.firmaUrl ? 'Actualizar firma' : 'Crear firma'}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {showSignaturePad && (
        <SignaturePad
          existing={!!company?.firmaUrl}
          onSave={handleFirmaSave}
          onCancel={() => setShowSignaturePad(false)}
        />
      )}
    </div>
  );
}
