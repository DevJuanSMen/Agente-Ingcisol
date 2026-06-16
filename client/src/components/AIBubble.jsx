import { useEffect, useRef, useState } from 'react';
import api from '../api/client';

const WELCOME = {
  role: 'assistant',
  content: '¡Hola! Soy tu agente de compras 24/7. Pregúntame por el presupuesto, requisiciones pendientes, órdenes de compra o el estado de tu proyecto.',
};

export default function AIBubble() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading, open]);

  const send = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      // El mensaje de bienvenida no se envía al modelo
      const history = next.filter((m) => m !== WELCOME);
      const r = await api.post('/assistant/chat', { messages: history });
      setMessages((prev) => [...prev, { role: 'assistant', content: r.data.data.reply }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: err.response?.data?.message || 'No pude procesar tu pregunta. Intenta de nuevo.',
        error: true,
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 left-4 lg:left-64 z-40">
      {/* Panel de chat */}
      {open && (
        <div className="absolute bottom-16 left-0 w-[330px] sm:w-[360px] bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-base">🤖</span>
              <div>
                <p className="text-sm font-semibold leading-tight">Agente PROCURA AI</p>
                <p className="text-[10px] text-slate-400 leading-tight">Tu agente de compras 24/7</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white text-lg leading-none">×</button>
          </div>

          <div ref={scrollRef} className="h-80 overflow-y-auto p-3 space-y-2.5 bg-slate-50">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-primary text-white rounded-br-sm'
                    : m.error
                      ? 'bg-red-50 text-red-700 border border-red-200 rounded-bl-sm'
                      : 'bg-white text-slate-700 border border-slate-200 rounded-bl-sm'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-3 py-2.5 flex gap-1">
                  <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" />
                  <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.15s]" />
                  <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.3s]" />
                </div>
              </div>
            )}
          </div>

          <form onSubmit={send} className="flex items-center gap-2 p-3 border-t border-slate-100 bg-white">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pregunta sobre tus compras…"
              className="flex-1 px-3 py-2 border border-slate-300 rounded-full text-xs focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition-colors flex-shrink-0"
              aria-label="Enviar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>
        </div>
      )}

      {/* Burbuja */}
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-13 h-13 p-3.5 rounded-full bg-primary text-white shadow-lg hover:scale-105 hover:shadow-xl transition-all flex items-center justify-center"
        aria-label="Abrir asistente IA"
        title="Agente PROCURA AI"
      >
        {open ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <span className="text-2xl leading-none">🤖</span>
        )}
      </button>
    </div>
  );
}
