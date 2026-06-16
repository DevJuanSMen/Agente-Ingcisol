const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { ok } = require('../../shared/utils/response');
const { getGroq } = require('../../shared/utils/groq');
const { buildDbContext } = require('../whatsapp/bot.context');
const { logger } = require('../../shared/utils/logger');

router.use(verifyToken);

// Chat del asistente del panel — recibe el historial y responde con contexto del sistema
router.post('/chat', async (req, res, next) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: true, message: 'Se requiere el historial de mensajes' });
    }

    // Solo los últimos 10 turnos, con roles válidos
    const history = messages
      .filter((m) => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

    if (history.length === 0) {
      return res.status(400).json({ error: true, message: 'Historial de mensajes inválido' });
    }

    const context = await buildDbContext(req.user.companyId);
    const groq = getGroq();

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `Eres el agente de compras de PROCURA AI, sistema de gestión de procura para constructoras colombianas. El usuario que te habla es ${req.user.rol || 'un usuario'} de la empresa.
Responde en español, de forma clara y concisa (máximo 3 párrafos cortos). No uses formato Markdown complejo; texto plano con guiones para listas.
Solo respondes sobre compras, presupuestos APU, requisiciones, cotizaciones, órdenes de compra, proveedores y proyectos de construcción. Si te preguntan otra cosa, redirige amablemente al tema.
Si no tienes la información exacta, dilo claramente y sugiere en qué módulo del sistema puede consultarla.

DATOS ACTUALES DEL SISTEMA:
${context}`,
        },
        ...history,
      ],
      temperature: 0.4,
      max_tokens: 500,
    });

    const reply = completion.choices[0]?.message?.content;
    if (!reply) throw Object.assign(new Error('El asistente no pudo generar respuesta'), { statusCode: 502 });

    ok(res, { reply });
  } catch (err) {
    logger.error('[assistant] Error en chat:', err.message);
    next(err);
  }
});

module.exports = router;
