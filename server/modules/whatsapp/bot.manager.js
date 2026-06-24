const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { logger } = require('../../shared/utils/logger');
const redis = require('../../shared/redis');
const prisma = require('../../shared/db');
const { buildResponse, handleSupplierMessage } = require('./bot.context');
const botFlows = require('./bot.flows');
const { normalizeWhatsapp, nationalNumber } = require('../../shared/utils/phone');

const AUTH_BASE = process.env.WWEBJS_AUTH_PATH || '/app/.wwebjs_auth';
const CHROMIUM = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

// Nota: NO usar '--single-process' / '--no-zygote'. Con whatsapp-web.js provocan
// "Execution context was destroyed" y que la sesión nunca complete el handshake
// (el QR se regenera en bucle sin conectar). Más estable sin ellos.
const PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
];

class BotManager {
  constructor() {
    this.clients = new Map(); // companyId -> Client
    this.retryTimers = new Map(); // companyId -> Timer
    this.qrTimers = new Map(); // companyId -> Timer (ventana de emparejamiento QR)
    this.ready = new Set(); // companyIds con el store de WhatsApp Web ya inyectado
  }

  _clearQrTimer(companyId) {
    const t = this.qrTimers.get(companyId);
    if (t) { clearTimeout(t); this.qrTimers.delete(companyId); }
  }

