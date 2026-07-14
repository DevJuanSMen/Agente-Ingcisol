const prisma = require('../../shared/db');
const { logger } = require('../../shared/utils/logger');

// Registro de cada intento de interpretación IA del bot (BotParseLog): entrada
// cruda del proveedor, salida del LLM y si se logró extraer algo. Es la fuente
// para depurar "el bot no me entendió" sin adivinar. Nunca rompe el flujo.
const logParse = async ({ companyId = null, supplierId = null, contexto, entrada, salida = null, exito = false, error = null }) => {
  try {
    await prisma.botParseLog.create({
      data: {
        companyId,
        supplierId,
        contexto,
        entrada: String(entrada || '').slice(0, 4000),
        salida: salida ?? undefined,
        exito,
        error: error ? String(error).slice(0, 500) : null,
      },
    });
  } catch (err) {
    logger.warn(`[bot.parselog] No se pudo guardar BotParseLog: ${err.message}`);
  }
};

module.exports = { logParse };
