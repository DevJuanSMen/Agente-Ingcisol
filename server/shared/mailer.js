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

const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = (process.env.SMTP_PASS || '').replace(/\s+/g, ''); // Gmail muestra la App Password con espacios
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
const MAIL_FROM = process.env.MAIL_FROM || (SMTP_USER ? `PROCURA AI <${SMTP_USER}>` : '');

const isMailEnabled = () => Boolean(SMTP_USER && SMTP_PASS);

let transporter = null;
if (isMailEnabled()) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  logger.info(`[mailer] Correo habilitado vía ${SMTP_HOST}:${SMTP_PORT} como ${SMTP_USER}`);
} else {
  logger.warn('[mailer] SMTP_USER/SMTP_PASS no configuradas — el envío de correos está deshabilitado');
}

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
      from: MAIL_FROM,
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

module.exports = { sendMail, isMailEnabled };
