'use strict';
/**
 * EXTRACTOR WEB DIRECTO de imágenes (sin Pexels, sin Piped, sin catálogos prehechos, sin API keys).
 *
 *  Flujo:
 *   1) Si la noticia viene de una fuente (RSS) usamos el enlace original: su og:image es la foto del hecho exacto.
 *   2) Si no, buscamos en la web por el contexto de la noticia (titular/entidades):
 *        · Bing News RSS  → artículos recientes (frescura)         [keyless]
 *        · DuckDuckGo HTML → resultados web como respaldo          [keyless]
 *   3) De cada página extraemos la imagen principal (og:image / twitter:image / JSON-LD / image_src)
 *      y devolvemos candidatos. La descarga segura, inspección visual, deduplicación y marca de agua las
 *      hace después el pipeline de index.js (depurador.js).
 *
 *  ⚠️ Las fotos de otros medios tienen derechos de autor. Este módulo siempre devuelve el crédito y el enlace a la fuente
 *     para mostrarlos bajo la foto, pero eso NO equivale a licencia. Para desactivarlo: IMG_SOLO_LICENCIADAS=1.
 */
const crypto = require('crypto');
const dep = require('./depurador');
const cache = require('../cache');

const UA = process.env.IMG_WEB_USER_AGENT || 'Mozilla/5.0 (compatible; ElFarolBot/2.0; +https://elfarolaldia.com)';
const MAX_PAGINAS = parseInt(process.env.IMG_WEB_MAX_PAGINAS || '5', 10);
const BLOQUEO_PAGINAS = [...dep.DOMINIOS_BLOQUEADOS, 'wikipedia.org', 'youtube.', 'youtu.be', 'linkedin.', 'reddit.', 'x.com', 'twitter.'];
const IMG_BASURA = /(logo|favicon|sprite|placeholder|default|avatar|icon|blank|pixel|banner-?ad|publicidad|\/ads?\/|share|og-?default|noimage|no-image)/i;

const host = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const decodificar = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const paginaValida = u => { const h = host(u); return h && /^https:/.test(u) && !BLOQUEO_PAGINAS.some(b => h.includes(b)); };

// ── Búsqueda de páginas ─────────────────────────────────────────────────
async function _texto(url, xml = false) { return (await dep.descargarPagina(url, UA, { xml })).html; }

async function _bingNews(q) {
    const xml = await _texto(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setmkt=es-DO&count=15`, true);
    const out = [];
    for (const m of xml.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>/g)) {
        let u = decodificar(m[1]);
        try { const x = new URL(u); if (/bing\.com$/.test(x.hostname) && x.searchParams.get('url')) u = x.searchParams.get('url'); } catch { /* se queda igual */ }
        out.push(u);
    }
    return out;
}
async function _ddg(q) {
    const html = await _texto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=do-es`);
    const out = [];
    for (const m of html.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)) {
        let u = decodificar(m[1]);
        const w = u.match(/[?&]uddg=([^&]+)/); if (w) u = decodeURIComponent(w[1]);
        if (u.startsWith('//')) u = 'https:' + u;
        out.push(u);
    }
    return out;
}

async function buscarPaginas(consulta) {
    return cache.wrap('webpag', consulta.toLowerCase(), 3600, async () => {
        const r = await Promise.allSettled([_bingNews(consulta), _ddg(consulta)]);
        r.forEach((x, i) => x.status === 'rejected' && console.warn(`   ⚠️ [img-web] ${i ? 'DuckDuckGo' : 'Bing News'}: ${x.reason.message}`));
        const urls = r.flatMap(x => x.status === 'fulfilled' ? x.value : []).filter(paginaValida);
        // máx. 2 páginas por dominio → variedad de fuentes
        const porHost = {}; return [...new Set(urls)].filter(u => (porHost[host(u)] = (porHost[host(u)] || 0) + 1) <= 2);
    });
}

// ── Extracción de la imagen principal de una página ─────────────────────
function _meta(html, claves) {
    for (const k of claves) {
        const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']+)["']`, 'i');
        const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${k}["']`, 'i');
        const m = html.match(re1) || html.match(re2); if (m) return decodificar(m[1]);
    }
    return '';
}
function extraerDePagina(html, urlPagina) {
    const cab = html.slice(0, 400000);
    const titulo = _meta(cab, ['og:title', 'twitter:title']) || decodificar((cab.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);
    const descripcion = _meta(cab, ['og:description', 'description', 'twitter:description']);
    const imgs = [_meta(cab, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src'])];
    const link = cab.match(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i); if (link) imgs.push(decodificar(link[1]));
    const ld = cab.match(/"image"\s*:\s*(?:\{[^}]*"url"\s*:\s*)?"(https?:[^"]+)"/i) || cab.match(/"image"\s*:\s*\[\s*"(https?:[^"]+)"/i); if (ld) imgs.push(decodificar(ld[1].replace(/\\\//g, '/')));
    const urls = [...new Set(imgs.filter(Boolean).map(i => { try { return new URL(i, urlPagina).toString(); } catch { return null; } }).filter(Boolean))]
        .filter(i => /^https:/.test(i) && !IMG_BASURA.test(i.split('?')[0]));
    return { titulo, descripcion, imagenes: urls };
}

async function candidatosDePagina(urlPagina) {
    try {
        const { html, urlFinal } = await dep.descargarPagina(urlPagina, UA);
        const info = extraerDePagina(html, urlFinal);
        const h = host(urlFinal);
        return info.imagenes.map(u => ({
            id: `web:${crypto.createHash('md5').update(u).digest('hex').slice(0, 16)}`,
            proveedor: h, urlDescarga: u, urlPagina: urlFinal,
            titulo: info.titulo, descripcion: info.descripcion, autor: h, categorias: [],
            licencia: { permitida: true, tipo: 'fuente', etiqueta: 'Imagen de la fuente original', url: null, requiereCredito: true },
            web: true,
        }));
    } catch (e) { console.log(`      ✗ [img-web] ${host(urlPagina) || urlPagina}: ${e.message}`); return []; }
}

/** Candidatos para una noticia: primero la fuente original (si existe) y luego las páginas halladas por contexto. */
async function candidatos({ consulta, enlaceFuente }) {
    const salida = [];
    if (enlaceFuente && paginaValida(enlaceFuente)) salida.push(...(await candidatosDePagina(enlaceFuente)).map(c => ({ ...c, esFuente: true })));
    if (consulta) {
        const paginas = (await buscarPaginas(consulta).catch(() => [])).filter(u => u !== enlaceFuente).slice(0, MAX_PAGINAS);
        const lotes = await Promise.all(paginas.map(candidatosDePagina));
        salida.push(...lotes.flat());
    }
    return salida;
}

module.exports = { candidatos, buscarPaginas, extraerDePagina, candidatosDePagina };
