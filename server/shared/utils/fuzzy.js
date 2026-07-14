// Similitud difusa de textos cortos (descripciones de materiales).
// Coeficiente de Dice sobre bigramas, con normalización agresiva: minúsculas,
// sin tildes, sin signos y sin palabras vacías. Suficiente para casar
// "cemento gris 50kg" con "tengo el cemento a 30mil" sin dependencias externas.

const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'para', 'por', 'con',
  'y', 'o', 'en', 'a', 'al', 'x',
]);

const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // tildes (marcas diacríticas tras NFD)
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .join(' ');

const bigrams = (s) => {
  const set = new Map();
  const clean = s.replace(/\s+/g, ' ');
  for (let i = 0; i < clean.length - 1; i++) {
    const bg = clean.slice(i, i + 2);
    set.set(bg, (set.get(bg) || 0) + 1);
  }
  return set;
};

// Coeficiente de Dice ∈ [0,1]: 1 = idénticos (tras normalizar), 0 = nada en común.
const similarity = (a, b) => {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let overlap = 0;
  let totalA = 0;
  let totalB = 0;
  for (const [, n] of ba) totalA += n;
  for (const [, n] of bb) totalB += n;
  for (const [bg, n] of ba) {
    if (bb.has(bg)) overlap += Math.min(n, bb.get(bg));
  }
  return totalA + totalB === 0 ? 0 : (2 * overlap) / (totalA + totalB);
};

// Índice del mejor match de `query` dentro de `candidates` (array de strings),
// o -1 si ninguno alcanza el umbral.
const bestMatch = (query, candidates, threshold = 0.35) => {
  let best = -1;
  let bestScore = threshold;
  candidates.forEach((c, i) => {
    const score = similarity(query, c);
    if (score >= bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
};

module.exports = { similarity, bestMatch, normalize };
