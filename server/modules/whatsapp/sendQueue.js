const { logger } = require('../../shared/utils/logger');
const redis = require('../../shared/redis');
const botManager = require('./bot.manager');

// Cola FIFO POR EMPRESA para los envíos salientes del bot, PERSISTIDA EN REDIS:
// antes era un Map en memoria y cada redeploy del worker (Railway reinicia el
// proceso con cada push) borraba los mensajes pendientes a mitad de cola — así
// se perdían invitaciones a proveedores. Ahora los trabajos viven en listas
// Redis (sendq:<companyId>) y el worker las retoma al arrancar.
//
// El pacing se conserva: cada empresa procesa un mensaje a la vez con delay
// aleatorio (anti-spam de WhatsApp) y hay un espaciado mínimo GLOBAL entre
// envíos de toda la plataforma (la sesión es única). El flag enabled por
// empresa se aplica justo antes de entregar.

const MIN_MS = Number(process.env.WA_SEND_MIN_MS) || 4000;
const MAX_MS = Number(process.env.WA_SEND_MAX_MS) || 10000;
const GLOBAL_GAP_MS = Number(process.env.WA_GLOBAL_GAP_MS) || 2000;
const MAX_RETRIES = 2;
// Cuántas veces esperamos (sin gastar reintentos) a que el cliente esté listo.
const NOT_READY_WAIT_MS = 5000;
const MAX_NOT_READY_WAITS = 60; // ~5 min máximo esperando readiness

const qKey = (companyId) => `sendq:${companyId}`;
const processing = new Map(); // companyId -> boolean (lock por proceso)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randDelay = () => MIN_MS + Math.floor(Math.random() * Math.max(0, MAX_MS - MIN_MS));

// Espaciado mínimo entre envíos de TODA la plataforma (sesión compartida).
let lastGlobalSend = 0;
async function waitGlobalGap() {
  for (;;) {
    const wait = lastGlobalSend + GLOBAL_GAP_MS - Date.now();
    if (wait <= 0) break;
    await sleep(wait + Math.floor(Math.random() * 250));
  }
  lastGlobalSend = Date.now();
}

async function deliver(job) {
  await waitGlobalGap();
  if (job.type === 'doc') {
    await botManager.sendDocument(job.companyId, job.phone, job.base64, job.filename, job.caption);
  } else {
    await botManager.sendMessage(job.companyId, job.phone, job.text);
  }
}

async function processQueue(companyId) {
  if (processing.get(companyId)) return;
  processing.set(companyId, true);
  try {
    for (;;) {
      const raw = await redis.lpop(qKey(companyId));
      if (!raw) break;

      let job;
      try {
        job = JSON.parse(raw);
      } catch {
        logger.warn(`[sendQueue] Trabajo ilegible descartado (empresa ${companyId})`);
        continue;
      }

      // Empresa excluida del bot por el superadmin ('0' explícito): se descarta.
      // Sin flag = habilitada (las empresas nuevas no tienen flag en Redis).
      const enabled = await redis.get(`whatsapp:${companyId}:enabled`).catch(() => null);
      if (enabled === '0') {
        logger.warn(`[sendQueue] Descartado envío a ${job.phone}: bot deshabilitado para empresa ${companyId}`);
        continue;
      }

      // Si el cliente aún no está listo, se devuelve a la cola SIN consumir
      // reintentos: el bot puede tardar en (re)conectar tras un corte o deploy.
      if (!botManager.isReady()) {
        job.notReadyWaits = (job.notReadyWaits || 0) + 1;
        if (job.notReadyWaits <= MAX_NOT_READY_WAITS) {
          await redis.rpush(qKey(companyId), JSON.stringify(job));
          await sleep(NOT_READY_WAIT_MS);
          continue;
        }
        logger.error(`[sendQueue] Descartado envío a ${job.phone}: el cliente WhatsApp nunca estuvo listo`);
        continue;
      }

      try {
        await deliver(job);
        const restantes = await redis.llen(qKey(companyId)).catch(() => 0);
        logger.info(`[sendQueue] Enviado ${job.type} a ${job.phone} (empresa ${companyId}) — cola: ${restantes}`);
      } catch (err) {
        job.retries = (job.retries || 0) + 1;
        if (job.retries <= MAX_RETRIES) {
          logger.warn(`[sendQueue] Falló envío a ${job.phone} (intento ${job.retries}): ${err.message} — reencolando`);
          await redis.rpush(qKey(companyId), JSON.stringify(job));
        } else {
          logger.error(`[sendQueue] Descartado envío a ${job.phone} tras ${job.retries} intentos: ${err.message}`);
        }
      }

      const pendientes = await redis.llen(qKey(companyId)).catch(() => 0);
      if (pendientes) await sleep(randDelay());
    }
  } catch (err) {
    logger.error(`[sendQueue] Error procesando cola de ${companyId}: ${err.message}`);
  } finally {
    processing.set(companyId, false);
  }
}

const enqueue = (companyId, job) => {
  redis
    .rpush(qKey(companyId), JSON.stringify(job))
    .then(() => processQueue(companyId))
    .catch((err) => logger.error(`[sendQueue] No se pudo encolar a ${job.phone}: ${err.message}`));
};

const enqueueText = (companyId, phone, text) => {
  if (!phone || !text) return;
  enqueue(companyId, { type: 'text', companyId, phone, text });
};

const enqueueDocument = (companyId, phone, base64, filename, caption) => {
  if (!phone || !base64) return;
  enqueue(companyId, { type: 'doc', companyId, phone, base64, filename, caption });
};

// Retoma las colas que quedaron con trabajos pendientes de un proceso anterior
// (deploy/reinicio). Se llama al arrancar el worker.
const resumeQueues = async () => {
  try {
    const keys = await redis.keys('sendq:*');
    for (const key of keys) {
      const pendientes = await redis.llen(key).catch(() => 0);
      if (!pendientes) continue;
      const companyId = key.slice('sendq:'.length);
      logger.info(`[sendQueue] Retomando cola de ${companyId}: ${pendientes} mensaje(s) pendiente(s)`);
      processQueue(companyId);
    }
  } catch (err) {
    logger.error(`[sendQueue] Error retomando colas: ${err.message}`);
  }
};

module.exports = { enqueueText, enqueueDocument, resumeQueues };
