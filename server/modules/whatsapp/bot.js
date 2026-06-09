const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { logger } = require('../../shared/utils/logger');
const redis = require('../../shared/redis');
const prisma = require('../../shared/db');
const { buildResponse } = require('./bot.context');

let client = null;

const initBot = () => {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: '/app/.wwebjs_auth' }),
    puppeteer: {
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
      ],
    },
  });

  client.on('qr', async (qr) => {
    logger.info('[bot] QR generado — escanea con WhatsApp');
    try {
      const dataUrl = await qrcode.toDataURL(qr);
      await redis.set('whatsapp:qr', dataUrl, 'EX', 120);
      await redis.set('whatsapp:status', 'qr_waiting');
    } catch (err) {
      logger.error('[bot] Error guardando QR en Redis:', err.message);
    }
  });

  client.on('authenticated', async () => {
    logger.info('[bot] Autenticado correctamente');
    await redis.del('whatsapp:qr');
    await redis.set('whatsapp:status', 'authenticated');
  });

  client.on('ready', async () => {
    logger.info('[bot] Listo para recibir mensajes');
    await redis.set('whatsapp:status', 'ready');
  });

  client.on('disconnected', async (reason) => {
    logger.warn('[bot] Desconectado:', reason);
    await redis.set('whatsapp:status', 'disconnected');
    // Reintentar después de 30 segundos
    setTimeout(() => {
      logger.info('[bot] Reintentando conexión...');
      client.initialize().catch((err) => logger.error('[bot] Error al reiniciar:', err.message));
    }, 30_000);
  });

  client.on('message', async (msg) => {
    if (msg.from.endsWith('@g.us')) return; // ignorar grupos
    if (msg.from === 'status@broadcast') return; // ignorar estados
    if (msg.fromMe) return;

    const text = (msg.body || '').trim();
    if (!text) return;

    try {
      const enabled = await redis.get('whatsapp:enabled');

      if (enabled !== '1') {
        if (text.toLowerCase() === 'activar modo pruebas') {
          await msg.reply(
            '🔧 *Modo pruebas*\n\nEl bot está desactivado. Puedes consultar el menú con *ayuda*, pero las respuestas son solo de prueba.\n\nPara activarlo permanentemente, usa el panel de administración.'
          );
          // Test mode temporal: 10 minutos para este número
          await redis.set(`whatsapp:testmode:${msg.from}`, '1', 'EX', 600);
        } else {
          const inTestMode = await redis.get(`whatsapp:testmode:${msg.from}`);
          if (!inTestMode) return;
          // Continúa hacia el procesamiento normal si está en test mode
        }
      }

      let phone;
      if (msg.from.endsWith('@lid')) {
        const contact = await msg.getContact();
        phone = (contact.id?.user || contact.number || '').replace(/\D/g, '');
      } else {
        phone = msg.from.replace('@c.us', '').replace(/\D/g, '');
      }
      logger.info(`[bot] Mensaje de: ${msg.from} → phone extraído: ${phone}`);
      const user = await prisma.user.findFirst({
        where: { whatsapp: { contains: phone }, activo: true },
        select: { companyId: true, nombre: true },
      });
      logger.info(`[bot] Usuario encontrado: ${user ? user.nombre : 'NINGUNO'}`);

      if (!user) {
        if (text.toLowerCase() === 'activar modo pruebas' || enabled === '1') {
          await msg.reply('👋 Tu número no está registrado en PROCURA AI. Contacta al administrador.');
        }
        return;
      }

      const response = await buildResponse(text, user.companyId);
      if (response) await msg.reply(response);
    } catch (err) {
      logger.error('[bot] Error procesando mensaje:', err.message);
    }
  });

  redis.set('whatsapp:status', 'disconnected');

  client.initialize().catch((err) => {
    logger.error('[bot] Error al inicializar cliente:', err?.message || err?.toString() || JSON.stringify(err));
    redis.set('whatsapp:status', 'error');
  });

  return client;
};

const getClient = () => client;

module.exports = { initBot, getClient };