  // ¿El cliente está realmente listo para enviar? Tener el Client en el mapa no
  // basta: el store interno (window.Store) solo existe tras el evento 'ready'.
  isReady(companyId) {
    return this.ready.has(companyId);
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

  // Borra TODA la sesión guardada (credenciales). Necesario tras un LOGOUT: las
  // credenciales quedan inválidas y reusarlas provoca "Target closed" en bucle.
  // Tras esto, el siguiente initialize() genera un QR nuevo para re-vincular.
  _clearSession(companyId) {
    const sessionDir = path.join(AUTH_BASE, `session-${companyId}`);
    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
  }

  // Programa un único reintento de reconexión (evita timers duplicados y no
  // reintenta si la empresa deshabilitó el bot o si no tiene sesión guardada
  // —en ese caso requiere QR manual, no se debe generar QR automáticamente—).
  async _scheduleReconnect(companyId, delayMs = 30_000) {
    if (this.retryTimers.has(companyId)) return;
    const enabled = await redis.get(this._keys(companyId).enabled);
    if (enabled !== '1') {
      logger.info(`[bot:${companyId}] Bot deshabilitado; no se reconecta`);
      return;
    }
    if (!this._hasSession(companyId)) {
      logger.info(`[bot:${companyId}] Sin sesión guardada; no se reconecta solo (requiere QR manual).`);
      return;
    }
    const timer = setTimeout(() => {
      this.retryTimers.delete(companyId);
      logger.info(`[bot:${companyId}] Reintentando reconexión...`);
      this.initCompany(companyId);
    }, delayMs);
    this.retryTimers.set(companyId, timer);
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
        await redis.set(k.qr, dataUrl, 'EX', 130);
        await redis.set(k.status, 'qr_waiting');
      } catch (err) {
        logger.error(`[bot:${companyId}] Error guardando QR: ${err.message}`);
      }

      // Ventana de emparejamiento: el QR rota mientras nadie escanea. Para no
      // generarlo indefinidamente, si nadie escanea en 2 min cerramos la sesión.
      // El usuario vuelve a pulsar "Generar QR" cuando esté listo.
      if (!this.qrTimers.has(companyId)) {
        const t = setTimeout(async () => {
          this.qrTimers.delete(companyId);
          if (this.ready.has(companyId)) return; // ya conectó
          logger.warn(`[bot:${companyId}] QR no escaneado a tiempo; se cierra la sesión de emparejamiento.`);
          try { await client.destroy(); } catch {}
          this.ready.delete(companyId);
          this.clients.delete(companyId);
          await redis.del(k.qr);
          await redis.set(k.status, 'disconnected');
        }, 120_000);
        this.qrTimers.set(companyId, t);
      }
    });

    client.on('authenticated', async () => {
      logger.info(`[bot:${companyId}] Autenticado`);
      this._clearQrTimer(companyId);
      await redis.del(k.qr);
      await redis.set(k.status, 'authenticated');
    });

    client.on('ready', async () => {
      logger.info(`[bot:${companyId}] Listo`);
      this._clearQrTimer(companyId);
      this.ready.add(companyId);
      await redis.set(k.status, 'ready');
    });

    client.on('disconnected', async (reason) => {
      logger.warn(`[bot:${companyId}] Desconectado: ${reason}`);
      this.ready.delete(companyId);
      this.clients.delete(companyId);
      this._clearQrTimer(companyId);
      await redis.set(k.status, 'disconnected');

      // Cerrar el navegador del cliente caído: si no, queda un proceso zombie y
      // el reintento choca con "Target closed".
      try { await client.destroy(); } catch {}

      // LOGOUT = la sesión fue cerrada/invalidada desde el teléfono. Las
      // credenciales ya no sirven: se limpian. NO se regenera QR solo: el usuario
      // deberá pulsar "Generar QR para conectar" cuando quiera re-vincular.
      if (reason === 'LOGOUT') {
        this._clearSession(companyId);
        await redis.del(k.qr);
        logger.warn(`[bot:${companyId}] Sesión cerrada (LOGOUT). Re-vincular pulsando "Generar QR".`);
      }

      await this._scheduleReconnect(companyId);
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

        // Match por número nacional (últimos 10 dígitos): así coincide aunque el
        // número guardado esté con o sin el indicativo de país (57).
        const phoneNat = nationalNumber(phone) || phone;

        // ¿Es un proveedor registrado y activo? (los archivados no interceptan)
        const supplier = await prisma.supplier.findFirst({
          where: { companyId, activo: true, whatsapp: { contains: phoneNat } },
        });

        if (supplier) {
          const reply = await handleSupplierMessage(text, companyId, supplier.id, supplier.nombre);
          if (reply) await msg.reply(reply);
          return;
        }

        // ¿Es un usuario interno?
        const user = await prisma.user.findFirst({
          where: { companyId, whatsapp: { contains: phoneNat }, activo: true },
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

    client.initialize().catch(async (err) => {
      logger.error(`[bot:${companyId}] Error al inicializar: ${err.message}`);
      this.ready.delete(companyId);
      this.clients.delete(companyId);
      await redis.set(k.status, 'error');
      // Cerrar lo que haya quedado a medias y reintentar de forma controlada.
      try { await client.destroy(); } catch {}
      this._clearLocks(companyId);
      await this._scheduleReconnect(companyId);
    });
  }

  async destroyCompany(companyId) {
    const timer = this.retryTimers.get(companyId);
    if (timer) { clearTimeout(timer); this.retryTimers.delete(companyId); }
    this._clearQrTimer(companyId);
    const k = this._keys(companyId);

    const client = this.clients.get(companyId);
    if (client) {
      try { await client.destroy(); } catch {}
    }
    this.ready.delete(companyId);
    this.clients.delete(companyId);
    // Limpiar QR y estado aunque no hubiera cliente vivo en este worker, para que
    // el panel superadmin refleje el cambio de inmediato.
    await redis.del(k.qr);
    await redis.set(k.status, 'disconnected');
    logger.info(`[bot:${companyId}] Destruido`);
  }

  // Envía un mensaje en nombre de una empresa
  async sendMessage(companyId, phone, text) {
    const client = this.clients.get(companyId);
    if (!client) throw new Error(`Sin cliente WhatsApp activo para empresa ${companyId}`);
    if (!this.ready.has(companyId)) throw new Error(`Cliente WhatsApp de empresa ${companyId} aún no está listo`);
    const sanitized = normalizeWhatsapp(phone);
    return client.sendMessage(`${sanitized}@c.us`, text);
  }

  // Envía un documento (PDF en base64) en nombre de una empresa
  async sendDocument(companyId, phone, base64, filename, caption) {
    const client = this.clients.get(companyId);
    if (!client) throw new Error(`Sin cliente WhatsApp activo para empresa ${companyId}`);
    if (!this.ready.has(companyId)) throw new Error(`Cliente WhatsApp de empresa ${companyId} aún no está listo`);
    const sanitized = normalizeWhatsapp(phone);
    const media = new MessageMedia('application/pdf', base64, filename || 'documento.pdf');
    return client.sendMessage(`${sanitized}@c.us`, media, {
      caption: caption || undefined,
      sendMediaAsDocument: true,
    });
  }

  // ¿Existe una sesión ya guardada (empresa vinculada antes)?
  _hasSession(companyId) {
    const dir = path.join(AUTH_BASE, `session-${companyId}`);
    try {
      return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
    } catch {
      return false;
    }
  }

  // Re-inicializa al arrancar el worker SOLO las empresas que ya tienen sesión
  // vinculada. Una empresa "enabled" pero sin sesión (nunca escaneó el QR) NO se
  // revive: si no, lanza un Chromium que gira QR para siempre y satura el worker.
  // Quien quiera vincular una empresa nueva lo hace desde el panel (Conectar).
  async restoreActiveSessions() {
    const keys = await redis.keys('whatsapp:*:enabled');
    let restored = 0;
    for (const key of keys) {
      const val = await redis.get(key);
      if (val !== '1') continue;
      const companyId = key.split(':')[1];
      if (!this._hasSession(companyId)) {
        logger.warn(`[bot] ${companyId} habilitado pero sin sesión guardada; no se restaura (vincúlalo desde el panel).`);
        continue;
      }
      logger.info(`[bot] Restaurando sesión para empresa ${companyId}`);
      await this.initCompany(companyId);
      restored += 1;
      // Escalonar: no lanzar varios Chromium en el mismo instante.
      await new Promise((r) => setTimeout(r, 4000));
    }
    logger.info(`[bot] Sesiones restauradas: ${restored}`);
  }
}

module.exports = new BotManager();
