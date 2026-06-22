const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { logger } = require('../../shared/utils/logger');
const redis = require('../../shared/redis');
const prisma = require('../../shared/db');
const { buildResponse, handleSupplierMessage } = require('./bot.context');
const botFlows = require('./bot.flows');

const AUTH_BASE = process.env.WWEBJS_AUTH_PATH || '/app/.wwebjs_auth';
const CHROMIUM = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

const PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--single-process',
  '--no-zygote',
];

class BotManager {
  constructor() {
    this.clients = new Map(); // companyId -> Client
    this.retryTimers = new Map(); // companyId -> Timer
  }

  _keys(companyId) {
    return {
      qr: `whatsapp:${companyId}:qr`,
      status: `whatsapp:${companyId}:status`,
      enabled: `whatsapp:${companyId}:enabled`,
    };
  }

  _clearLocks(companyId) {
    const sessionDir = path.join(AUTH_BASE, `session-${companyId}`);
    const locks = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    for (const f of locks) {
      try { fs.unlinkSync(path.join(sessionDir, f)); } catch {}
    }
  }

  async initCompany(companyId) {
    if (this.clients.has(companyId)) {
      logger.info(`[bot:${companyId}] Cliente ya activo`);
      return;
    }

    this._clearLocks(companyId);
    const k = this._keys(companyId);

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: companyId, dataPath: AUTH_BASE }),
      puppeteer: { executablePath: CHROMIUM, args: PUPPETEER_ARGS },
    });

    client.on('qr', async (qr) => {
      logger.info(`[bot:${companyId}] QR generado`);
      try {
        const dataUrl = await qrcode.toDataURL(qr);
        await redis.set(k.qr, dataUrl, 'EX', 120);
        await redis.set(k.status, 'qr_waiting');
      } catch (err) {
        logger.error(`[bot:${companyId}] Error guardando QR: ${err.message}`);
      }
    });

    client.on('authenticated', async () => {
      logger.info(`[bot:${companyId}] Autenticado`);
      await redis.del(k.qr);
      await redis.set(k.status, 'authenticated');
    });

    client.on('ready', async () => {
      logger.info(`[bot:${companyId}] Listo`);
      await redis.set(k.status, 'ready');
    });

    client.on('disconnected', async (reason) => {
      logger.warn(`[bot:${companyId}] Desconectado: ${reason}`);
      await redis.set(k.status, 'disconnected');
      this.clients.delete(companyId);

      const timer = setTimeout(() => {
        this.retryTimers.delete(companyId);
        logger.info(`[bot:${companyId}] Reintentando reconexión...`);
        this.initCompany(companyId);
      }, 30_000);
      this.retryTimers.set(companyId, timer);
    });

    client.on('message', async (msg) => {
      if (msg.from.endsWith('@g.us') || msg.from === 'status@broadcast' || msg.fromMe) return;
      const text = (msg.body || '').trim();
      if (!text) return;

      try {
        const enabled = await redis.get(k.enabled);
        if (enabled !== '1') return;

        let phone = msg.from.replace('@c.us', '').replace(/\D/g, '');
        if (msg.from.endsWith('@lid')) {
          const contact = await msg.getContact();
          phone = (contact.id?.user || contact.number || '').replace(/\D/g, '');
        }

        logger.info(`[bot:${companyId}] Mensaje de: ${phone}`);

        // ¿Es un proveedor registrado y activo? (los archivados no interceptan)
        const supplier = await prisma.supplier.findFirst({
          where: { companyId, activo: true, whatsapp: { contains: phone } },
        });

        if (supplier) {
          const reply = await handleSupplierMessage(text, companyId, supplier.id, supplier.nombre);
          if (reply) await msg.reply(reply);
          return;
        }

        // ¿Es un usuario interno?
        const user = await prisma.user.findFirst({
          where: { companyId, whatsapp: { contains: phone }, activo: true },
          select: { id: true, nombre: true, rol: true },
        });

        if (!user) return;

        // ¿Hay una acción pendiente para este usuario? (aprobar requisición /
        // adjudicar ganador desde WhatsApp)
        const pending = await botFlows.getPending(companyId, user.id);
        if (pending) {
          const reply = await botFlows.handlePendingReply(
            text,
            companyId,
            { id: user.id, rol: user.rol, nombre: user.nombre, phone },
            pending
          );
          if (reply) await msg.reply(reply);
          return;
        }

        const reply = await buildResponse(text, companyId, { id: user.id, rol: user.rol });
        if (reply) await msg.reply(reply);
      } catch (err) {
        logger.error(`[bot:${companyId}] Error procesando mensaje: ${err.message}`);
      }
    });

    await redis.set(k.status, 'disconnected');
    this.clients.set(companyId, client);

    client.initialize().catch((err) => {
      logger.error(`[bot:${companyId}] Error al inicializar: ${err.message}`);
      redis.set(k.status, 'error');
      this.clients.delete(companyId);
    });
  }

  async destroyCompany(companyId) {
    const timer = this.retryTimers.get(companyId);
    if (timer) { clearTimeout(timer); this.retryTimers.delete(companyId); }

    const client = this.clients.get(companyId);
    if (!client) return;

    try { await client.destroy(); } catch {}
    this.clients.delete(companyId);
    await redis.set(this._keys(companyId).status, 'disconnected');
    logger.info(`[bot:${companyId}] Destruido`);
  }

  // Envía un mensaje en nombre de una empresa
  async sendMessage(companyId, phone, text) {
    const client = this.clients.get(companyId);
    if (!client) throw new Error(`Sin cliente WhatsApp activo para empresa ${companyId}`);
    const sanitized = phone.replace(/\D/g, '');
    return client.sendMessage(`${sanitized}@c.us`, text);
  }

  // Envía un documento (PDF en base64) en nombre de una empresa
  async sendDocument(companyId, phone, base64, filename, caption) {
    const client = this.clients.get(companyId);
    if (!client) throw new Error(`Sin cliente WhatsApp activo para empresa ${companyId}`);
    const sanitized = phone.replace(/\D/g, '');
    const media = new MessageMedia('application/pdf', base64, filename || 'documento.pdf');
    return client.sendMessage(`${sanitized}@c.us`, media, {
      caption: caption || undefined,
      sendMediaAsDocument: true,
    });
  }

  // Re-inicializa todos los bots activos al arrancar el worker
  async restoreActiveSessions() {
    const keys = await redis.keys('whatsapp:*:enabled');
    for (const key of keys) {
      const val = await redis.get(key);
      if (val !== '1') continue;
      const companyId = key.split(':')[1];
      logger.info(`[bot] Restaurando sesión para empresa ${companyId}`);
      await this.initCompany(companyId);
    }
  }
}

module.exports = new BotManager();
