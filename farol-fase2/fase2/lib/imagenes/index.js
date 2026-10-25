'use strict';
/**
 * obtenerImagenLimpia() — reemplazo de obtenerImagenV40().
 * Devuelve la misma forma {urlFinal, urlOriginal, nombre, fuente, procesada} + {licencia, credito, paginaFuente, licenciaUrl}.
 */
const crypto = require('crypto');
const llm = require('../llm');
const { buscar } = require('./buscador');
const dep = require('./depurador');
const { aplicarMarca, tarjetaMarca } = require('./marca');
const almacen = require('./almacen');

const BASE_URL = (process.env.BASE_URL || 'https://elfarolaldia.com.do').replace(/\/$/, '');
const UA = process.env.IMG_USER_AGENT || 'ElFarolAlDia/2.0 (https://elfarolaldia.com; contacto@elfarolaldia.com)';
const STOP = new Set('de la el los las un una y en a por con para del al se su sus que es lo como mas pero sobre entre tras the of and in to for on at by with from an is'.split(' '));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const tokens = s => norm(s).split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t));

const DEFECTO = { Nacionales: 'Santo Domingo Dominican Republic', Deportes: 'Dominican Republic sports', Internacionales: 'international news',
    'Economía': 'Dominican Republic economy', 'Tecnología': 'technology', 'Espectáculos': 'Dominican Republic music festival' };

/** Consultas: Llama (entidades + términos en inglés) con respaldo heurístico si el LLM no está. */
async function construirConsultas({ titulo, contenido, categoria, personaQuery }) {
    const q = [];
    if (personaQuery) q.push(personaQuery);
    try {
        if (llm.disponible()) {
            const j = await llm.generarJSON(
`Titular: "${titulo}"\nInicio: "${(contenido || '').slice(0, 400)}"\n` +
`Devuelve SOLO JSON: {"consultas":["..."]} con 3 consultas (2 a 5 palabras) para buscar una FOTO REAL en Wikimedia Commons: ` +
`1) la persona/lugar/institución concreta del titular, 2) el mismo tema en inglés, 3) un lugar o escena genérica relacionada. No inventes nombres.`,
                { cacheSeg: 6 * 3600, maxTokens: 300 });
            (j.consultas || []).forEach(c => typeof c === 'string' && c.trim() && q.push(c.trim()));
        }
    } catch (e) { console.warn('   ⚠️ [img] consultas por LLM fallaron:', e.message); }
    // Heurística: secuencias de palabras capitalizadas del titular (entidades)
    (titulo.match(/(?:[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:\s+(?:de|del|la|los)\s+)?){1,4}/g) || []).map(s => s.trim()).filter(s => s.length > 4).slice(0, 2).forEach(s => q.push(s));
    q.push(DEFECTO[categoria] || 'Dominican Republic');
    return [...new Set(q)].slice(0, 5);
}

/** Relevancia: fracción de términos de la consulta presentes en título+descripción+categorías de la foto. */
function relevancia(c, consulta) {
    const tq = tokens(consulta); if (!tq.length) return 0;
    const ts = new Set(tokens(`${c.titulo} ${c.descripcion} ${(c.categorias || []).join(' ')}`));
    return tq.filter(t => ts.has(t)).length / tq.length;
}

async function obtenerImagenLimpia({ titulo, contenido, categoria, subtema, personaQuery }) {
    console.log(`\n   🖼️ [F2] Buscando foto real licenciada → "${titulo.slice(0, 55)}"`);
    const consultas = await construirConsultas({ titulo, contenido, categoria, personaQuery });
    console.log(`   🔎 consultas: ${consultas.join(' | ')}`);
    const MIN_REL = parseFloat(process.env.IMG_MIN_RELEVANCIA || '0.5');

    for (const consulta of consultas) {
        let cands = [];
        try { cands = await buscar(consulta); } catch (e) { console.warn('   ⚠️ [img] búsqueda:', e.message); continue; }
        const ranking = cands
            .map(c => ({ c, meta: dep.evaluarMetadatos(c), rel: relevancia(c, consulta) }))
            .filter(x => { if (!x.meta.ok) { console.log(`      ✗ ${x.c.id}: ${x.meta.motivo}`); return false; } return x.rel >= MIN_REL; })
            .map(x => ({ ...x, score: x.rel * 10 + (x.c.licencia.tipo === 'cc0' ? 1 : 0) + ((x.c.proveedor || '').startsWith('Wikimedia') ? 0.5 : 0) + Math.min((x.c.anchoOriginal || 0) / 4000, 1) }))
            .sort((a, b) => b.score - a.score).slice(0, 6);

        for (const { c, rel } of ranking) {
            try {
                const dup = await dep.yaUsada(c, null); if (dup) { console.log(`      ✗ ${c.id}: ${dup}`); continue; }
                const buf = await dep.descargar(c.urlDescarga, UA);
                const ins = await dep.inspeccionar(buf);
                if (!ins.ok) { console.log(`      ✗ ${c.id}: ${ins.motivo}`); continue; }
                const dup2 = await dep.yaUsada(c, ins.huella); if (dup2) { console.log(`      ✗ ${c.id}: ${dup2}`); continue; }

                const { buffer, marcada } = await aplicarMarca(buf);
                const nombre = `efd-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
                const donde = await almacen.guardar(nombre, buffer, { fuenteId: c.id, proveedor: c.proveedor, autor: c.autor, licencia: c.licencia.etiqueta, paginaFuente: c.urlPagina, consulta });
                await dep.marcarUsada(c, ins.huella);
                console.log(`   ✅ ${c.id} (${c.licencia.etiqueta}, rel ${rel.toFixed(2)}) → ${donde}`);
                return {
                    urlFinal: `${BASE_URL}/img/${nombre}`, urlOriginal: c.urlPagina, nombre, procesada: marcada,
                    fuente: `${c.proveedor.toLowerCase().replace(/[^a-z]+/g, '-')}${marcada ? '-wm' : ''}`.slice(0, 50),
                    licencia: c.licencia.etiqueta, licenciaUrl: c.licencia.url, paginaFuente: c.urlPagina,
                    credito: c.licencia.requiereCredito ? `${c.autor} / ${c.proveedor}` : `${c.proveedor}${c.autor !== 'Autor desconocido' ? ' — ' + c.autor : ''}`,
                };
            } catch (e) { console.log(`      ✗ ${c.id}: ${e.message}`); }
        }
    }
    // Sin foto limpia y relevante → tarjeta de marca propia. Mejor eso que una foto equivocada o dudosa.
    console.log('   🏮 Sin foto limpia/relevante → tarjeta de marca propia');
    const { buffer, marcada } = await tarjetaMarca(categoria);
    const nombre = `efd-marca-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.jpg`;
    await almacen.guardar(nombre, buffer, { fuenteId: 'marca-propia' });
    return { urlFinal: `${BASE_URL}/img/${nombre}`, urlOriginal: null, nombre, procesada: marcada, fuente: 'marca-farol',
        licencia: 'Propia', licenciaUrl: null, paginaFuente: null, credito: null };
}
module.exports = { obtenerImagenLimpia, construirConsultas, relevancia };
