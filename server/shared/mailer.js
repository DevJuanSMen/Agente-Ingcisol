const nodemailer = require('nodemailer');
const { logger } = require('./utils/logger');

// ── Envío de correos (SMTP genérico; pensado para Gmail con App Password) ─────
//
// Variables de entorno:
//   SMTP_USER  → cuenta remitente (ej. procura.ingcisol@gmail.com)  [requerida]
//   SMTP_PASS  → App Password de Gmail (16 letras, sin espacios)     [requerida]
//   SMTP_HOST  → default smtp.gmail.com
//   SMTP_PORT  → default 465 (SSL). Usa 587 para STARTTLS.
//   MAIL_FROM  → remitente visible; default "PROCURA AI <SMTP_USER>"
//
// Si SMTP_USER/SMTP_PASS no están configuradas, el mailer queda deshabilitado y
// sendMail() es un no-op con warning: el sistema NUNCA falla por falta de correo.

// La configuración puede venir del entorno (Railway) o de Redis, guardada desde
// el panel superadmin (misma estrategia que la API key de Groq: rotar el correo
// o la App Password sin acceso a Railway y sin tocar código). Redis manda.
const SMTP_REDIS_KEY = 'smtp:config';

const normalizeConfig = (raw = {}) => {
  const user = String(raw.user || '').trim();
  const pass = String(raw.pass || '').replace(/\s+/g, ''); // Gmail muestra la App Password con espacios
  const host = String(raw.host || '').trim() || 'smtp.gmail.com';
  const port = Number(raw.port) || 465;
  const from = String(raw.from || '').trim() || (user ? `PROCURA AI <${user}>` : '');
  return { user, pass, host, port, from };
};

let config = normalizeConfig({
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  from: process.env.MAIL_FROM,
});
let transporter = null;

const isMailEnabled = () => Boolean(config.user && config.pass);

const buildTransport = (cfg) =>
  nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });

// Activa una configuración en este proceso (reconstruye el transport).
const applySmtpConfig = (raw) => {
  config = normalizeConfig(raw);
  transporter = isMailEnabled() ? buildTransport(config) : null;
  if (transporter) {
    logger.info(`[mailer] Correo habilitado vía ${config.host}:${config.port} como ${config.user}`);
  } else {
    logger.warn('[mailer] SMTP sin usuario/App Password — el envío de correos está deshabilitado');
  }
};

// Carga la configuración guardada en Redis (si existe) sobre la del entorno.
// Se llama al arrancar api/worker y cuando el panel guarda cambios (IPC).
const initSmtpFromRedis = async (redis) => {
  const stored = await redis.get(SMTP_REDIS_KEY);
  if (stored) {
    applySmtpConfig(JSON.parse(stored));
    return true;
  }
  return false;
};

// Valida credenciales contra el servidor SMTP real (login incluido) sin
// guardarlas. Lanza si el servidor las rechaza.
const testSmtpConfig = async (raw) => {
  const cfg = normalizeConfig(raw);
  if (!cfg.user || !cfg.pass) throw new Error('Faltan el correo o la App Password');
  await buildTransport(cfg).verify();
  return cfg;
};

// Estado para el panel (sin exponer la contraseña).
const getSmtpStatus = () => ({
  configurado: isMailEnabled(),
  usuario: config.user || null,
  host: config.host,
  puerto: config.port,
  remitente: config.from || null,
});

// Arranque: aplicar lo del entorno (Redis puede sobreescribir después).
applySmtpConfig(config);

// Plantilla base: colores de marca INGCISOL (naranja #E85D04 / ink).
const wrapHtml = (titulo, cuerpoHtml) => `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
  <div style="background:#E85D04;padding:16px 24px">
    <p style="margin:0;color:#fff;font-size:18px;font-weight:bold">PROCURA AI</p>
    <p style="margin:2px 0 0;color:#ffe3d1;font-size:12px">${titulo}</p>
  </div>
  <div style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6">
    ${cuerpoHtml}
  </div>
  <div style="padding:12px 24px;background:#f8fafc;border-top:1px solid #e2e8f0">
    <p style="margin:0;color:#94a3b8;font-size:11px">Mensaje automático de PROCURA AI — no responda a este correo.</p>
  </div>
</div>`;

// Envía un correo. attachments: [{ filename, content (Buffer), contentType }]
// No lanza: loguea el error y devuelve false, para no tumbar ningún flujo.
const sendMail = async ({ to, subject, titulo, html, attachments }) => {
  if (!isMailEnabled()) {
    logger.warn(`[mailer] Correo omitido (SMTP no configurado): "${subject}" → ${to}`);
    return false;
  }
  if (!to) return false;
  try {
    await transporter.sendMail({
      from: config.from,
      to,
      subject,
      html: wrapHtml(titulo || subject, html),
      attachments: attachments || [],
    });
    logger.info(`[mailer] Enviado "${subject}" → ${to}`);
    return true;
  } catch (err) {
    logger.error(`[mailer] Error enviando "${subject}" a ${to}: ${err.message}`);
    return false;
  }
};

module.exports = {
  sendMail,
  isMailEnabled,
  applySmtpConfig,
  initSmtpFromRedis,
  testSmtpConfig,
  getSmtpStatus,
  SMTP_REDIS_KEY,
};
