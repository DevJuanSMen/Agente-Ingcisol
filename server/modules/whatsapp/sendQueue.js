const { logger } = require('../../shared/utils/logger');
const botManager = require('./bot.manager');

// Cola FIFO única para TODOS los envíos salientes del bot. Procesa un mensaje
// a la vez con un delay aleatorio entre cada uno, para que WhatsApp no detecte
// ráfagas de mensajes como spam y bloquee la sesión.

const MIN_MS = Number(process.env.WA_SEND_MIN_MS) || 4000;
const MAX_MS = Number(process.env.WA_SEND_MAX_MS) || 10000;
const MAX_RETRIES = 2;

const queue = [];
let processing = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randDelay = () => MIN_MS + Math.floor(Math.random() * Math.max(0, MAX_MS - MIN_MS));

async function deliver(job) {
  if (job.type === 'doc') {
    await botManager.sendDocument(job.companyId, job.phone, job.base64, job.filename, job.caption);
  } else {
    await botManager.sendMessage(job.companyId, job.phone, job.text);
  }
}

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      await deliver(job);
      logger.info(
        `[sendQueue] Enviado ${job.type} a ${job.phone} (empresa ${job.companyId}) — cola: ${queue.length}`
      );
    } catch (err) {
      job.retries = (job.retries || 0) + 1;
      if (job.retries <= MAX_RETRIES) {
        logger.warn(
          `[sendQueue] Falló envío a ${job.phone} (intento ${job.retries}): ${err.message} — reencolando`
        );
        queue.push(job);
      } else {
        logger.error(`[sendQueue] Descartado envío a ${job.phone} tras ${job.retries} intentos: ${err.message}`);
      }
    }
    if (queue.length) await sleep(randDelay());
  }
  processing = false;
}

const enqueueText = (companyId, phone, text) => {
  if (!phone || !text) return;
  queue.push({ type: 'text', companyId, phone, text });
  processQueue();
};

const enqueueDocument = (companyId, phone, base64, filename, caption) => {
  if (!phone || !base64) return;
  queue.push({ type: 'doc', companyId, phone, base64, filename, caption });
  processQueue();
};

const queueSize = () => queue.length;

module.exports = { enqueueText, enqueueDocument, queueSize };
