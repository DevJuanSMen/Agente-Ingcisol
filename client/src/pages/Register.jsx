import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import Button from '../components/ui/Button';

const EMPTY = {
  razonSocial: '', nit: '', nombre: '', email: '', whatsapp: '', password: '', confirm: '',
};

export default function Register() {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const register = useAuthStore((s) => s.register);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const navigate = useNavigate();

  if (isAuthenticated) {
    navigate('/', { replace: true });
    return null;
  }

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) {
      return setError('La contraseña debe tener al menos 8 caracteres');
    }
    if (form.password !== form.confirm) {
      return setError('Las contraseñas no coinciden');
    }
    setLoading(true);
    try {
      const { confirm, ...payload } = form;
      await register(payload);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Error al crear la cuenta');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent';

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900">
            PROCURA <span className="text-primary">AI</span>
          </h1>
          <p className="text-slate-500 text-sm mt-2">Tu agente de compras 24/7</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Crear cuenta</h2>
          <p className="text-xs text-slate-400 mb-6">
            Registra tu empresa. Tu usuario quedará como Director (administrador total).
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Razón social de la empresa</label>
              <input value={form.razonSocial} onChange={set('razonSocial')} className={inputClass} placeholder="Constructora S.A.S." required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">NIT</label>
              <input value={form.nit} onChange={set('nit')} className={inputClass} placeholder="901234567-8" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Tu nombre completo</label>
              <input value={form.nombre} onChange={set('nombre')} className={inputClass} placeholder="Nombre del Director" required />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Email corporativo</label>
                <input type="email" value={form.email} onChange={set('email')} className={inputClass} placeholder="tu@empresa.com" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">WhatsApp</label>
                <input value={form.whatsapp} onChange={set('whatsapp')} className={inputClass} placeholder="573001234567" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Contraseña</label>
                <input type="password" value={form.password} onChange={set('password')} className={inputClass} placeholder="••••••••" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirmar contraseña</label>
                <input type="password" value={form.confirm} onChange={set('confirm')} className={inputClass} placeholder="••••••••" required />
              </div>
            </div>

            <Button type="submit" loading={loading} className="w-full justify-center mt-2">
              Crear cuenta
            </Button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-5">
            ¿Ya tienes cuenta?{' '}
            <Link to="/login" className="text-primary font-medium hover:underline">Inicia sesión</Link>
          </p>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          PROCURA AI — Solo para uso autorizado
        </p>
      </div>
    </div>
  );
}
