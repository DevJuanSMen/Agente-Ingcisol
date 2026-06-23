// Normalización de números para WhatsApp.
// El código de país por defecto es configurable vía DEFAULT_COUNTRY_CODE (Colombia = 57).
// La idea: el usuario puede escribir el número CON o SIN el indicativo; igual queda bien.

const DEFAULT_CC = (process.env.DEFAULT_COUNTRY_CODE || '57').replace(/\D/g, '');

// Devuelve el número en formato internacional sin símbolos: p.ej. "573001234567".
// - Si ya trae el indicativo, lo respeta.
// - Si es un número nacional (10 dígitos en Colombia), antepone el indicativo.
// - Si trae "00" internacional, lo descarta.
function normalizeWhatsapp(raw, cc = DEFAULT_CC) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';

  // Prefijo de marcado internacional "00" → quitarlo
  if (d.startsWith('00')) d = d.slice(2);

  // Ya viene en formato internacional (indicativo + número nacional)
  if (d.startsWith(cc) && d.length > 10) return d;

  // Número nacional (Colombia: celular de 10 dígitos) → anteponer indicativo
  if (d.length === 10) return cc + d;

  // Cualquier otra longitud (ya internacional de otro país, fijos, etc.) se deja igual
  return d;
}

// Últimos 10 dígitos = número nacional. Sirve para hacer match robusto sin
// depender de si el número guardado trae o no el indicativo.
function nationalNumber(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

module.exports = { normalizeWhatsapp, nationalNumber, DEFAULT_CC };
