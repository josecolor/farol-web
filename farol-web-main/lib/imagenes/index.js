'use strict';
/**
 * obtenerImagenLimpia() — reemplazo de obtenerImagenV40().
 * Devuelve la misma forma {urlFinal, urlOriginal, nombre, fuente, procesada} + {licencia, credito, paginaFuente, licenciaUrl}.
 */
const crypto = require('crypto');
const llm = require('../llm');
const { buscar } = require('./buscador');
const web = require('./web');
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

const SOLO_LICENCIADAS = process.env.IMG_SOLO_LICENCIADAS === '1';

/** Procesa candidatos ya rankeados: descarga segura → inspección → dedupe → marca → almacén. Devuelve el resultado o null. */
async function _publicarPrimera(ranking, consulta, umbrales) {
    for (const { c, rel } of ranking) {
        try {
            const dup = await dep.yaUsada(c, null); if (dup) { console.log(`      ✗ ${c.id}: ${dup}`); continue; }
            const buf = await dep.descargar(c.urlDescarga, UA);
            const ins = await dep.inspeccionar(buf, umbrales);
            if (!ins.ok) { console.log(`      ✗ ${c.id}: ${ins.motivo}`); continue; }
            const dup2 = await dep.yaUsada(c, ins.huella); if (dup2) { console.log(`      ✗ ${c.id}: ${dup2}`); continue; }

            const { buffer, marcada } = await aplicarMarca(buf);
            const nombre = `efd-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
            const donde = await almacen.guardar(nombre, buffer, { fuenteId: c.id, proveedor: c.proveedor, autor: c.autor, licencia: c.licencia.etiqueta, paginaFuente: c.urlPagina, consulta });
            await dep.marcarUsada(c, ins.huella);
            console.log(`   ✅ ${c.id} (${c.licencia.etiqueta}, rel ${rel.toFixed(2)}) → ${donde}`);
            return {
                urlFinal: `${BASE_URL}/img/${nombre}`, urlOriginal: c.urlPagina, nombre, procesada: marcada,
                fuente: `${c.web ? 'web-' : ''}${c.proveedor.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${marcada ? '-wm' : ''}`.slice(0, 50),
                licencia: c.licencia.etiqueta, licenciaUrl: c.licencia.url, paginaFuente: c.urlPagina,
                credito: c.web ? c.proveedor : (c.licencia.requiereCredito ? `${c.autor} / ${c.proveedor}` : `${c.proveedor}${c.autor !== 'Autor desconocido' ? ' — ' + c.autor : ''}`),
            };
        } catch (e) { console.log(`      ✗ ${c.id}: ${e.message}`); }
    }
    return null;
}

async function obtenerImagenLimpia({ titulo, contenido, categoria, subtema, personaQuery, enlaceFuente }) {
    console.log(`\n   🖼️ [img] Buscando foto fresca en la web → "${titulo.slice(0, 55)}"`);
    const consultas = await construirConsultas({ titulo, contenido, categoria, personaQuery });
    console.log(`   🔎 consultas: ${consultas.join(' | ')}`);

    // ── Nivel 1: EXTRACTOR WEB DIRECTO (fuente original + búsqueda de noticias frescas por contexto) ──
    if (!SOLO_LICENCIADAS) {
        const MIN_REL_WEB = parseFloat(process.env.IMG_WEB_MIN_RELEVANCIA || '0.4');
        const umbralesWeb = { minAncho: parseInt(process.env.IMG_WEB_MIN_ANCHO || '800', 10), minAlto: parseInt(process.env.IMG_WEB_MIN_ALTO || '450', 10) };
        const consultasWeb = [titulo.replace(/["“”]/g, '').slice(0, 90), ...consultas].filter((q, i, a) => q && a.indexOf(q) === i).slice(0, 3);
        for (let i = 0; i < consultasWeb.length; i++) {
            const consulta = consultasWeb[i];
            let cands = [];
            try { cands = await web.candidatos({ consulta, enlaceFuente: i === 0 ? enlaceFuente : null }); }
            catch (e) { console.warn('   ⚠️ [img-web] búsqueda:', e.message); continue; }
            const ranking = cands
                .map(c => ({ c, rel: c.esFuente ? 1 : Math.max(relevancia(c, consulta), relevancia(c, titulo)) }))
                .filter(x => x.rel >= MIN_REL_WEB)
                .sort((a, b) => (b.c.esFuente ? 1 : 0) - (a.c.esFuente ? 1 : 0) || b.rel - a.rel).slice(0, 6);
            const r = await _publicarPrimera(ranking, consulta, umbralesWeb);
            if (r) return r;
        }
    }

    // ── Nivel 2: fotos con licencia verificable (Wikimedia Commons / Openverse) ──
    const MIN_REL = parseFloat(process.env.IMG_MIN_RELEVANCIA || '0.5');
    for (const consulta of consultas) {
        let cands = [];
        try { cands = await buscar(consulta); } catch (e) { console.warn('   ⚠️ [img] búsqueda:', e.message); continue; }
        const ranking = cands
            .map(c => ({ c, meta: dep.evaluarMetadatos(c), rel: relevancia(c, consulta) }))
            .filter(x => { if (!x.meta.ok) { console.log(`      ✗ ${x.c.id}: ${x.meta.motivo}`); return false; } return x.rel >= MIN_REL; })
            .map(x => ({ ...x, score: x.rel * 10 + (x.c.licencia.tipo === 'cc0' ? 1 : 0) + ((x.c.proveedor || '').startsWith('Wikimedia') ? 0.5 : 0) + Math.min((x.c.anchoOriginal || 0) / 4000, 1) }))
            .sort((a, b) => b.score - a.score).slice(0, 6);
        const r = await _publicarPrimera(ranking, consulta, {});
        if (r) return r;
    }

    // ── Nivel 3: tarjeta de marca propia. Mejor eso que una foto equivocada o dudosa. ──
    console.log('   🏮 Sin foto limpia/relevante → tarjeta de marca propia');
    const { buffer, marcada } = await tarjetaMarca(categoria);
    const nombre = `efd-marca-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.jpg`;
    await almacen.guardar(nombre, buffer, { fuenteId: 'marca-propia' });
    return { urlFinal: `${BASE_URL}/img/${nombre}`, urlOriginal: null, nombre, procesada: marcada, fuente: 'marca-farol',
        licencia: 'Propia', licenciaUrl: null, paginaFuente: null, credito: null };
}
module.exports = { obtenerImagenLimpia, construirConsultas, relevancia };
