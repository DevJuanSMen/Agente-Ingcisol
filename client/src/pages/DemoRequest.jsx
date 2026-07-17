import { useState } from 'react';
import api from '../api/client';
import Button from '../components/ui/Button';

export default function DemoRequest() {
  const [form, setForm] = useState({ nombre: '', email: '', telefono: '', website: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/demo-requests', form);
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo enviar la solicitud. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900">
            PROCURA <span className="text-primary">AI</span>
          </h1>
          <p className="text-slate-500 text-sm mt-2">Tu agente de compras 24/7</p>
          <p className="text-xs font-semibold text-slate-400 tracking-widest uppercase mt-3">
            INGCISOL Ingeniería y Construcción
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          {sent ? (
            <div className="text-center py-4">
              <div className="text-3xl mb-3">✅</div>
              <h2 className="text-lg font-semibold text-slate-800 mb-2">¡Gracias!</h2>
              <p className="text-sm text-slate-500">
                Recibimos tu solicitud. Nuestro equipo se pondrá en contacto contigo muy pronto para agendar tu demo.
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">Solicita una demo</h2>
              <p className="text-sm text-slate-500 mb-6">
                Cuéntanos cómo contactarte y te mostramos cómo PROCURA AI automatiza las compras de tu obra.
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Nombre</label>
                  <input
                    type="text"
                    value={form.nombre}
                    onChange={handleChange('nombre')}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    placeholder="Tu nombre"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Correo electrónico</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={handleChange('email')}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    placeholder="tu@empresa.com"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Teléfono de contacto</label>
                  <input
                    type="tel"
                    value={form.telefono}
                    onChange={handleChange('telefono')}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    placeholder="300 000 0000"
                    required
                  />
                </div>

                {/* Honeypot: campo invisible para usuarios reales, los bots suelen llenarlo */}
                <input
                  type="text"
                  value={form.website}
                  onChange={handleChange('website')}
                  className="hidden"
                  tabIndex={-1}
                  autoComplete="off"
                />

                <Button type="submit" loading={loading} className="w-full justify-center mt-2">
                  Solicitar demo
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          PROCURA AI — Solo para uso autorizado
        </p>
      </div>
    </div>
  );
}
