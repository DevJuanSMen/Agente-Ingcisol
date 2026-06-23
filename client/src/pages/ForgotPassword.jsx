import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import Button from '../components/ui/Button';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);          // 1 = pedir código, 2 = ingresar código
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const requestCode = async (e) => {
    e.preventDefault();
    setError(''); setInfo(''); setLoading(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      const r = data.data || {};
      if (r.sent) {
        setHint(r.hint || '');
        setStep(2);
      } else if (r.botUnavailable) {
        setError('El bot de WhatsApp no está conectado en tu empresa. Pídele al Director que restablezca tu contraseña.');
      } else {
        // Respuesta genérica: no revelamos si el correo existe o no tiene WhatsApp.
        setInfo('Si el correo está registrado y tiene un WhatsApp asociado, te enviamos un código. Revisa tu WhatsApp.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo procesar la solicitud');
    } finally {
      setLoading(false);
    }
  };

  const submitNewPassword = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres');
    if (password !== confirm) return setError('Las contraseñas no coinciden');
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { email, code, password });
      navigate('/login', { replace: true, state: { reset: true } });
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo cambiar la contraseña');
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
          <p className="text-slate-500 text-sm mt-2">Recuperar contraseña</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}
          {info && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
              {info}
            </div>
          )}

          {step === 1 ? (
            <form onSubmit={requestCode} className="space-y-4">
              <p className="text-sm text-slate-600">
                Ingresa tu correo. Te enviaremos un código de verificación a tu WhatsApp registrado.
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Correo electrónico</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="tu@empresa.com"
                  required
                />
              </div>
              <Button type="submit" loading={loading} className="w-full justify-center mt-2">
                Enviar código
              </Button>
            </form>
          ) : (
            <form onSubmit={submitNewPassword} className="space-y-4">
              <p className="text-sm text-slate-600">
                Enviamos un código a tu WhatsApp {hint && <span className="font-medium text-slate-800">{hint}</span>}.
                Ingrésalo y define tu nueva contraseña.
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Código de verificación</label>
                <input
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm tracking-[0.4em] text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="000000"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Nueva contraseña</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="••••••••"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirmar contraseña</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="••••••••"
                  required
                />
              </div>
              <Button type="submit" loading={loading} className="w-full justify-center mt-2">
                Cambiar contraseña
              </Button>
              <button
                type="button"
                onClick={() => { setStep(1); setCode(''); setError(''); }}
                className="w-full text-center text-xs text-slate-400 hover:text-slate-600"
              >
                ← Usar otro correo
              </button>
            </form>
          )}

          <p className="text-center text-sm text-slate-500 mt-5">
            <Link to="/login" className="text-primary font-medium hover:underline">
              Volver a iniciar sesión
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
