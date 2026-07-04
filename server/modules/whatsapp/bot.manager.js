const fs = require('fs');
const path = require('path');
const pino = require('pino');
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const { logger } = require('../../shared/utils/logger');
const redis = require('../../shared/redis');
const prisma = require('../../shared/db');
const { buildResponse, handleSupplierMessage } = require('./bot.context');
const botFlows = require('./bot.flows');
const { normalizeWhatsapp, nationalNumber } = require('../../shared/utils/phone');

// Sesiones de Baileys (multi-file auth). Son de KB (no perfiles de Chromium),
// así que el volumen de Railway ya no se llena. Reutilizamos la misma variable de
// entorno para no cambiar el mount del volumen; los datos nuevos van a
// subcarpetas baileys-<companyId> (conviven con las viejas session-<id> de
// whatsapp-web.js, que ya no se usan y pueden borrarse a mano).
const AUTH_BASE = process.env.WWEBJS_AUTH_PATH || '/app/.wwebjs_auth';

// Baileys exige un logger tipo pino; lo silenciamos (usamos el logger propio).
const waLogger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' });

// JID de un número para enviar (individual). normalizeWhatsapp deja el número en
// internacional sin símbolos (ej. 573001234567).
const jidFor = (phone) => `${normalizeWhatsapp(phone)}@s.whatsapp.net`;

// Extrae el texto de un mensaje entrante de Baileys (cubre los tipos comunes).
const extractText = (msg) => {
  const m = msg.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    ''
  );
};

class BotManager {
  constructor() {
    this.socks = new Map(); // companyId -> sock
    this.retryTimers = new Map(); // companyId -> Timer
    this.qrTimers = new Map(); // companyId -> Timer (ventana de emparejamiento)
    this.ready = new Set(); // companyIds conectados (connection === 'open')
    this.pairing = new Map(); // companyId -> { mode, phone, requested }
    this.stopping = new Set(); // companyIds que se están deteniendo a propósito
  }

  _clearQrTimer(companyId) {
    const t = this.qrTimers.get(companyId);
    if (t) { clearTimeout(t); this.qrTimers.delete(companyId); }
  }

  // Ventana de seguridad para vincular (QR o código): 10 min. No apura al usuario;
  // solo evita dejar un socket girando si se abandona la pestaña. Si conecta, se
  // cancela (en connection === 'open').
  _armPairingTimeout(companyId, sock) {
    if (this.qrTimers.has(companyId)) return;
    const k = this._keys(companyId);
    const t = setTimeout(async () => {
      this.qrTimers.delete(companyId);
      if (this.ready.has(companyId)) return; // ya conectó
      logger.warn(`[bot:${companyId}] Vinculación no completada en 10 min; se cierra la sesión de emparejamiento.`);
      this.stopping.add(companyId);
      try { sock.end(undefined); } catch {}
      this.ready.delete(companyId);
      this.socks.delete(companyId);
      this.pairing.delete(companyId);
      await redis.del(k.qr);
      await redis.del(k.pairingCode);
      await redis.set(k.status, 'disconnected');
    }, 600_000);
    this.qrTimers.set(companyId, t);
  }

  // ¿El cliente está conectado y listo para enviar?
  isReady(companyId) {
    return this.ready.has(companyId);
  }

  _keys(companyId) {
    return {
      qr: `whatsapp:${companyId}:qr`,
      pairingCode: `whatsapp:${companyId}:pairingCode`,
      status: `whatsapp:${companyId}:status`,
      enabled: `whatsapp:${companyId}:enabled`,
    };
  }

  _sessionDir(companyId) {
    return path.join(AUTH_BASE, `baileys-${companyId}`);
  }

  // ¿Existe una sesión ya guardada (empresa vinculada antes)?
  _hasSession(companyId) {
    try {
      return fs.existsSync(path.join(this._sessionDir(companyId), 'creds.json'));
    } catch {
      return false;
    }
  }

