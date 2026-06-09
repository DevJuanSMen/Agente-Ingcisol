const Redis = require('ioredis');
const { logger } = require('./utils/logger');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
  retryStrategy: (times) => Math.min(times * 200, 5000),
});

redis.on('connect', () => logger.info('Redis conectado'));
redis.on('error', (err) => logger.error('Redis error:', err.message));

module.exports = redis;
