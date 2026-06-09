// TODO: integrar SendGrid para email y Twilio para WhatsApp

const sendEmail = async ({ to, subject, html }) => {
  console.log('[notifications] Enviaría email:', { to, subject });
  // TODO: integrar SendGrid
  // const msg = { to, from: process.env.SENDGRID_FROM_EMAIL, subject, html };
  // await sgMail.send(msg);
};

const sendWhatsApp = async ({ to, body }) => {
  console.log('[notifications] Enviaría WhatsApp:', { to, body: body.slice(0, 50) });
  // TODO: integrar Twilio
  // await twilio.messages.create({
  //   from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
  //   to: `whatsapp:${to}`,
  //   body,
  // });
};

const notifyNewRequisition = async (director, requisicion) => {
  await sendEmail({
    to: director.email,
    subject: `Nueva requisición ${requisicion.consecutivo} — PROCURA AI`,
    html: `<p>Se ha creado la requisición <strong>${requisicion.consecutivo}</strong> esperando su aprobación.</p>`,
  });
};

const notifyOrderDelivery = async (contabilidad, orden) => {
  await sendEmail({
    to: contabilidad.email,
    subject: `OC ${orden.consecutivo} entregada — Registrar pago`,
    html: `<p>La orden <strong>${orden.consecutivo}</strong> fue marcada como entregada. Por favor registre el pago.</p>`,
  });
};

module.exports = { sendEmail, sendWhatsApp, notifyNewRequisition, notifyOrderDelivery };