  // Borra la sesión guardada. Necesario tras LOGOUT: las credenciales quedan
  // inválidas; el siguiente initialize genera un QR nuevo para re-vincular.
  _clearSession(companyId) {
    try { fs.rmSync(this._sessionDir(companyId), { recursive: true, force: true }); } catch {}
  }

  // Programa un único reintento de reconexión (sin duplicar timers; no reintenta
  // si la empresa deshabilitó el bot o si no tiene sesión guardada —requiere QR).
  async _scheduleReconnect(companyId, delayMs = 15_000) {
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

  // opts: { mode: 'qr' | 'pairing', phone?: string }
  //  - 'qr'      → escanear código QR (clásico).
  //  - 'pairing' → código de 8 dígitos que el usuario escribe en WhatsApp
  //                (Dispositivos vinculados → Vincular con número de teléfono).
  async initCompany(companyId, opts = {}) {
    if (this.socks.has(companyId)) {
      logger.info(`[bot:${companyId}] Cliente ya activo`);
      return;
    }

    const k = this._keys(companyId);
    const dir = this._sessionDir(companyId);
    fs.mkdirSync(dir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(dir);

    const mode = opts.mode === 'pairing' ? 'pairing' : 'qr';
    const phone = opts.phone ? String(opts.phone).replace(/\D/g, '') : null;
    // Emparejamiento solo si hay teléfono válido y la sesión aún no está registrada.
    const usePairing = mode === 'pairing' && phone && phone.length >= 10 && !state.creds.registered;
    this.pairing.set(companyId, { mode: usePairing ? 'pairing' : 'qr', phone, requested: false });

    // Usa la versión de protocolo actual de WhatsApp Web (con fallback al default
    // que trae Baileys si no hay red para consultarla).
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch (err) {
      logger.warn(`[bot:${companyId}] No se pudo obtener la versión de WA; se usa el default de Baileys: ${err.message}`);
    }

    const sock = makeWASocket({
      version,
      auth: state,
      logger: waLogger,
      browser: Browsers.ubuntu('PROCURA AI'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      // Evita warnings de reintentos; no necesitamos re-hidratar mensajes viejos.
      getMessage: async () => undefined,
    });

    this.socks.set(companyId, sock);
    this.stopping.delete(companyId);
    sock.ev.on('creds.update', saveCreds);

    // ── Código de emparejamiento ──────────────────────────────────────────────
    // Se pide una sola vez, poco después de crear el socket (aún sin registrar).
    if (usePairing) {
      setTimeout(async () => {
        const pairing = this.pairing.get(companyId);
        if (!pairing || pairing.requested) return;
        if (!this.socks.has(companyId)) return; // ya se cerró
        if (sock.authState?.creds?.registered) return;
        pairing.requested = true;
        this.pairing.set(companyId, pairing);
        try {
          const code = await sock.requestPairingCode(phone);
          await redis.set(k.pairingCode, code, 'EX', 600);
          await redis.del(k.qr);
          await redis.set(k.status, 'pairing_waiting');
          logger.info(`[bot:${companyId}] Código de emparejamiento generado`);
          this._armPairingTimeout(companyId, sock);
        } catch (err) {
          logger.error(`[bot:${companyId}] Error generando código de emparejamiento: ${err.message}. Se usa QR.`);
          pairing.mode = 'qr';
          this.pairing.set(companyId, pairing);
        }
      }, 3000);
    }

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // ── QR ──────────────────────────────────────────────────────────────────
      if (qr) {
        const pairing = this.pairing.get(companyId) || {};
        if (pairing.mode === 'pairing') return; // en modo código ignoramos el QR
        logger.info(`[bot:${companyId}] QR generado`);
        try {
          const dataUrl = await qrcode.toDataURL(qr);
          await redis.set(k.qr, dataUrl, 'EX', 180);
          await redis.set(k.status, 'qr_waiting');
        } catch (err) {
          logger.error(`[bot:${companyId}] Error guardando QR: ${err.message}`);
        }
        this._armPairingTimeout(companyId, sock);
      }

      // ── Conectado ─────────────────────────────────────────────────────────────
      if (connection === 'open') {
        logger.info(`[bot:${companyId}] Listo`);
        this._clearQrTimer(companyId);
        this.pairing.delete(companyId);
        this.ready.add(companyId);
        await redis.del(k.qr);
        await redis.del(k.pairingCode);
        await redis.set(k.status, 'ready');
      }

      // ── Cerrado ───────────────────────────────────────────────────────────────
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        const intentional = this.stopping.has(companyId);
        logger.warn(`[bot:${companyId}] Conexión cerrada (code ${statusCode ?? 'n/a'})`);

        this.ready.delete(companyId);
        this.socks.delete(companyId);
        this._clearQrTimer(companyId);
        await redis.del(k.pairingCode);
        await redis.set(k.status, 'disconnected');

        if (intentional) {
          this.stopping.delete(companyId);
          this.pairing.delete(companyId);
          return; // cierre a propósito (destroyCompany / timeout de emparejamiento)
        }

        // LOGOUT = la sesión fue cerrada/invalidada desde el teléfono. Las
        // credenciales ya no sirven: se limpian. NO se regenera QR solo: el usuario
        // pulsa "Generar QR" cuando quiera re-vincular.
        if (loggedOut) {
          this._clearSession(companyId);
          this.pairing.delete(companyId);
          await redis.del(k.qr);
          logger.warn(`[bot:${companyId}] Sesión cerrada (LOGOUT). Re-vincular pulsando "Generar QR".`);
          return;
        }

        // 515 = restartRequired: NO es un fallo, es un paso obligatorio del login
        // de Baileys (tras escanear/emparejar la conexión se cierra y hay que
        // re-abrirla con las credenciales ya guardadas). Se reconecta de INMEDIATO
        // y sin condiciones (las credenciales acaban de guardarse en creds.update).
        if (statusCode === DisconnectReason.restartRequired) {
          logger.info(`[bot:${companyId}] Restart requerido (515); reconectando de inmediato...`);
          this.initCompany(companyId).catch((err) =>
            logger.error(`[bot:${companyId}] Error en reconexión 515: ${err.message}`)
          );
          return;
        }

        await this._scheduleReconnect(companyId);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return; // solo mensajes nuevos, no sincronización
      for (const m of messages) {
        this._handleIncoming(companyId, m).catch((err) =>
          logger.error(`[bot:${companyId}] Error procesando mensaje: ${err.message}`)
        );
      }
    });

    await redis.set(k.status, 'disconnected');
  }

  // Procesa un mensaje entrante: proveedor → cotización/entrega; usuario interno →
  // flujos pendientes o agente IA. Reutiliza toda la lógica de bot.context/flows.
  async _handleIncoming(companyId, m) {
    if (!m.message || m.key?.fromMe) return;
    const jid = m.key?.remoteJid || '';
    if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;

    const text = extractText(m).trim();
    if (!text) return;

    const k = this._keys(companyId);
    const enabled = await redis.get(k.enabled);
    if (enabled !== '1') return;

    // Número del remitente. Con el nuevo direccionamiento LID de WhatsApp, el jid
    // puede venir como @lid; en ese caso Baileys expone el número real en un campo
    // alterno. Probamos varias fuentes y nos quedamos con los dígitos.
    let senderJid = jid;
    if (jid.endsWith('@lid')) {
      senderJid = m.key.remoteJidAlt || m.key.senderPn || m.key.participantAlt || jid;
    }
    const phone = senderJid.split('@')[0].replace(/\D/g, '');
    logger.info(`[bot:${companyId}] Mensaje de: ${phone}`);

    // Match por número nacional (últimos 10 dígitos): coincide con o sin indicativo.
    const phoneNat = nationalNumber(phone) || phone;

    // ¿Proveedor registrado y activo?
    const supplier = await prisma.supplier.findFirst({
      where: { companyId, activo: true, whatsapp: { contains: phoneNat } },
    });
    if (supplier) {
      const reply = await handleSupplierMessage(text, companyId, supplier.id, supplier.nombre);
      if (reply) await this._reply(companyId, jid, reply, m);
      return;
    }

    // ¿Usuario interno?
    const user = await prisma.user.findFirst({
      where: { companyId, whatsapp: { contains: phoneNat }, activo: true },
      select: { id: true, nombre: true, rol: true },
    });
    if (!user) return;

    // ¿Acción pendiente? (aprobar requisición / adjudicar ganador desde WhatsApp)
    const pending = await botFlows.getPending(companyId, user.id);
    if (pending) {
      const reply = await botFlows.handlePendingReply(
        text,
        companyId,
        { id: user.id, rol: user.rol, nombre: user.nombre, phone },
        pending
      );
      if (reply) await this._reply(companyId, jid, reply, m);
      return;
    }

    const reply = await buildResponse(text, companyId, { id: user.id, rol: user.rol });
    if (reply) await this._reply(companyId, jid, reply, m);
  }

  // Responde citando el mensaje original.
  async _reply(companyId, jid, text, quoted) {
    const sock = this.socks.get(companyId);
    if (!sock) return;
    await sock.sendMessage(jid, { text }, quoted ? { quoted } : undefined);
  }

  // Detiene el bot de una empresa SIN invalidar la sesión (se puede reconectar
  // luego sin re-escanear). Para invalidar del todo, el usuario cierra sesión
  // desde el teléfono (eso dispara LOGOUT y limpia la sesión).
  async destroyCompany(companyId) {
    const timer = this.retryTimers.get(companyId);
    if (timer) { clearTimeout(timer); this.retryTimers.delete(companyId); }
    this._clearQrTimer(companyId);
    const k = this._keys(companyId);

    const sock = this.socks.get(companyId);
    if (sock) {
      this.stopping.add(companyId);
      try { sock.end(undefined); } catch {}
    }
    this.ready.delete(companyId);
    this.socks.delete(companyId);
    this.pairing.delete(companyId);
    // Limpiar QR y estado aunque no hubiera cliente vivo en este worker, para que
    // el panel superadmin refleje el cambio de inmediato.
    await redis.del(k.qr);
    await redis.del(k.pairingCode);
    await redis.set(k.status, 'disconnected');
    logger.info(`[bot:${companyId}] Destruido`);
  }

  // Envía un mensaje de texto en nombre de una empresa.
  async sendMessage(companyId, phone, text) {
    const sock = this.socks.get(companyId);
    if (!sock) throw new Error(`Sin cliente WhatsApp activo para empresa ${companyId}`);
    if (!this.ready.has(companyId)) throw new Error(`Cliente WhatsApp de empresa ${companyId} aún no está listo`);
    return sock.sendMessage(jidFor(phone), { text });
  }

  // Envía un documento (PDF en base64) en nombre de una empresa.
  async sendDocument(companyId, phone, base64, filename, caption) {
    const sock = this.socks.get(companyId);
    if (!sock) throw new Error(`Sin cliente WhatsApp activo para empresa ${companyId}`);
    if (!this.ready.has(companyId)) throw new Error(`Cliente WhatsApp de empresa ${companyId} aún no está listo`);
    return sock.sendMessage(jidFor(phone), {
      document: Buffer.from(base64, 'base64'),
      mimetype: 'application/pdf',
      fileName: filename || 'documento.pdf',
      caption: caption || undefined,
    });
  }

  // Re-inicializa al arrancar el worker SOLO las empresas que ya tienen sesión
  // vinculada. Una empresa "enabled" pero sin sesión (nunca vinculó) NO se revive.
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
      // Escalonar un poco para no abrir todos los sockets a la vez.
      await new Promise((r) => setTimeout(r, 1500));
    }
    logger.info(`[bot] Sesiones restauradas: ${restored}`);
  }
}

module.exports = new BotManager();
