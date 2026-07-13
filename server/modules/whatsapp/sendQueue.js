const { logger } = require('../../shared/utils/logger');
const botManager = require('./bot.manager');

// Cola FIFO POR EMPRESA para los envíos salientes del bot. Cada empresa procesa
// un mensaje a la vez con un delay aleatorio entre cada uno, para que WhatsApp
// no detecte ráfagas como spam y bloquee la sesión.
//
// Es por empresa (no global) porque cada companyId tiene su propio número/sesión:
// el anti-spam de una no aplica a la otra, y —clave en multi-empresa— una empresa
// con el bot caído NO debe frenar los envíos de las demás.

const MIN_MS = Number(process.env.WA_SEND_MIN_MS) || 4000;
const MAX_MS = Number(process.env.WA_SEND_MAX_MS) || 10000;
const MAX_RETRIES = 2;
// Cuántas veces esperamos (sin gastar reintentos) a que el cliente esté listo.
const NOT_READY_WAIT_MS = 5000;
const MAX_NOT_READY_WAITS = 60; // ~5 min máximo esperando readiness

const queues = new Map(); // companyId -> { jobs: [], processing: boolean }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randDelay = () => MIN_MS + Math.floor(Math.random() * Math.max(0, MAX_MS - MIN_MS));

const queueFor = (companyId) => {
  if (!queues.has(companyId)) queues.set(companyId, { jobs: [], processing: false });
  return queues.get(companyId);
};

async function deliver(job) {
  if (job.type === 'doc') {
    await botManager.sendDocument(job.companyId, job.phone, job.base64, job.filename, job.caption);
  } else {
    await botManager.sendMessage(job.companyId, job.phone, job.text);
  }
}

async function processQueue(companyId) {
  const q = queueFor(companyId);
  if (q.processing) return;
  q.processing = true;
  while (q.jobs.length) {
    const job = q.jobs.shift();

    // Si el cliente aún no está listo, esperamos sin consumir reintentos: el
    // bot puede tardar en conectar el socket o reconectar tras un corte.
    if (!botManager.isReady(companyId)) {
      job.notReadyWaits = (job.notReadyWaits || 0) + 1;
      if (job.notReadyWaits <= MAX_NOT_READY_WAITS) {
        q.jobs.push(job);
        await sleep(NOT_READY_WAIT_MS);
        continue;
      }
      logger.error(
        `[sendQueue] Descartado envío a ${job.phone}: cliente de empresa ${companyId} nunca estuvo listo`
      );
      continue;
    }

    try {
      await deliver(job);
      logger.info(
        `[sendQueue] Enviado ${job.type} a ${job.phone} (empresa ${companyId}) — cola: ${q.jobs.length}`
      );
    } catch (err) {
      job.retries = (job.retries || 0) + 1;
      if (job.retries <= MAX_RETRIES) {
        logger.warn(
          `[sendQueue] Falló envío a ${job.phone} (intento ${job.retries}): ${err.message} — reencolando`
        );
        q.jobs.push(job);
      } else {
        logger.error(`[sendQueue] Descartado envío a ${job.phone} tras ${job.retries} intentos: ${err.message}`);
      }
    }
    if (q.jobs.length) await sleep(randDelay());
  }
  q.processing = false;
}

const enqueueText = (companyId, phone, text) => {
  if (!phone || !text) return;
  queueFor(companyId).jobs.push({ type: 'text', companyId, phone, text });
  processQueue(companyId);
};

const enqueueDocument = (companyId, phone, base64, filename, caption) => {
  if (!phone || !base64) return;
  queueFor(companyId).jobs.push({ type: 'doc', companyId, phone, base64, filename, caption });
  processQueue(companyId);
};

const queueSize = () =>
  [...queues.values()].reduce((a, q) => a + q.jobs.length, 0);

module.exports = { enqueueText, enqueueDocument, queueSize };
