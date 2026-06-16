const Redis = require('ioredis');
const { logger } = require('../../shared/utils/logger');

const CHANNEL = 'whatsapp:cmd';

// Crea una conexión Redis separada para subscribe (ioredis no permite mezclar)
const createSubClient = () =>
  new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: false,
    retryStrategy: (t) => Math.min(t * 200, 5000),
  });

// Usa el cliente Redis principal del API para publicar comandos al worker
const publishCommand = async (redis, action, payload = {}) => {
  const msg = JSON.stringify({ action, ...payload });
  await redis.publish(CHANNEL, msg);
  logger.info(`[ipc] Publicado: ${action}`, payload);
};

// El worker llama a esto para escuchar comandos
const subscribeToCommands = (handler) => {
  const sub = createSubClient();
  sub.subscribe(CHANNEL, (err) => {
    if (err) logger.error('[ipc] Error al suscribirse:', err.message);
    else logger.info('[ipc] Suscrito a canal ' + CHANNEL);
  });
  sub.on('message', (_channel, msg) => {
    try {
      const cmd = JSON.parse(msg);
      handler(cmd);
    } catch (err) {
      logger.error('[ipc] Mensaje inválido:', err.message);
    }
  });
  return sub;
};

module.exports = { publishCommand, subscribeToCommands, CHANNEL };
