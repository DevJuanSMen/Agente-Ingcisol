const Groq = require('groq-sdk');

let _client = null;

const getGroq = () => {
  if (!_client) {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY no configurada');
    _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _client;
};

// Modelos configurables por entorno: Groq depreca modelos con frecuencia y un
// modelo dado de baja rompe TODO el bot en silencio. Con esto se cambia el
// modelo desde las variables de Railway sin tocar código.
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_MODEL_FAST = process.env.GROQ_MODEL_FAST || 'llama-3.1-8b-instant';

module.exports = { getGroq, GROQ_MODEL, GROQ_MODEL_FAST };
