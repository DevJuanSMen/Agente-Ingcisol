const { PrismaClient } = require('@prisma/client');
const { logger } = require('./utils/logger');

const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
  ],
});

if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e) => {
    logger.debug(`Prisma query: ${e.query} — ${e.duration}ms`);
  });
}

prisma.$on('error', (e) => {
  logger.error('Prisma error:', e.message);
});

module.exports = prisma;
