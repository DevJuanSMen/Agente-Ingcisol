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

// Fija la versión de WhatsApp Web a un HTML conocido-bueno. Sin esto,
// whatsapp-web.js carga la página EN VIVO de WhatsApp Web; cuando WhatsApp
// publica una actualización incompatible, la inyección del store provoca una
// navegación y Puppeteer pierde el contexto → "Execution context was destroyed"
// y la vinculación nunca completa (se queda cargando). El repo wa-version
// mantiene los HTML de cada versión. Si esta versión también deja de funcionar,
// cambia WWEBJS_WEB_VERSION en Railway por una más reciente de:
// https://github.com/wppconnect-team/wa-version/tree/main/html
const WEB_VERSION = process.env.WWEBJS_WEB_VERSION || '2.3000.1040146433-alpha';
const WEB_VERSION_REMOTE_PATH =
  process.env.WWEBJS_WEB_REMOTE_PATH ||
  `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${WEB_VERSION}.html`;

// Nota: NO usar '--single-process' / '--no-zygote'. Con whatsapp-web.js provocan
// "Execution context was destroyed" y que la sesión nunca complete el handshake
// (el QR se regenera en bucle sin conectar). Más estable sin ellos.
const PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  // Reducen consumo de memoria/CPU en contenedores chicos (Railway). Sin esto,
  // varios Chromium a la vez saturan el contenedor y el kernel mata la pestaña
  // en pleno inject → "Execution context was destroyed" / protocol timeout.
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-accelerated-2d-canvas',
  '--mute-audio',
  // Cap la caché en disco para que Chromium no vuelva a llenar el volumen.
  '--disk-cache-size=5242880', // 5 MB
  '--media-cache-size=5242880',
];

// CDP puede tardar más cuando el contenedor está bajo presión; el default (180s)
// a veces expira en pleno inject. Configurable por si hace falta subirlo.
const PROTOCOL_TIMEOUT = Number(process.env.WWEBJS_PROTOCOL_TIMEOUT || 120_000);

class BotManager {
  constructor() {
    this.clients = new Map(); // companyId -> Client
    this.retryTimers = new Map(); // companyId -> Timer
    this.qrTimers = new Map(); // companyId -> Timer (ventana de emparejamiento)
    this.ready = new Set(); // companyIds con el store de WhatsApp Web ya inyectado
    this.pairing = new Map(); // companyId -> { mode, phone, requested } (vinculación en curso)
  }

  _clearQrTimer(companyId) {
    const t = this.qrTimers.get(companyId);
    if (t) { clearTimeout(t); this.qrTimers.delete(companyId); }
  }

  // Ventana de seguridad para vincular (QR o código). NO es para apurar al
  // usuario: es solo para no dejar un Chromium girando indefinidamente si la
  // pestaña fue abandonada. Es generosa (10 min) y se rearma sin reiniciar:
  // mientras el usuario esté vinculando, sigue vivo. Si conecta, se cancela.
  _armPairingTimeout(companyId, client) {
    if (this.qrTimers.has(companyId)) return;
    const k = this._keys(companyId);
    const t = setTimeout(async () => {
      this.qrTimers.delete(companyId);
      if (this.ready.has(companyId)) return; // ya conectó
      logger.warn(`[bot:${companyId}] Vinculación no completada en 10 min; se cierra la sesión de emparejamiento.`);
      try { await client.destroy(); } catch {}
      this.ready.delete(companyId);
      this.clients.delete(companyId);
      this.pairing.delete(companyId);
      await redis.del(k.qr);
      await redis.del(k.pairingCode);
      await redis.set(k.status, 'disconnected');
    }, 600_000);
    this.qrTimers.set(companyId, t);
  }

  // ¿El cliente está realmente listo para enviar? Tener el Client en el mapa no
  // basta: el store interno (window.Store) solo existe tras el evento 'ready'.
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

  _clearLocks(companyId) {
    const sessionDir = path.join(AUTH_BASE, `session-${companyId}`);
    const locks = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    for (const f of locks) {
      try { fs.unlinkSync(path.join(sessionDir, f)); } catch {}
    }
  }

