const STOPWORDS = new Set([
  'para', 'como', 'pero', 'sobre', 'entre', 'desde', 'hasta', 'donde', 'cuando',
  'quien', 'cual', 'este', 'esta', 'estos', 'estas', 'tras', 'ante', 'bajo',
  'contra', 'segun', 'durante', 'mediante', 'tambien', 'ademas', 'porque',
  'aunque', 'mientras', 'hacer', 'tiene', 'tienen', 'fueron', 'siendo', 'noticia',
  'noticias', 'hoy', 'ano', 'anos', 'dia', 'dias', 'republica', 'dominicana'
]);

const GEO_SEEDS = {
  Nacionales: ['República Dominicana', 'Santo Domingo', 'actualidad RD'],
  Deportes: ['Deportes RD', 'LIDOM', 'MLB', 'atletas dominicanos'],
  Economía: ['Economía dominicana', 'finanzas RD', 'mercados'],
  Internacionales: ['Noticias internacionales', 'Caribe', 'mundo hoy'],
  Tecnología: ['Tecnología RD', 'innovación digital', 'IA'],
  Espectáculos: ['Espectáculos RD', 'farándula dominicana', 'cultura']
};

function extraerPalabrasClave(texto, limite = 8) {
  const limpio = String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');

  const conteo = new Map();
  for (const w of limpio.split(/\s+/)) {
    if (w.length < 4 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    conteo.set(w, (conteo.get(w) || 0) + 1);
  }

  return [...conteo.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite)
    .map(([k]) => k);
}

function generarPaqueteSEO({ titulo = '', contenido = '', categoria = 'Nacionales', keywords = '' } = {}) {
  try {
    const tit = String(titulo || '').trim();
    const cuerpo = String(contenido || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const seeds = GEO_SEEDS[categoria] || GEO_SEEDS.Nacionales;
    const prevKw = String(keywords || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const extraidas = extraerPalabrasClave(`${tit} ${tit} ${cuerpo.slice(0, 1200)}`, 8);
    const todasKw = [...new Set([...prevKw, ...seeds, ...extraidas])].slice(0, 12);

    const baseDesc = cuerpo.length >= 60 ? cuerpo.slice(0, 152).trim() : `${tit} — Cobertura actualizada en El Farol al Día.`;
    const seoDescription = baseDesc.length > 155 ? `${baseDesc.slice(0, 152).trim()}...` : baseDesc;
    const altText = `${tit.slice(0, 85)} | ${categoria} - El Farol al Día (XML Service Technology)`.slice(0, 250);

    return {
      ok: true,
      seoDescription,
      seoKeywords: todasKw.join(', '),
      tags: todasKw.slice(0, 6),
      altText,
    };
  } catch (err) {
    return {
      ok: false,
      seoDescription: String(titulo || '').slice(0, 155),
      seoKeywords: String(keywords || categoria || 'Noticias RD'),
      tags: [categoria],
      altText: `${String(titulo || '').slice(0, 80)} - El Farol al Día`,
      error: err.message,
    };
  }
}

module.exports = {
  generarPaqueteSEO,
  extraerPalabrasClave,
};
