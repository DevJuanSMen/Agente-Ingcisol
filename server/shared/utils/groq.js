const Groq = require('groq-sdk');

let _client = null;

const getGroq = () => {
  if (!_client) {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY no configurada');
    _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _client;
};

module.exports = { getGroq };