  // Borra la caché REGENERABLE de Chromium dentro de la sesión. NO toca la
  // autenticación de WhatsApp (vive en IndexedDB / Local Storage), así que la
  // empresa sigue vinculada. Chromium acumula estas carpetas sin límite y, en un
  // volumen chico (Railway, 500 MB), lo llena → al no poder escribir el perfil,
  // la pestaña muere en pleno inject: "Execution context was destroyed".
  // Se corre antes de cada init para mantener el volumen bajo control.
  _pruneChromiumCache(companyId) {
    const sessionDir = path.join(AUTH_BASE, `session-${companyId}`);
    const cacheDirs = [
      'Default/Cache',
      'Default/Code Cache',
      'Default/GPUCache',
      'Default/DawnCache',
      'Default/DawnGraphiteCache',
      'Default/DawnWebGPUCache',
      'Default/Service Worker/CacheStorage',
      'Default/Service Worker/ScriptCache',
      'GrShaderCache',
      'ShaderCache',
      'GraphiteDawnCache',
      'component_crx_cache',
      'extensions_crx_cache',
    ];
    for (const d of cacheDirs) {
      try { fs.rmSync(path.join(sessionDir, d), { recursive: true, force: true }); } catch {}
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

  // opts: { mode: 'qr' | 'pairing', phone?: string }
  //  - 'qr'      → escanear código QR (clásico).
  //  - 'pairing' → código de 8 dígitos que el usuario escribe en WhatsApp
  //                (Dispositivos vinculados → Vincular con número de teléfono).
  async initCompany(companyId, opts = {}) {
    if (this.clients.has(companyId)) {
      logger.info(`[bot:${companyId}] Cliente ya activo`);
      return;
    }

    this._clearLocks(companyId);
    this._pruneChromiumCache(companyId);
    const k = this._keys(companyId);

    const mode = opts.mode === 'pairing' ? 'pairing' : 'qr';
    const phone = opts.phone ? String(opts.phone).replace(/\D/g, '') : null;
    // Si pidieron emparejamiento pero no hay teléfono válido, caemos a QR.
    const pairingMode = mode === 'pairing' && phone && phone.length >= 10;
    this.pairing.set(companyId, { mode: pairingMode ? 'pairing' : 'qr', phone, requested: false });

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: companyId, dataPath: AUTH_BASE }),
      puppeteer: { executablePath: CHROMIUM, args: PUPPETEER_ARGS, protocolTimeout: PROTOCOL_TIMEOUT },
      webVersion: WEB_VERSION,
      webVersionCache: {
        type: 'remote',
        remotePath: WEB_VERSION_REMOTE_PATH,
      },
    });

    client.on('qr', async (qr) => {
      const pairing = this.pairing.get(companyId) || {};

      // ── Modo código de emparejamiento ──────────────────────────────────────
      // El evento 'qr' indica que la página de WhatsApp Web ya está lista para
      // vincular; aprovechamos para pedir el código UNA sola vez (si lo pedimos
      // en cada rotación, el código cambiaría constantemente y confunde).
      if (pairing.mode === 'pairing' && pairing.phone && !pairing.requested) {
        pairing.requested = true;
        this.pairing.set(companyId, pairing);
        try {
          const code = await client.requestPairingCode(pairing.phone);
          await redis.set(k.pairingCode, code, 'EX', 600);
          await redis.del(k.qr);
          await redis.set(k.status, 'pairing_waiting');
          logger.info(`[bot:${companyId}] Código de emparejamiento generado`);
        } catch (err) {
          logger.error(`[bot:${companyId}] Error generando código de emparejamiento: ${err.message}. Se usa QR.`);
          pairing.mode = 'qr'; // fallback a QR en la próxima rotación
          this.pairing.set(companyId, pairing);
        }
        this._armPairingTimeout(companyId, client);
        return;
      }
      if (pairing.mode === 'pairing' && pairing.requested) {
        // Código ya emitido; ignoramos las rotaciones de QR para no pisar el código.
        return;
      }

      // ── Modo QR ────────────────────────────────────────────────────────────
      logger.info(`[bot:${companyId}] QR generado`);
      try {
        const dataUrl = await qrcode.toDataURL(qr);
        await redis.set(k.qr, dataUrl, 'EX', 180);
        await redis.set(k.status, 'qr_waiting');
      } catch (err) {
        logger.error(`[bot:${companyId}] Error guardando QR: ${err.message}`);
      }
      this._armPairingTimeout(companyId, client);
    });

    client.on('authenticated', async () => {
      logger.info(`[bot:${companyId}] Autenticado`);
      this._clearQrTimer(companyId);
      await redis.del(k.qr);
      await redis.del(k.pairingCode);
      await redis.set(k.status, 'authenticated');
    });

    client.on('ready', async () => {
      logger.info(`[bot:${companyId}] Listo`);
      this._clearQrTimer(companyId);
      this.pairing.delete(companyId);
      this.ready.add(companyId);
      await redis.del(k.qr);
      await redis.del(k.pairingCode);
      await redis.set(k.status, 'ready');
    });

    client.on('disconnected', async (reason) => {
      logger.warn(`[bot:${companyId}] Desconectado: ${reason}`);
      this.ready.delete(companyId);
      this.clients.delete(companyId);
      this.pairing.delete(companyId);
      this._clearQrTimer(companyId);
      await redis.del(k.pairingCode);
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
      this.pairing.delete(companyId);
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
    this.pairing.delete(companyId);
    // Limpiar QR y estado aunque no hubiera cliente vivo en este worker, para que
    // el panel superadmin refleje el cambio de inmediato.
    await redis.del(k.qr);
    await redis.del(k.pairingCode);
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

  // Tamaño recursivo de un directorio en bytes (tolerante a errores).
  _dirSize(dir) {
    let total = 0;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      try {
        if (e.isDirectory()) total += this._dirSize(p);
        else total += fs.statSync(p).size;
      } catch {}
    }
    return total;
  }

  // Reporta en logs el uso del volumen y qué carpetas lo llenan. Sirve para
  // diagnosticar el "Execution context was destroyed" por disco lleno sin tener
  // que abrir una shell (útil cuando el contenedor está en crash-loop).
  reportDiskUsage() {
    const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
    try {
      const st = fs.statfsSync(AUTH_BASE);
      const totalB = st.blocks * st.bsize;
      const freeB = st.bfree * st.bsize;
      logger.info(`[bot][disk] Volumen ${AUTH_BASE}: total ${mb(totalB)}, libre ${mb(freeB)}, usado ${mb(totalB - freeB)}`);
    } catch (e) {
      logger.warn(`[bot][disk] No se pudo leer statfs de ${AUTH_BASE}: ${e.message}`);
    }
    try {
      const entries = fs.readdirSync(AUTH_BASE, { withFileTypes: true });
      const sized = entries.map((e) => ({ name: e.name, size: this._dirSize(path.join(AUTH_BASE, e.name)) }));
      sized.sort((a, b) => b.size - a.size);
      logger.info(`[bot][disk] Contenido de ${AUTH_BASE} (mayor a menor):`);
      for (const s of sized.slice(0, 20)) logger.info(`[bot][disk]   ${s.name}: ${mb(s.size)}`);
      // Desglose de la sesión más pesada, para ver qué subcarpeta la infla.
      const biggest = sized[0];
      if (biggest && biggest.size > 20 * 1024 * 1024) {
        const base = path.join(AUTH_BASE, biggest.name);
        const walk = (dir, depth) => {
          if (depth > 3) return;
          let subs;
          try { subs = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          const subSized = subs
            .filter((e) => e.isDirectory())
            .map((e) => ({ name: e.name, size: this._dirSize(path.join(dir, e.name)), full: path.join(dir, e.name) }))
            .sort((a, b) => b.size - a.size)
            .slice(0, 6);
          for (const s of subSized) {
            if (s.size < 1024 * 1024) continue;
            logger.info(`[bot][disk]   ${path.relative(AUTH_BASE, s.full)}: ${mb(s.size)}`);
            walk(s.full, depth + 1);
          }
        };
        logger.info(`[bot][disk] Desglose de ${biggest.name}:`);
        walk(base, 0);
      }
    } catch (e) {
      logger.warn(`[bot][disk] No se pudo listar ${AUTH_BASE}: ${e.message}`);
    }
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
    this.reportDiskUsage();
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
