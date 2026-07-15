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
const { routeIncoming, logParse } = require('./bot.router.msg');
const { normalizeWhatsapp } = require('../../shared/utils/phone');

// Sesión ÚNICA de Baileys para toda la plataforma: un solo número/QR responde a
// todas las empresas (el ruteo por empresa se hace por el número del remitente,
// ver bot.router.msg.js). Reutilizamos la misma variable de entorno para no
// cambiar el mount del volumen; la sesión vive en la subcarpeta baileys-global
// (las viejas baileys-<companyId> del modelo multi-sesión se migran solas si
// hay exactamente una, o pueden borrarse a mano).
const AUTH_BASE = process.env.WWEBJS_AUTH_PATH || '/app/.wwebjs_auth';
const SESSION_DIR = 'baileys-global';

// Llaves Redis del estado global de la sesión. El flag por empresa
// whatsapp:<companyId>:enabled se conserva como interruptor del superadmin.
const K = {
  qr: 'whatsapp:global:qr',
  status: 'whatsapp:global:status',
};
const enabledKey = (companyId) => `whatsapp:${companyId}:enabled`;

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
    this.sock = null;
    this.retryTimer = null;
    this.qrTimer = null; // ventana de vinculación por QR
    this.ready = false; // connection === 'open'
    this.stopping = false; // cierre a propósito
    this.initializing = false; // guard: evita 2 init concurrentes (doble clic)
  }

  _clearQrTimer() {
    if (this.qrTimer) { clearTimeout(this.qrTimer); this.qrTimer = null; }
  }

  // Ventana de seguridad para vincular por QR: 10 min. No apura al usuario; solo
  // evita dejar un socket girando si se abandona la pestaña. Si conecta, se
  // cancela (en connection === 'open').
  _armPairingTimeout(sock) {
    if (this.qrTimer) return;
    this.qrTimer = setTimeout(async () => {
      this.qrTimer = null;
      if (this.ready) return; // ya conectó
      logger.warn('[bot] Vinculación no completada en 10 min; se cierra la sesión.');
      this.stopping = true;
      try { sock.end(undefined); } catch {}
      this.ready = false;
      this.sock = null;
      await redis.del(K.qr);
      await redis.set(K.status, 'disconnected');
    }, 600_000);
  }

  // ¿El cliente está conectado y listo para enviar?
  isReady() {
    return this.ready;
  }

  _sessionDir() {
    return path.join(AUTH_BASE, SESSION_DIR);
  }

  // ¿Existe una sesión ya guardada (número vinculado antes)?
  _hasSession() {
    try {
      return fs.existsSync(path.join(this._sessionDir(), 'creds.json'));
    } catch {
      return false;
    }
  }

  // Borra la sesión guardada. Necesario tras LOGOUT: las credenciales quedan
  // inválidas; el siguiente init genera un QR nuevo para re-vincular.
  _clearSession() {
    try { fs.rmSync(this._sessionDir(), { recursive: true, force: true }); } catch {}
  }

  // Migración desde el modelo multi-sesión: si no hay sesión global pero existe
  // EXACTAMENTE una sesión legacy baileys-<companyId>, se renombra a global (la
  // empresa piloto conserva su vinculación sin re-escanear). Con 0 o ≥2 sesiones
  // legacy no se migra nada: el superadmin escanea el QR desde el panel.
  _migrateLegacySession() {
    try {
      if (this._hasSession()) return;
      if (!fs.existsSync(AUTH_BASE)) return;
      const legacy = fs
        .readdirSync(AUTH_BASE)
        .filter((d) => d.startsWith('baileys-') && d !== SESSION_DIR)
        .filter((d) => fs.existsSync(path.join(AUTH_BASE, d, 'creds.json')));
      if (legacy.length === 1) {
        fs.renameSync(path.join(AUTH_BASE, legacy[0]), this._sessionDir());
        logger.info(`[bot] Sesión migrada: ${legacy[0]} → ${SESSION_DIR}`);
      } else if (legacy.length > 1) {
        logger.warn(`[bot] ${legacy.length} sesiones legacy encontradas; no se migra ninguna (re-vincular por QR).`);
      }
    } catch (err) {
      logger.error(`[bot] Error migrando sesión legacy: ${err.message}`);
    }
  }

  // Programa reintentos de reconexión con backoff (15s → 30s → … cap 5 min),
  // SIN rendirse mientras exista sesión guardada: un deploy de Railway reinicia
  // el worker y un único intento fallido dejaba el bot muerto hasta acción
  // manual. Sin sesión no se reintenta (requiere QR). El backoff se resetea al
  // conectar ('open').
  async _scheduleReconnect(delayMs) {
    if (this.retryTimer) return;
    if (!this._hasSession()) {
      logger.info('[bot] Sin sesión guardada; no se reconecta solo (requiere QR manual).');
      return;
    }
    const delay = delayMs ?? this.retryDelay ?? 15_000;
    this.retryDelay = Math.min((this.retryDelay ?? 15_000) * 2, 300_000);
    logger.info(`[bot] Reintento de conexión en ${Math.round(delay / 1000)}s`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      logger.info('[bot] Reintentando reconexión...');
      this.init().catch((err) => {
        logger.error(`[bot] Reintento de conexión falló: ${err.message}`);
        this._scheduleReconnect();
      });
    }, delay);
  }

  // Inicia (o reanuda) la sesión global. La vinculación es siempre por QR, que se
  // genera bajo petición desde el panel superadmin (botón "Generar QR").
  async init() {
    if (this.sock) {
      logger.info('[bot] Cliente ya activo');
      return;
    }
    // Dos llamadas concurrentes (doble clic en "Generar QR" + reconexión 515)
    // crearían dos sockets sobre la misma sesión → corrupción / QR en bucle.
    if (this.initializing) {
      logger.info('[bot] Init ya en curso; se ignora la llamada duplicada');
      return;
    }
    this.initializing = true;

    try {
      // 'connecting' mientras se abre el socket: el panel hace polling desde ya.
      await redis.set(K.status, 'connecting', 'EX', 180);
      this._migrateLegacySession();
      const dir = this._sessionDir();
      fs.mkdirSync(dir, { recursive: true });

      const { state, saveCreds } = await useMultiFileAuthState(dir);

      // Usa la versión de protocolo actual de WhatsApp Web (con fallback al default
      // que trae Baileys si no hay red para consultarla).
      let version;
      try {
        ({ version } = await fetchLatestBaileysVersion());
      } catch (err) {
        logger.warn(`[bot] No se pudo obtener la versión de WA; se usa el default de Baileys: ${err.message}`);
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

      this.sock = sock;
      this.stopping = false;
      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // ── QR ──────────────────────────────────────────────────────────────────
        if (qr) {
          logger.info('[bot] QR generado');
          try {
            const dataUrl = await qrcode.toDataURL(qr);
            await redis.set(K.qr, dataUrl, 'EX', 180);
            await redis.set(K.status, 'qr_waiting');
          } catch (err) {
            logger.error(`[bot] Error guardando QR: ${err.message}`);
          }
          this._armPairingTimeout(sock);
        }

        // ── Conectado ─────────────────────────────────────────────────────────────
        if (connection === 'open') {
          logger.info('[bot] Listo');
          this._clearQrTimer();
          this.ready = true;
          this.retryDelay = null; // resetear el backoff de reconexión
          await redis.del(K.qr);
          await redis.set(K.status, 'ready');
        }

        // ── Cerrado ───────────────────────────────────────────────────────────────
        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          const intentional = this.stopping;
          logger.warn(`[bot] Conexión cerrada (code ${statusCode ?? 'n/a'})`);

          this.ready = false;
          this.sock = null;
          this._clearQrTimer();
          await redis.set(K.status, 'disconnected');

          if (intentional) {
            this.stopping = false;
            return; // cierre a propósito (destroy / timeout de vinculación)
          }

          // LOGOUT = la sesión fue cerrada/invalidada desde el teléfono. Las
          // credenciales ya no sirven: se limpian. NO se regenera QR solo: el
          // superadmin pulsa "Generar QR" cuando quiera re-vincular.
          if (loggedOut) {
            this._clearSession();
            await redis.del(K.qr);
            logger.warn('[bot] Sesión cerrada (LOGOUT). Re-vincular pulsando "Generar QR".');
            return;
          }

          // 440 = connectionReplaced: OTRA instancia abrió la misma sesión (pasa
          // durante los deploys de Railway, cuando el worker viejo y el nuevo
          // conviven unos segundos). Este proceso NO debe pelear por reconectar:
          // el que se queda con la sesión es el proceso nuevo.
          if (statusCode === DisconnectReason.connectionReplaced) {
            logger.warn('[bot] Sesión tomada por otra instancia (deploy en curso); este proceso cede sin reintentar.');
            return;
          }

          // 515 = restartRequired: NO es un fallo, es un paso obligatorio del login
          // de Baileys (tras escanear/emparejar la conexión se cierra y hay que
          // re-abrirla con las credenciales ya guardadas). Se reconecta de INMEDIATO
          // y sin condiciones (las credenciales acaban de guardarse en creds.update).
          if (statusCode === DisconnectReason.restartRequired) {
            logger.info('[bot] Restart requerido (515); reconectando de inmediato...');
            this.init().catch((err) => {
              logger.error(`[bot] Error en reconexión 515: ${err.message}`);
              this._scheduleReconnect();
            });
            return;
          }

          await this._scheduleReconnect();
        }
      });

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return; // solo mensajes nuevos, no sincronización
        for (const m of messages) {
          this._handleIncoming(m).catch((err) =>
            logger.error(`[bot] Error procesando mensaje: ${err.message}`)
          );
        }
      });
      // El estado queda en 'connecting' hasta que llegue el QR (qr_waiting) o la
      // conexión abra (ready); si falla, el catch de abajo lo deja 'disconnected'.
    } catch (err) {
      this.sock = null;
      await redis.set(K.status, 'disconnected').catch(() => {});
      throw err;
    } finally {
      this.initializing = false;
    }
  }

  // Procesa un mensaje entrante. La identificación del remitente y el ruteo por
  // empresa viven en bot.router.msg.js (el número decide la empresa y el rol).
  async _handleIncoming(m) {
    if (!m.message || m.key?.fromMe) return;
    const jid = m.key?.remoteJid || '';
    if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;

    const text = extractText(m).trim();
    if (!text) return;

    // Número del remitente. Con el nuevo direccionamiento LID de WhatsApp, el jid
    // puede venir como @lid; en ese caso Baileys expone el número real en un campo
    // alterno (remoteJidAlt/participantAlt) o en su mapeo LID→número persistente.
    let senderJid = jid;
    if (jid.endsWith('@lid')) {
      senderJid = m.key.remoteJidAlt || m.key.participantAlt || '';
      if (!senderJid || senderJid.endsWith('@lid')) {
        try {
          const pn = await this.sock?.signalRepository?.lidMapping?.getPNForLID(jid);
          if (pn) senderJid = pn;
        } catch (err) {
          logger.warn(`[bot] Fallo consultando mapeo LID de ${jid}: ${err.message}`);
        }
      }
      if (!senderJid || senderJid.endsWith('@lid')) {
        // Sin número real no se puede rutear; responder "no estás registrado" a un
        // usuario registrado (solo porque llegó como LID) es peor que callar.
        logger.warn(`[bot] No se pudo resolver el número real del LID ${jid}; mensaje ignorado.`);
        await logParse({
          contexto: 'ROUTE_LID_FAIL',
          entrada: text.slice(0, 2000),
          exito: false,
          error: `LID sin resolver: ${jid}`,
        }).catch(() => {});
        return;
      }
    }
    // El jid puede traer sufijo de dispositivo (":12"); se corta ANTES de extraer
    // dígitos para que no se peguen al número.
    const phone = senderJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    logger.info(`[bot] Mensaje de: ${phone} (jid: ${jid})`);

    // Un error en el ruteo/IA no puede terminar en silencio: se registra en
    // BotParseLog (visible en el panel superadmin) y se avisa al remitente.
    let reply;
    try {
      reply = await routeIncoming(text, phone);
    } catch (err) {
      logger.error(`[bot] Error ruteando mensaje de ${phone}: ${err.message}`);
      await logParse({
        contexto: 'ROUTE_ERROR',
        entrada: text.slice(0, 2000),
        exito: false,
        error: `${err.message} (phone: ${phone})`,
      }).catch(() => {});
      reply =
        '⚠️ Estoy teniendo un problema técnico para procesar tu mensaje. ' +
        'Ya quedó registrado para revisión; intenta de nuevo en unos minutos.';
    }
    if (reply) await this._reply(jid, reply, m);
  }

  // Responde citando el mensaje original.
  async _reply(jid, text, quoted) {
    if (!this.sock) return;
    await this.sock.sendMessage(jid, { text }, quoted ? { quoted } : undefined);
  }

  // Detiene el bot SIN invalidar la sesión (se puede reconectar luego sin
  // re-escanear). Para invalidar del todo, se cierra sesión desde el teléfono
  // (eso dispara LOGOUT y limpia la sesión).
  async destroy() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this._clearQrTimer();

    if (this.sock) {
      this.stopping = true;
      try { this.sock.end(undefined); } catch {}
    }
    this.ready = false;
    this.sock = null;
    // Limpiar QR y estado aunque no hubiera cliente vivo en este worker, para que
    // el panel superadmin refleje el cambio de inmediato.
    await redis.del(K.qr);
    await redis.set(K.status, 'disconnected');
    logger.info('[bot] Destruido');
  }

  // Envía un mensaje de texto. El companyId es solo trazabilidad (la sesión es
  // única); el gate por empresa (flag enabled) lo aplica sendQueue antes de llegar acá.
  async sendMessage(companyId, phone, text) {
    if (!this.sock) throw new Error('Sin cliente WhatsApp activo');
    if (!this.ready) throw new Error('Cliente WhatsApp aún no está listo');
    return this.sock.sendMessage(jidFor(phone), { text });
  }

  // Envía un documento (PDF en base64).
  async sendDocument(companyId, phone, base64, filename, caption) {
    if (!this.sock) throw new Error('Sin cliente WhatsApp activo');
    if (!this.ready) throw new Error('Cliente WhatsApp aún no está listo');
    return this.sock.sendMessage(jidFor(phone), {
      document: Buffer.from(base64, 'base64'),
      mimetype: 'application/pdf',
      fileName: filename || 'documento.pdf',
      caption: caption || undefined,
    });
  }

  // Re-inicializa al arrancar el worker si ya hay una sesión vinculada (o una
  // legacy migrable). Sin sesión no se hace nada: el QR se genera desde el panel.
  async restoreSession() {
    this._migrateLegacySession();
    if (!this._hasSession()) {
      logger.info('[bot] Sin sesión global guardada; se espera vinculación por QR desde el panel superadmin.');
      await redis.set(K.status, 'disconnected');
      return;
    }
    logger.info('[bot] Restaurando sesión global');
    try {
      await this.init();
    } catch (err) {
      // Un fallo transitorio al arrancar (red/DNS del contenedor recién creado)
      // no debe dejar el bot muerto: se reintenta con backoff.
      logger.error(`[bot] Fallo restaurando sesión: ${err.message}`);
      await this._scheduleReconnect();
    }
  }
}

module.exports = new BotManager();
module.exports.GLOBAL_KEYS = K;
module.exports.enabledKey = enabledKey;
