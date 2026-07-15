const Groq = require('groq-sdk');

// La API key puede venir del entorno (Railway) o de Redis, guardada desde el
// panel superadmin. La de Redis tiene prioridad: permite rotar una key revocada
// sin acceso a Railway y sin tocar el código (NUNCA hardcodear la key: este repo
// vive en GitHub y el escáner de secretos la reporta a Groq, que la revoca).
const REDIS_KEY = 'groq:api_key';

let _client = null;
let _key = process.env.GROQ_API_KEY || null;

const setGroqKey = (key) => {
  _key = String(key || '').trim() || null;
  _client = null; // el próximo getGroq crea el cliente con la key nueva
};

const hasGroqKey = () => !!_key;

const getGroq = () => {
  if (!_client) {
    if (!_key) throw new Error('GROQ_API_KEY no configurada');
    _client = new Groq({ apiKey: _key });
  }
  return _client;
};

// Carga la key guardada en Redis (si existe) sobre la del entorno. Se llama al
// arrancar api/worker y cuando el panel guarda una key nueva (IPC reload).
const initGroqKeyFromRedis = async (redis) => {
  const stored = await redis.get(REDIS_KEY);
  if (stored) {
    setGroqKey(stored);
    return true;
  }
  return false;
};

// Valida una key contra la API real de Groq antes de guardarla.
const testGroqKey = async (key) => {
  const probe = new Groq({ apiKey: String(key || '').trim() });
  await probe.models.list(); // 401 si la key es inválida/revocada
};

// Modelos configurables por entorno: Groq depreca modelos con frecuencia y un
// modelo dado de baja rompe TODO el bot en silencio. Con esto se cambia el
// modelo desde las variables de Railway sin tocar código.
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_MODEL_FAST = process.env.GROQ_MODEL_FAST || 'llama-3.1-8b-instant';

module.exports = {
  getGroq,
  setGroqKey,
  hasGroqKey,
  initGroqKeyFromRedis,
  testGroqKey,
  GROQ_REDIS_KEY: REDIS_KEY,
  GROQ_MODEL,
  GROQ_MODEL_FAST,
};
