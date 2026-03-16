/**
 * 🏮 EL FAROL AL DÍA — V31.0
 * + Wikipedia API como contexto inteligente para Gemini
 * + Lógica de imágenes mejorada (prioridad RD / SDE)
 * + Alt SEO geolocalizado República Dominicana
 * + Query de imagen inteligente por zona local
 */

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const cron      = require('node-cron');
const { Pool }  = require('pg');
const sharp     = require('sharp');
const RSSParser = require('rss-parser');
const crypto    = require('crypto');

const app      = express();
const PORT     = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

if (!process.env.DATABASE_URL)   { console.error('❌ DATABASE_URL requerido');  process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY requerido'); process.exit(1); }

const PEXELS_API_KEY        = process.env.PEXELS_API_KEY        || null;
const FB_PAGE_ID            = process.env.FB_PAGE_ID            || null;
const FB_PAGE_TOKEN         = process.env.FB_PAGE_TOKEN         || null;
const TWITTER_API_KEY       = process.env.TWITTER_API_KEY       || null;
const TWITTER_API_SECRET    = process.env.TWITTER_API_SECRET    || null;
const TWITTER_ACCESS_TOKEN  = process.env.TWITTER_ACCESS_TOKEN  || null;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET || null;
// Busca watermark con cualquier nombre en la carpeta static
const WATERMARK_PATH = (() => {
    const variantes = [
        'watermark.png',
        'WATERMARK(1).png',
        'watermark(1).png',
        'watermark (1).png',
        'WATERMARK.png',
    ];
    for (const nombre of variantes) {
        const ruta = path.join(__dirname, 'static', nombre);
        if (fs.existsSync(ruta)) {
            console.log(`🏮 Watermark encontrado: ${nombre}`);
            return ruta;
        }
    }
    return path.join(__dirname, 'static', 'watermark.png'); // fallback
})();
const rssParser             = new RSSParser({ timeout: 10000 });

// ══════════════════════════════════════════════════════════
// BASE DE DATOS
// ══════════════════════════════════════════════════════════
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/static', express.static(path.join(__dirname, 'static'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'public,max-age=2592000,immutable')
}));
app.use(express.static(path.join(__dirname, 'client'), {
    setHeaders: (res, fp) => {
        if (/\.(jpg|jpeg|png|gif|webp|ico|svg)$/i.test(fp))
            res.setHeader('Cache-Control', 'public,max-age=2592000,immutable');
        else if (/\.(css|js)$/i.test(fp))
            res.setHeader('Cache-Control', 'public,max-age=86400');
    }
}));
app.use(cors());

// ══════════════════════════════════════════════════════════
// ▶ WIKIPEDIA API — CONTEXTO INTELIGENTE
// Busca contexto real sobre el tema antes de llamar a Gemini.
// Prioriza artículos en español sobre RD, SDE y el Caribe.
// ══════════════════════════════════════════════════════════

/**
 * Mapeo de palabras clave locales → términos Wikipedia en español
 * para que la búsqueda sea precisa y no traiga contenido genérico.
 */
const WIKI_TERMINOS_RD = {
    // Zonas locales
    'los mina':          'Los Mina Santo Domingo',
    'invivienda':        'Instituto Nacional de la Vivienda República Dominicana',
    'ensanche ozama':    'Ensanche Ozama Santo Domingo Este',
    'santo domingo este':'Santo Domingo Este',
    'sabana perdida':    'Sabana Perdida Santo Domingo',
    'villa mella':       'Villa Mella Santo Domingo',
    // Instituciones
    'policia nacional':  'Policía Nacional República Dominicana',
    'presidencia':       'Presidencia de la República Dominicana',
    'procuraduria':      'Procuraduría General de la República Dominicana',
    'banco central':     'Banco Central de la República Dominicana',
    // Temas frecuentes
    'beisbol':           'Béisbol en República Dominicana',
    'turismo':           'Turismo en República Dominicana',
    'economia':          'Economía de República Dominicana',
    'educacion':         'Educación en República Dominicana',
    'salud publica':     'Ministerio de Salud Pública República Dominicana',
    'mopc':              'Ministerio de Obras Públicas República Dominicana',
    'haití':             'Relaciones entre República Dominicana y Haití',
};

/**
 * Busca contexto en Wikipedia (API pública, sin clave).
 * Retorna un resumen de máximo 3 párrafos para enriquecer el prompt de Gemini.
 * Si falla silenciosamente, retorna string vacío para no bloquear la generación.
 */
async function buscarContextoWikipedia(titulo, categoria) {
    try {
        // Detectar si el tema tiene un término RD mapeado
        const tituloLower = titulo.toLowerCase();
        let terminoBusqueda = null;

        for (const [clave, termino] of Object.entries(WIKI_TERMINOS_RD)) {
            if (tituloLower.includes(clave)) {
                terminoBusqueda = termino;
                break;
            }
        }

        // Si no hay mapeo, construir búsqueda genérica con contexto RD
        if (!terminoBusqueda) {
            const mapaCategoria = {
                'Nacionales':       `${titulo} República Dominicana`,
                'Deportes':         `${titulo} deporte dominicano`,
                'Internacionales':  `${titulo} América Latina Caribe`,
                'Economía':         `${titulo} economía dominicana`,
                'Tecnología':       titulo,
                'Espectáculos':     `${titulo} cultura dominicana`,
            };
            terminoBusqueda = mapaCategoria[categoria] || `${titulo} República Dominicana`;
        }

        // Paso 1: Buscar el artículo más relevante
        const urlBusqueda = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(terminoBusqueda)}&format=json&srlimit=3&origin=*`;
        const ctrlBusq    = new AbortController();
        const tmBusq      = setTimeout(() => ctrlBusq.abort(), 6000);
        const resBusqueda = await fetch(urlBusqueda, { signal: ctrlBusq.signal }).finally(() => clearTimeout(tmBusq));
        if (!resBusqueda.ok) return '';

        const dataBusqueda = await resBusqueda.json();
        const resultados   = dataBusqueda?.query?.search;
        if (!resultados?.length) return '';

        const paginaId = resultados[0].pageid;

        // Paso 2: Extraer extracto del artículo
        const urlExtracto = `https://es.wikipedia.org/w/api.php?action=query&pageids=${paginaId}&prop=extracts&exintro=true&exchars=1500&format=json&origin=*`;
        const ctrlExtr    = new AbortController();
        const tmExtr      = setTimeout(() => ctrlExtr.abort(), 6000);
        const resExtracto = await fetch(urlExtracto, { signal: ctrlExtr.signal }).finally(() => clearTimeout(tmExtr));
        if (!resExtracto.ok) return '';

        const dataExtracto = await resExtracto.json();
        const pagina       = dataExtracto?.query?.pages?.[paginaId];
        if (!pagina?.extract) return '';

        // Limpiar HTML de Wikipedia y recortar
        const textoLimpio = pagina.extract
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 1200);

        console.log(`   📚 Wikipedia: "${resultados[0].title}" (${textoLimpio.length} chars)`);
        return `\n📚 CONTEXTO WIKIPEDIA (usar como referencia factual, no copiar):\nArtículo: "${resultados[0].title}"\n${textoLimpio}\n`;

    } catch (err) {
        // Silencioso — Wikipedia es opcional, no crítica
        console.log(`   📚 Wikipedia: no disponible (${err.message})`);
        return '';
    }
}

// ══════════════════════════════════════════════════════════
// FACEBOOK
// ══════════════════════════════════════════════════════════
async function publicarEnFacebook(titulo, slug, urlImagen, descripcion) {
    if (!FB_PAGE_ID || !FB_PAGE_TOKEN) return false;
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const mensaje    = `🏮 ${titulo}\n\n${descripcion || ''}\n\nLee la noticia completa 👇\n${urlNoticia}\n\n#ElFarolAlDía #RepúblicaDominicana #NoticiaRD`;

        const form = new URLSearchParams();
        form.append('url',          urlImagen);
        form.append('caption',      mensaje);
        form.append('access_token', FB_PAGE_TOKEN);

        const res  = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/photos`, { method: 'POST', body: form });
        const data = await res.json();

        if (data.error) {
            const form2 = new URLSearchParams();
            form2.append('message',      mensaje);
            form2.append('link',         urlNoticia);
            form2.append('access_token', FB_PAGE_TOKEN);
            const res2  = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/feed`, { method: 'POST', body: form2 });
            const data2 = await res2.json();
            if (data2.error) { console.warn(`   ⚠️ FB: ${data2.error.message}`); return false; }
        }

        console.log(`   📘 Facebook ✅`);
        return true;
    } catch (err) {
        console.warn(`   ⚠️ Facebook: ${err.message}`);
        return false;
    }
}

// ══════════════════════════════════════════════════════════
// TWITTER / X  — OAuth 1.0a
// ══════════════════════════════════════════════════════════
function generarOAuthHeader(method, url, params, consumerKey, consumerSecret, accessToken, tokenSecret) {
    const oauthParams = {
        oauth_consumer_key:     consumerKey,
        oauth_nonce:            crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp:        Math.floor(Date.now() / 1000).toString(),
        oauth_token:            accessToken,
        oauth_version:          '1.0'
    };
    const allParams    = { ...params, ...oauthParams };
    const sortedParams = Object.keys(allParams).sort()
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`).join('&');
    const baseString   = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
    const signingKey   = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
    const signature    = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
    oauthParams.oauth_signature = signature;
    return 'OAuth ' + Object.keys(oauthParams).sort()
        .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
        .join(', ');
}

async function publicarEnTwitter(titulo, slug, descripcion) {
    if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) return false;
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const textoBase  = `🏮 ${titulo}\n\n${urlNoticia}\n\n#ElFarolAlDía #RD`;
        const tweet      = textoBase.length > 280 ? textoBase.substring(0, 277) + '...' : textoBase;
        const tweetUrl   = 'https://api.twitter.com/2/tweets';
        const authHeader = generarOAuthHeader('POST', tweetUrl, {}, TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET);
        const res        = await fetch(tweetUrl, {
            method: 'POST',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: tweet })
        });
        const data = await res.json();
        if (data.errors || data.error) { console.warn(`   ⚠️ Twitter: ${JSON.stringify(data.errors || data.error)}`); return false; }
        console.log(`   🐦 Twitter ✅ ID: ${data.data?.id}`);
        return true;
    } catch (err) {
        console.warn(`   ⚠️ Twitter: ${err.message}`);
        return false;
    }
}

// ══════════════════════════════════════════════════════════
// MARCA DE AGUA
// ══════════════════════════════════════════════════════════
async function aplicarMarcaDeAgua(urlImagen) {
    try {
        const response = await fetch(urlImagen);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bufOrig   = Buffer.from(await response.arrayBuffer());
        if (!fs.existsSync(WATERMARK_PATH)) { console.warn('   ⚠️ Watermark no encontrado'); return { url: urlImagen, procesada: false }; }
        const meta      = await sharp(bufOrig).metadata();
        const w         = meta.width  || 800;
        const h         = meta.height || 500;
        const wmAncho   = Math.min(Math.round(w * 0.28), 300);
        const wmResized = await sharp(WATERMARK_PATH).resize(wmAncho, null, { fit: 'inside' }).toBuffer();
        const wmMeta    = await sharp(wmResized).metadata();
        const wmAlto    = wmMeta.height || 60;
        const margen    = Math.round(w * 0.02);
        const bufFinal  = await sharp(bufOrig)
            .composite([{ input: wmResized, left: Math.max(0, w - wmAncho - margen), top: Math.max(0, h - wmAlto - margen), blend: 'over' }])
            .jpeg({ quality: 88 }).toBuffer();
        const nombre    = `efd-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.jpg`;
        fs.writeFileSync(path.join('/tmp', nombre), bufFinal);
        console.log(`   🏮 Watermark: ${nombre}`);
        return { url: urlImagen, nombre, procesada: true };
    } catch (err) {
        console.warn(`   ⚠️ Watermark: ${err.message}`);
        return { url: urlImagen, procesada: false };
    }
}

app.get('/img/:nombre', async (req, res) => {
    const ruta = path.join('/tmp', req.params.nombre);
    if (fs.existsSync(ruta)) {
        res.setHeader('Content-Type',  'image/jpeg');
        res.setHeader('Cache-Control', 'public,max-age=604800');
        return res.sendFile(ruta);
    }
    // /tmp fue limpiado — buscar URL original en BD y redirigir
    try {
        const nombre = req.params.nombre;
        const r = await pool.query(
            `SELECT imagen_original FROM noticias WHERE imagen_nombre=$1 LIMIT 1`,
            [nombre]
        );
        if (r.rows.length && r.rows[0].imagen_original) {
            return res.redirect(302, r.rows[0].imagen_original);
        }
    } catch(e) { /* silencioso */ }
    res.status(404).send('Imagen no disponible');
});

// ══════════════════════════════════════════════════════════
// CONFIG IA
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// ▶ CONFIG IA — GUARDADA EN POSTGRESQL (persiste entre reinicios)
// ══════════════════════════════════════════════════════════

const CONFIG_IA_DEFAULT = {
    enabled: true,
    instruccion_principal: 'Eres un periodista profesional dominicano de alto nivel, con visión nacional e internacional. Escribes noticias verificadas, equilibradas y con impacto real. Cubres República Dominicana completa, el Caribe, Latinoamérica y el mundo. Cuando la noticia tiene conexión con Santo Domingo Este o RD, lo destacas con contexto local.',
    tono: 'profesional',
    extension: 'media',
    enfasis: 'Si la noticia es nacional: prioriza SDE, Los Mina, Invivienda, Ensanche Ozama. Si es internacional: conecta con el impacto en República Dominicana y el Caribe.',
    evitar: 'Limitar el tema solo a Santo Domingo Este. Especulación sin fuentes. Titulares sensacionalistas. Repetir noticias ya publicadas. Copiar texto de Wikipedia.'
};

// Copia en memoria — se carga desde BD al arrancar
let CONFIG_IA = { ...CONFIG_IA_DEFAULT };

// Cargar config desde PostgreSQL
async function cargarConfigIA() {
    try {
        const r = await pool.query(`SELECT valor FROM memoria_ia WHERE tipo='config_ia' AND valor IS NOT NULL ORDER BY ultima_vez DESC LIMIT 1`);
        if (r.rows.length) {
            const guardada = JSON.parse(r.rows[0].valor);
            CONFIG_IA = { ...CONFIG_IA_DEFAULT, ...guardada };
            console.log('✅ Config IA cargada desde BD');
        } else {
            CONFIG_IA = { ...CONFIG_IA_DEFAULT };
            console.log('✅ Config IA usando valores por defecto');
        }
    } catch(e) {
        CONFIG_IA = { ...CONFIG_IA_DEFAULT };
        console.log('⚠️ Config IA: usando defecto (' + e.message + ')');
    }
    return CONFIG_IA;
}

// Guardar config en PostgreSQL — sobrevive reinicios y limpiezas de Railway
async function guardarConfigIA(cfg) {
    try {
        const valor = JSON.stringify(cfg);
        await pool.query(`
            INSERT INTO memoria_ia(tipo, valor, categoria, exitos, fallos)
            VALUES('config_ia', $1, 'sistema', 1, 0)
            ON CONFLICT DO NOTHING
        `, [valor]);
        await pool.query(`
            UPDATE memoria_ia SET valor=$1, ultima_vez=NOW()
            WHERE tipo='config_ia' AND categoria='sistema'
        `, [valor]);
        return true;
    } catch(e) {
        console.error('❌ guardarConfigIA:', e.message);
        return false;
    }
}

// ══════════════════════════════════════════════════════════
// GEMINI — con Wikipedia integrado
// ══════════════════════════════════════════════════════════
const GS = { lastRequest: 0, resetTime: 0 };

async function llamarGemini(prompt, reintentos = 3) {
    for (let i = 0; i < reintentos; i++) {
        try {
            console.log(`   🤖 Gemini (intento ${i + 1})`);
            const ahora = Date.now();
            if (ahora < GS.resetTime) await new Promise(r => setTimeout(r, Math.min(GS.resetTime - ahora, 10000)));
            const desde = Date.now() - GS.lastRequest;
            if (desde < 3000) await new Promise(r => setTimeout(r, 3000 - desde));
            GS.lastRequest = Date.now();

            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature:     0.8,
                            maxOutputTokens: 4000,   // 2500 cortaba el contenido a la mitad
                            stopSequences:   []
                        }
                    })
                }
            );

            if (res.status === 429) {
                GS.resetTime = Date.now() + Math.pow(2, i) * 5000;
                await new Promise(r => setTimeout(r, GS.resetTime - Date.now()));
                continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data  = await res.json();
            const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!texto) throw new Error('Respuesta vacía');
            console.log(`   ✅ Gemini OK`);
            return texto;
        } catch (err) {
            console.error(`   ❌ Intento ${i + 1}: ${err.message}`);
            if (i < reintentos - 1) await new Promise(r => setTimeout(r, Math.pow(2, i) * 3000));
        }
    }
    throw new Error('Gemini no respondió');
}

// ══════════════════════════════════════════════════════════
// ▶ PEXELS — BÚSQUEDA MEJORADA CON CONTEXTO RD
// La lógica anterior buscaba en inglés genérico.
// Ahora busca primero con términos específicos de RD/Caribe,
// y si no hay resultados, cae al banco local.
// ══════════════════════════════════════════════════════════

/**
 * Términos de búsqueda Pexels específicos por zona local.
 * Pexels no tiene fotos etiquetadas "Los Mina RD", entonces
 * usamos equivalentes visuales que sí existen en su base.
 */
const PEXELS_QUERIES_RD = {
    // Zonas locales → query visual equivalente
    'los mina':           ['dominican republic city street', 'caribbean urban neighborhood', 'santo domingo streets'],
    'invivienda':         ['dominican republic housing', 'caribbean social housing', 'latin america residential'],
    'ensanche ozama':     ['dominican republic urban area', 'caribbean city infrastructure'],
    'santo domingo este': ['santo domingo dominican republic', 'caribbean capital city'],
    'villa mella':        ['dominican republic suburb', 'caribbean neighborhood street'],
    // Temas nacionales
    'policia':            ['police officers latin america', 'law enforcement caribbean'],
    'gobierno':           ['government building caribbean', 'latin america politics meeting'],
    'beisbol':            ['baseball dominican republic', 'baseball caribbean player'],
    'economia':           ['dominican republic economy', 'caribbean business finance'],
    'educacion':          ['dominican republic school', 'caribbean students classroom'],
    'salud':              ['caribbean hospital medical', 'dominican republic health'],
    'turismo':            ['dominican republic tourism beach', 'punta cana resort caribbean'],
    'deporte':            ['dominican republic sport athlete', 'caribbean sports competition'],
    'cultura':            ['dominican republic culture music', 'merengue caribbean festival'],
    'tecnologia':         ['technology latin america digital', 'caribbean innovation tech'],
    'medio ambiente':     ['dominican republic nature environment', 'caribbean ocean ecology'],
    'infraestructura':    ['dominican republic construction road', 'caribbean infrastructure development'],
    // Internacionales con enlace RD
    'haiti':              ['haiti dominican republic border', 'caribbean diplomacy'],
    'caribe':             ['caribbean sea islands', 'caribbean region aerial'],
};

/**
 * Busca en Pexels con múltiples queries de fallback.
 * Intenta queries más específicos primero, luego genéricos.
 */
async function buscarEnPexels(queries) {
    if (!PEXELS_API_KEY) return null;

    // Términos prohibidos — fotos que no tienen nada que ver con noticias
    const BLOQUEADOS = ['wedding', 'bride', 'groom', 'bridal', 'couple', 'romance', 'romantic',
        'fashion', 'model', 'party', 'celebration', 'flowers', 'love', 'kiss', 'marriage'];

    const listaQueries = (Array.isArray(queries) ? queries : [queries])
        .filter(q => {
            const ql = q.toLowerCase();
            return !BLOQUEADOS.some(b => ql.includes(b));
        });

    if (!listaQueries.length) {
        console.log('   📸 Todas las queries bloqueadas → banco local');
        return null;
    }

    for (const query of listaQueries) {
        try {
            const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=10&orientation=landscape`;
            const ctrl = new AbortController();
            const tm   = setTimeout(() => ctrl.abort(), 5000);
            const res  = await fetch(url, {
                headers: { Authorization: PEXELS_API_KEY },
                signal:  ctrl.signal
            }).finally(() => clearTimeout(tm));
            if (!res.ok) continue;
            const data = await res.json();
            if (!data.photos?.length) continue;

            // Tomar foto aleatoria de las primeras 5 para variedad
            const foto = data.photos.slice(0, 5)[Math.floor(Math.random() * Math.min(5, data.photos.length))];
            console.log(`   📸 Pexels: "${query}" → ${foto.id}`);
            // Aprender: esta query funcionó
            registrarQueryPexels(query, 'general', true);
            return foto.src.large2x || foto.src.large || foto.src.original;
        } catch { continue; }
    }
    return null;
}

/**
 * Detecta si el título o categoría tiene zona local RD
 * y retorna las queries de Pexels más apropiadas.
 */
function detectarQueriesPexels(titulo, categoria, queryIA) {
    const tituloLower = titulo.toLowerCase();
    const queries     = [];

    // Prioridad 1: Zona local detectada
    for (const [zona, zonaQueries] of Object.entries(PEXELS_QUERIES_RD)) {
        if (tituloLower.includes(zona)) {
            queries.push(...zonaQueries);
            break;
        }
    }

    // Prioridad 2: Query que generó la IA (en inglés, viene del prompt)
    if (queryIA) queries.push(queryIA);

    // Prioridad 3: Por categoría
    const mapaCat = {
        'Nacionales':      ['dominican republic news', 'santo domingo dominican'],
        'Deportes':        ['dominican republic sport', 'baseball caribbean'],
        'Internacionales': ['caribbean diplomacy international', 'latin america world news'],
        'Economía':        ['dominican republic economy business', 'caribbean finance'],
        'Tecnología':      ['technology innovation latin america'],
        'Espectáculos':    ['dominican culture entertainment', 'caribbean music festival'],
    };
    if (mapaCat[categoria]) queries.push(...mapaCat[categoria]);

    // Prioridad 4: Fallback genérico con RD
    queries.push('dominican republic', 'caribbean');

    return [...new Set(queries)]; // Sin duplicados
}

// ══════════════════════════════════════════════════════════
// BANCO LOCAL DE IMÁGENES — 10 fotos por categoría
// ══════════════════════════════════════════════════════════
const PB  = 'https://images.pexels.com/photos';
const OPT = '?auto=compress&cs=tinysrgb&w=800';

const BANCO_LOCAL = {
    'politica-gobierno': [
        `${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`,
        `${PB}/290595/pexels-photo-290595.jpeg${OPT}`,
        `${PB}/3616480/pexels-photo-3616480.jpeg${OPT}`,
        `${PB}/3183150/pexels-photo-3183150.jpeg${OPT}`,
        `${PB}/1550337/pexels-photo-1550337.jpeg${OPT}`,
        `${PB}/2990644/pexels-photo-2990644.jpeg${OPT}`,
        `${PB}/3184418/pexels-photo-3184418.jpeg${OPT}`,
        `${PB}/5668481/pexels-photo-5668481.jpeg${OPT}`,
        `${PB}/3182812/pexels-photo-3182812.jpeg${OPT}`,
        `${PB}/4427611/pexels-photo-4427611.jpeg${OPT}`,
    ],
    'seguridad-policia': [
        `${PB}/6261776/pexels-photo-6261776.jpeg${OPT}`,
        `${PB}/5699456/pexels-photo-5699456.jpeg${OPT}`,
        `${PB}/3807517/pexels-photo-3807517.jpeg${OPT}`,
        `${PB}/6980997/pexels-photo-6980997.jpeg${OPT}`,
        `${PB}/1550337/pexels-photo-1550337.jpeg${OPT}`,
        `${PB}/7491987/pexels-photo-7491987.jpeg${OPT}`,
        `${PB}/8761572/pexels-photo-8761572.jpeg${OPT}`,
        `${PB}/5699859/pexels-photo-5699859.jpeg${OPT}`,
        `${PB}/6289059/pexels-photo-6289059.jpeg${OPT}`,
        `${PB}/6044266/pexels-photo-6044266.jpeg${OPT}`,
    ],
    'relaciones-internacionales': [
        `${PB}/2860705/pexels-photo-2860705.jpeg${OPT}`,
        `${PB}/358319/pexels-photo-358319.jpeg${OPT}`,
        `${PB}/3407617/pexels-photo-3407617.jpeg${OPT}`,
        `${PB}/3997992/pexels-photo-3997992.jpeg${OPT}`,
        `${PB}/3183197/pexels-photo-3183197.jpeg${OPT}`,
        `${PB}/1550337/pexels-photo-1550337.jpeg${OPT}`,
        `${PB}/3184339/pexels-photo-3184339.jpeg${OPT}`,
        `${PB}/3183150/pexels-photo-3183150.jpeg${OPT}`,
        `${PB}/7948035/pexels-photo-7948035.jpeg${OPT}`,
        `${PB}/3184292/pexels-photo-3184292.jpeg${OPT}`,
    ],
    'economia-mercado': [
        `${PB}/4386466/pexels-photo-4386466.jpeg${OPT}`,
        `${PB}/6772070/pexels-photo-6772070.jpeg${OPT}`,
        `${PB}/3532557/pexels-photo-3532557.jpeg${OPT}`,
        `${PB}/6801648/pexels-photo-6801648.jpeg${OPT}`,
        `${PB}/210607/pexels-photo-210607.jpeg${OPT}`,
        `${PB}/1602726/pexels-photo-1602726.jpeg${OPT}`,
        `${PB}/3943723/pexels-photo-3943723.jpeg${OPT}`,
        `${PB}/7567443/pexels-photo-7567443.jpeg${OPT}`,
        `${PB}/6120214/pexels-photo-6120214.jpeg${OPT}`,
        `${PB}/5849559/pexels-photo-5849559.jpeg${OPT}`,
    ],
    'infraestructura': [
        `${PB}/1216589/pexels-photo-1216589.jpeg${OPT}`,
        `${PB}/323780/pexels-photo-323780.jpeg${OPT}`,
        `${PB}/2219024/pexels-photo-2219024.jpeg${OPT}`,
        `${PB}/3183197/pexels-photo-3183197.jpeg${OPT}`,
        `${PB}/159306/pexels-photo-159306.jpeg${OPT}`,
        `${PB}/1463917/pexels-photo-1463917.jpeg${OPT}`,
        `${PB}/2760241/pexels-photo-2760241.jpeg${OPT}`,
        `${PB}/247763/pexels-photo-247763.jpeg${OPT}`,
        `${PB}/1134166/pexels-photo-1134166.jpeg${OPT}`,
        `${PB}/2219024/pexels-photo-2219024.jpeg${OPT}`,
    ],
    'salud-medicina': [
        `${PB}/3786157/pexels-photo-3786157.jpeg${OPT}`,
        `${PB}/40568/pexels-photo-40568.jpeg${OPT}`,
        `${PB}/4386467/pexels-photo-4386467.jpeg${OPT}`,
        `${PB}/1170979/pexels-photo-1170979.jpeg${OPT}`,
        `${PB}/5327580/pexels-photo-5327580.jpeg${OPT}`,
        `${PB}/3993212/pexels-photo-3993212.jpeg${OPT}`,
        `${PB}/4021775/pexels-photo-4021775.jpeg${OPT}`,
        `${PB}/3985163/pexels-photo-3985163.jpeg${OPT}`,
        `${PB}/5214958/pexels-photo-5214958.jpeg${OPT}`,
        `${PB}/4226219/pexels-photo-4226219.jpeg${OPT}`,
    ],
    'deporte-beisbol': [
        `${PB}/1661950/pexels-photo-1661950.jpeg${OPT}`,
        `${PB}/209977/pexels-photo-209977.jpeg${OPT}`,
        `${PB}/248318/pexels-photo-248318.jpeg${OPT}`,
        `${PB}/1884574/pexels-photo-1884574.jpeg${OPT}`,
        `${PB}/163452/pexels-photo-163452.jpeg${OPT}`,
        `${PB}/1618200/pexels-photo-1618200.jpeg${OPT}`,
        `${PB}/2277981/pexels-photo-2277981.jpeg${OPT}`,
        `${PB}/3041176/pexels-photo-3041176.jpeg${OPT}`,
        `${PB}/186077/pexels-photo-186077.jpeg${OPT}`,
        `${PB}/1752757/pexels-photo-1752757.jpeg${OPT}`,
    ],
    'deporte-futbol': [
        `${PB}/46798/pexels-photo-46798.jpeg${OPT}`,
        `${PB}/3621943/pexels-photo-3621943.jpeg${OPT}`,
        `${PB}/3873098/pexels-photo-3873098.jpeg${OPT}`,
        `${PB}/1884574/pexels-photo-1884574.jpeg${OPT}`,
        `${PB}/274422/pexels-photo-274422.jpeg${OPT}`,
        `${PB}/1171084/pexels-photo-1171084.jpeg${OPT}`,
        `${PB}/1618200/pexels-photo-1618200.jpeg${OPT}`,
        `${PB}/2277981/pexels-photo-2277981.jpeg${OPT}`,
        `${PB}/3041176/pexels-photo-3041176.jpeg${OPT}`,
        `${PB}/114296/pexels-photo-114296.jpeg${OPT}`,
    ],
    'deporte-general': [
        `${PB}/863988/pexels-photo-863988.jpeg${OPT}`,
        `${PB}/936094/pexels-photo-936094.jpeg${OPT}`,
        `${PB}/2526878/pexels-photo-2526878.jpeg${OPT}`,
        `${PB}/3621943/pexels-photo-3621943.jpeg${OPT}`,
        `${PB}/1552252/pexels-photo-1552252.jpeg${OPT}`,
        `${PB}/3764014/pexels-photo-3764014.jpeg${OPT}`,
        `${PB}/2294353/pexels-photo-2294353.jpeg${OPT}`,
        `${PB}/1752757/pexels-photo-1752757.jpeg${OPT}`,
        `${PB}/4761671/pexels-photo-4761671.jpeg${OPT}`,
        `${PB}/3621517/pexels-photo-3621517.jpeg${OPT}`,
    ],
    'tecnologia': [
        `${PB}/3861958/pexels-photo-3861958.jpeg${OPT}`,
        `${PB}/2582937/pexels-photo-2582937.jpeg${OPT}`,
        `${PB}/5632399/pexels-photo-5632399.jpeg${OPT}`,
        `${PB}/3932499/pexels-photo-3932499.jpeg${OPT}`,
        `${PB}/1181244/pexels-photo-1181244.jpeg${OPT}`,
        `${PB}/574071/pexels-photo-574071.jpeg${OPT}`,
        `${PB}/3861969/pexels-photo-3861969.jpeg${OPT}`,
        `${PB}/4050315/pexels-photo-4050315.jpeg${OPT}`,
        `${PB}/5926382/pexels-photo-5926382.jpeg${OPT}`,
        `${PB}/7988086/pexels-photo-7988086.jpeg${OPT}`,
    ],
    'educacion': [
        `${PB}/256490/pexels-photo-256490.jpeg${OPT}`,
        `${PB}/289737/pexels-photo-289737.jpeg${OPT}`,
        `${PB}/1205651/pexels-photo-1205651.jpeg${OPT}`,
        `${PB}/4143791/pexels-photo-4143791.jpeg${OPT}`,
        `${PB}/301926/pexels-photo-301926.jpeg${OPT}`,
        `${PB}/5905559/pexels-photo-5905559.jpeg${OPT}`,
        `${PB}/3769021/pexels-photo-3769021.jpeg${OPT}`,
        `${PB}/4491461/pexels-photo-4491461.jpeg${OPT}`,
        `${PB}/4145197/pexels-photo-4145197.jpeg${OPT}`,
        `${PB}/8617816/pexels-photo-8617816.jpeg${OPT}`,
    ],
    'cultura-musica': [
        `${PB}/1190297/pexels-photo-1190297.jpeg${OPT}`,
        `${PB}/1540406/pexels-photo-1540406.jpeg${OPT}`,
        `${PB}/3651308/pexels-photo-3651308.jpeg${OPT}`,
        `${PB}/2521317/pexels-photo-2521317.jpeg${OPT}`,
        `${PB}/1047442/pexels-photo-1047442.jpeg${OPT}`,
        `${PB}/167636/pexels-photo-167636.jpeg${OPT}`,
        `${PB}/995301/pexels-photo-995301.jpeg${OPT}`,
        `${PB}/2191013/pexels-photo-2191013.jpeg${OPT}`,
        `${PB}/1105666/pexels-photo-1105666.jpeg${OPT}`,
        `${PB}/1769280/pexels-photo-1769280.jpeg${OPT}`,
    ],
    'medio-ambiente': [
        `${PB}/1108572/pexels-photo-1108572.jpeg${OPT}`,
        `${PB}/1366919/pexels-photo-1366919.jpeg${OPT}`,
        `${PB}/2559941/pexels-photo-2559941.jpeg${OPT}`,
        `${PB}/414612/pexels-photo-414612.jpeg${OPT}`,
        `${PB}/247599/pexels-photo-247599.jpeg${OPT}`,
        `${PB}/1666012/pexels-photo-1666012.jpeg${OPT}`,
        `${PB}/572897/pexels-photo-572897.jpeg${OPT}`,
        `${PB}/1021142/pexels-photo-1021142.jpeg${OPT}`,
        `${PB}/3225517/pexels-photo-3225517.jpeg${OPT}`,
        `${PB}/1423600/pexels-photo-1423600.jpeg${OPT}`,
    ],
    'turismo': [
        `${PB}/1450353/pexels-photo-1450353.jpeg${OPT}`,
        `${PB}/1174732/pexels-photo-1174732.jpeg${OPT}`,
        `${PB}/3601425/pexels-photo-3601425.jpeg${OPT}`,
        `${PB}/2104152/pexels-photo-2104152.jpeg${OPT}`,
        `${PB}/237272/pexels-photo-237272.jpeg${OPT}`,
        `${PB}/1450360/pexels-photo-1450360.jpeg${OPT}`,
        `${PB}/3601453/pexels-photo-3601453.jpeg${OPT}`,
        `${PB}/994605/pexels-photo-994605.jpeg${OPT}`,
        `${PB}/1268855/pexels-photo-1268855.jpeg${OPT}`,
        `${PB}/3155666/pexels-photo-3155666.jpeg${OPT}`,
    ],
    'emergencia': [
        `${PB}/1437862/pexels-photo-1437862.jpeg${OPT}`,
        `${PB}/263402/pexels-photo-263402.jpeg${OPT}`,
        `${PB}/3807517/pexels-photo-3807517.jpeg${OPT}`,
        `${PB}/3616480/pexels-photo-3616480.jpeg${OPT}`,
        `${PB}/3259629/pexels-photo-3259629.jpeg${OPT}`,
        `${PB}/4386396/pexels-photo-4386396.jpeg${OPT}`,
        `${PB}/6129049/pexels-photo-6129049.jpeg${OPT}`,
        `${PB}/5726825/pexels-photo-5726825.jpeg${OPT}`,
        `${PB}/7541956/pexels-photo-7541956.jpeg${OPT}`,
        `${PB}/6129113/pexels-photo-6129113.jpeg${OPT}`,
    ],
    'vivienda-social': [
        `${PB}/323780/pexels-photo-323780.jpeg${OPT}`,
        `${PB}/1396122/pexels-photo-1396122.jpeg${OPT}`,
        `${PB}/2102587/pexels-photo-2102587.jpeg${OPT}`,
        `${PB}/1370704/pexels-photo-1370704.jpeg${OPT}`,
        `${PB}/259588/pexels-photo-259588.jpeg${OPT}`,
        `${PB}/1029599/pexels-photo-1029599.jpeg${OPT}`,
        `${PB}/280229/pexels-photo-280229.jpeg${OPT}`,
        `${PB}/534151/pexels-photo-534151.jpeg${OPT}`,
        `${PB}/1080721/pexels-photo-1080721.jpeg${OPT}`,
        `${PB}/2724749/pexels-photo-2724749.jpeg${OPT}`,
    ],
    'transporte-vial': [
        `${PB}/93398/pexels-photo-93398.jpeg${OPT}`,
        `${PB}/1004409/pexels-photo-1004409.jpeg${OPT}`,
        `${PB}/1494277/pexels-photo-1494277.jpeg${OPT}`,
        `${PB}/210182/pexels-photo-210182.jpeg${OPT}`,
        `${PB}/2199293/pexels-photo-2199293.jpeg${OPT}`,
        `${PB}/3806978/pexels-photo-3806978.jpeg${OPT}`,
        `${PB}/1838640/pexels-photo-1838640.jpeg${OPT}`,
        `${PB}/1004409/pexels-photo-1004409.jpeg${OPT}`,
        `${PB}/3802510/pexels-photo-3802510.jpeg${OPT}`,
        `${PB}/163786/pexels-photo-163786.jpeg${OPT}`,
    ],
};

const FALLBACK_CAT = {
    'Nacionales':      'politica-gobierno',
    'Deportes':        'deporte-general',
    'Internacionales': 'relaciones-internacionales',
    'Economía':        'economia-mercado',
    'Tecnología':      'tecnologia',
    'Espectáculos':    'cultura-musica',
    'Salud':           'salud-medicina',
    'Educación':       'educacion',
    'Turismo':         'turismo',
    'Ambiente':        'medio-ambiente',
};

function imgLocal(sub, cat) {
    const banco = BANCO_LOCAL[sub] || BANCO_LOCAL[FALLBACK_CAT[cat]] || BANCO_LOCAL['politica-gobierno'];
    return banco[Math.floor(Math.random() * banco.length)];
}

/**
 * Obtener imagen: intenta Pexels con queries RD → banco local.
 * Nunca retorna null.
 */
async function obtenerImagen(titulo, categoria, subtemaLocal, queryIA) {
    const queries = detectarQueriesPexels(titulo, categoria, queryIA);
    const urlPexels = await buscarEnPexels(queries);
    if (urlPexels) return urlPexels;
    console.log(`   📸 Pexels sin resultado → banco local (${subtemaLocal || 'general'})`);
    return imgLocal(subtemaLocal, categoria);
}

// ══════════════════════════════════════════════════════════
// ▶ ALT SEO MEJORADO — GEOLOCALIZADO RD
// ══════════════════════════════════════════════════════════

/**
 * Genera el texto alt de la imagen con términos SEO de RD.
 * Google prioriza el texto alt para indexar imágenes en News.
 * Formato: "[Descripción visual] - [Contexto RD] - El Farol al Día"
 */
function generarAltSEO(titulo, categoria, altIA, subtema) {
    // Si la IA generó un alt bueno (>15 chars), enriquecerlo
    if (altIA && altIA.length > 15) {
        const yaTieneRD = altIA.toLowerCase().includes('dominican') ||
                          altIA.toLowerCase().includes('república') ||
                          altIA.toLowerCase().includes('santo domingo');

        if (yaTieneRD) return `${altIA} - El Farol al Día`;

        // Agregar contexto RD al alt de la IA
        const contextoCat = {
            'Nacionales':      'noticias República Dominicana',
            'Deportes':        'deportes dominicanos',
            'Internacionales': 'noticias internacionales impacto RD',
            'Economía':        'economía República Dominicana',
            'Tecnología':      'tecnología innovación RD',
            'Espectáculos':    'cultura entretenimiento dominicano',
        };
        return `${altIA}, ${contextoCat[categoria] || 'República Dominicana'} - El Farol al Día`;
    }

    // Construir alt desde cero si la IA no lo generó bien
    const base = {
        'Nacionales':      `Noticia nacional ${titulo.substring(0, 40)} - Santo Domingo, República Dominicana`,
        'Deportes':        `Deportes dominicanos ${titulo.substring(0, 40)} - El Farol al Día RD`,
        'Internacionales': `Noticias internacionales ${titulo.substring(0, 30)} - impacto en República Dominicana`,
        'Economía':        `Economía dominicana ${titulo.substring(0, 35)} - finanzas República Dominicana`,
        'Tecnología':      `Tecnología ${titulo.substring(0, 35)} - innovación República Dominicana`,
        'Espectáculos':    `Espectáculos dominicanos ${titulo.substring(0, 35)} - cultura RD`,
    };

    return (base[categoria] || `${titulo.substring(0, 50)} - noticias República Dominicana El Farol al Día`);
}

// ══════════════════════════════════════════════════════════
// SEO HTML META TAGS
// ══════════════════════════════════════════════════════════
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function metaTagsCompletos(n, url) {
    const t   = esc(n.titulo), d = esc(n.seo_description || ''), k = esc(n.seo_keywords || '');
    const img = esc(n.imagen), red = esc(n.redactor), sec = esc(n.seccion);
    const fi  = new Date(n.fecha).toISOString(), ue = esc(url);
    const wc  = (n.contenido || '').split(/\s+/).filter(w => w).length;
    const schema = {
        "@context": "https://schema.org", "@type": "NewsArticle",
        "mainEntityOfPage": { "@type": "WebPage", "@id": url },
        "headline": n.titulo, "description": n.seo_description || '',
        "image": { "@type": "ImageObject", "url": n.imagen, "caption": n.imagen_caption || n.titulo, "width": 1200, "height": 630 },
        "datePublished": fi, "dateModified": fi,
        "author": { "@type": "Person", "name": n.redactor, "url": `${BASE_URL}/nosotros` },
        "publisher": { "@type": "Organization", "name": "El Farol al Día", "url": BASE_URL, "logo": { "@type": "ImageObject", "url": `${BASE_URL}/static/favicon.png` } },
        "articleSection": n.seccion, "wordCount": wc, "inLanguage": "es-DO", "isAccessibleForFree": true
    };
    const bread = {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Inicio", "item": BASE_URL },
            { "@type": "ListItem", "position": 2, "name": n.seccion, "item": `${BASE_URL}/#${(n.seccion || '').toLowerCase()}` },
            { "@type": "ListItem", "position": 3, "name": n.titulo, "item": url }
        ]
    };
    return `<title>${t} | El Farol al Día</title>
<meta name="description" content="${d}"><meta name="keywords" content="${k}"><meta name="author" content="${red}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="${ue}"><link rel="alternate" hreflang="es-DO" href="${ue}"><link rel="alternate" hreflang="es" href="${ue}">
<meta property="og:type" content="article"><meta property="og:title" content="${t}"><meta property="og:description" content="${d}">
<meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(n.imagen_alt || n.titulo)}"><meta property="og:url" content="${ue}">
<meta property="og:site_name" content="El Farol al Día"><meta property="og:locale" content="es_DO">
<meta property="article:published_time" content="${fi}"><meta property="article:modified_time" content="${fi}">
<meta property="article:author" content="${red}"><meta property="article:section" content="${sec}"><meta property="article:tag" content="${k}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}"><meta name="twitter:image" content="${img}">
<meta name="twitter:image:alt" content="${esc(n.imagen_alt || n.titulo)}"><meta name="twitter:site" content="@elfarolaldia">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<script type="application/ld+json">${JSON.stringify(bread)}</script>`;
}

// ══════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════
function slugify(t) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 80);
}

const REDACTORES = [
    { nombre: 'Carlos Méndez',         esp: 'Nacionales' },
    { nombre: 'Laura Santana',         esp: 'Deportes' },
    { nombre: 'Roberto Peña',          esp: 'Internacionales' },
    { nombre: 'Ana María Castillo',    esp: 'Economía' },
    { nombre: 'José Miguel Fernández', esp: 'Tecnología' },
    { nombre: 'Patricia Jiménez',      esp: 'Espectáculos' }
];

function redactor(cat) {
    const match = REDACTORES.filter(r => r.esp === cat);
    return match.length ? match[Math.floor(Math.random() * match.length)].nombre : 'Redacción EFD';
}

// ══════════════════════════════════════════════════════════
// INICIALIZAR BASE DE DATOS
// ══════════════════════════════════════════════════════════
async function inicializarBase() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS noticias(
                id SERIAL PRIMARY KEY,
                titulo VARCHAR(255) NOT NULL,
                slug VARCHAR(255) UNIQUE,
                seccion VARCHAR(100),
                contenido TEXT,
                seo_description VARCHAR(160),
                seo_keywords VARCHAR(255),
                redactor VARCHAR(100),
                imagen TEXT,
                imagen_alt VARCHAR(255),
                imagen_caption TEXT,
                imagen_nombre VARCHAR(100),
                imagen_fuente VARCHAR(50),
                vistas INTEGER DEFAULT 0,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                estado VARCHAR(50) DEFAULT 'publicada'
            )
        `);

        for (const col of ['imagen_alt', 'imagen_caption', 'imagen_nombre', 'imagen_fuente', 'imagen_original']) {
            await client.query(`
                DO $$ BEGIN
                    IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='noticias' AND column_name='${col}')
                    THEN ALTER TABLE noticias ADD COLUMN ${col} TEXT;
                    END IF;
                END $$;
            `).catch(() => {});
        }

        await client.query(`
            CREATE TABLE IF NOT EXISTS rss_procesados(
                id SERIAL PRIMARY KEY,
                item_guid VARCHAR(500) UNIQUE,
                fuente VARCHAR(100),
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // ── TABLA DE MEMORIA IA ──────────────────────────────
        await client.query(`
            CREATE TABLE IF NOT EXISTS memoria_ia(
                id SERIAL PRIMARY KEY,
                tipo VARCHAR(50) NOT NULL,
                valor TEXT NOT NULL,
                categoria VARCHAR(100),
                exitos INTEGER DEFAULT 0,
                fallos INTEGER DEFAULT 0,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ultima_vez TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // Índice para búsquedas rápidas
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_memoria_tipo
            ON memoria_ia(tipo, categoria)
        `).catch(() => {});

        // ── TABLA DE COMENTARIOS ────────────────────────
        await client.query(`
            CREATE TABLE IF NOT EXISTS comentarios(
                id SERIAL PRIMARY KEY,
                noticia_id INTEGER NOT NULL REFERENCES noticias(id) ON DELETE CASCADE,
                nombre VARCHAR(80) NOT NULL,
                texto TEXT NOT NULL,
                aprobado BOOLEAN DEFAULT true,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_comentarios_noticia
            ON comentarios(noticia_id, aprobado, fecha DESC)
        `).catch(() => {});

        const fix = await client.query(`
            UPDATE noticias SET imagen='${PB}/3052454/pexels-photo-3052454.jpeg${OPT}', imagen_fuente='pexels'
            WHERE imagen LIKE '%/images/cache/%' OR imagen LIKE '%fallback%' OR imagen IS NULL OR imagen=''
        `);
        if (fix.rowCount > 0) console.log(`🔧 Imágenes reparadas: ${fix.rowCount}`);
        console.log('✅ BD lista');
    } catch (e) {
        console.error('❌ BD:', e.message);
    } finally {
        client.release();
    }
    // Cargar config IA desde PostgreSQL (persiste entre reinicios)
    await cargarConfigIA();
}

// ══════════════════════════════════════════════════════════
// ▶ SISTEMA DE MEMORIA IA
// Aprende qué queries de Pexels funcionan bien por categoría,
// qué temas generan errores, y construye contexto entre publicaciones
// ══════════════════════════════════════════════════════════

/**
 * Registra un query de Pexels como exitoso o fallido
 * para que el sistema aprenda qué funciona por categoría
 */
async function registrarQueryPexels(query, categoria, exito) {
    try {
        await pool.query(`
            INSERT INTO memoria_ia(tipo, valor, categoria, exitos, fallos)
            VALUES('pexels_query', $1, $2, $3, $4)
            ON CONFLICT DO NOTHING
        `, [query, categoria, exito ? 1 : 0, exito ? 0 : 1]);

        // Si ya existe, actualizar contadores
        await pool.query(`
            UPDATE memoria_ia
            SET exitos = exitos + $1,
                fallos = fallos + $2,
                ultima_vez = NOW()
            WHERE tipo = 'pexels_query' AND valor = $3 AND categoria = $4
        `, [exito ? 1 : 0, exito ? 0 : 1, query, categoria]);
    } catch(e) { /* silencioso */ }
}

/**
 * Obtiene los mejores queries de Pexels aprendidos para una categoría
 * Prioriza los que tienen más éxitos y menos fallos
 */
async function obtenerMejoresQueries(categoria) {
    try {
        const r = await pool.query(`
            SELECT valor, exitos, fallos,
                   (exitos::float / GREATEST(exitos + fallos, 1)) as tasa_exito
            FROM memoria_ia
            WHERE tipo = 'pexels_query'
              AND (categoria = $1 OR categoria = 'general')
              AND exitos > 0
            ORDER BY tasa_exito DESC, exitos DESC
            LIMIT 5
        `, [categoria]);
        return r.rows.map(r => r.valor);
    } catch(e) { return []; }
}

/**
 * Registra un error de generación para no repetirlo
 */
async function registrarError(tipo, descripcion, categoria) {
    try {
        await pool.query(`
            INSERT INTO memoria_ia(tipo, valor, categoria, fallos)
            VALUES('error', $1, $2, 1)
            ON CONFLICT DO NOTHING
        `, [descripcion.substring(0, 200), categoria]);

        await pool.query(`
            UPDATE memoria_ia
            SET fallos = fallos + 1, ultima_vez = NOW()
            WHERE tipo = 'error' AND valor = $1
        `, [descripcion.substring(0, 200)]);
    } catch(e) { /* silencioso */ }
}

/**
 * Construye contexto de memoria para el prompt de Gemini:
 * - Últimas 15 noticias publicadas (no repetir)
 * - Temas que fallaron recientemente (evitar)
 * - Queries exitosas de imagen (sugerir)
 */
async function construirMemoria(categoria) {
    let memoria = '';
    try {
        // Noticias recientes — no repetir
        const recientes = await pool.query(`
            SELECT titulo, fecha FROM noticias
            WHERE estado = 'publicada'
            ORDER BY fecha DESC LIMIT 15
        `);
        if (recientes.rows.length) {
            memoria += `\n⛔ YA PUBLICADAS — NO repetir ni parafrasear:\n`;
            memoria += recientes.rows.map((x, i) => `${i+1}. ${x.titulo}`).join('\n');
            memoria += '\n';
        }

        // Errores recientes — evitar esos temas
        const errores = await pool.query(`
            SELECT valor FROM memoria_ia
            WHERE tipo = 'error' AND categoria = $1
              AND ultima_vez > NOW() - INTERVAL '24 hours'
            ORDER BY fallos DESC LIMIT 3
        `, [categoria]);
        if (errores.rows.length) {
            memoria += `\n⚠️ TEMAS CON PROBLEMAS RECIENTES (evitar):\n`;
            memoria += errores.rows.map(e => `- ${e.valor}`).join('\n');
            memoria += '\n';
        }

        // Queries de imagen exitosas — sugerir
        const mejores = await obtenerMejoresQueries(categoria);
        if (mejores.length) {
            memoria += `\n💡 QUERIES DE IMAGEN QUE FUNCIONAN BIEN PARA ${categoria.toUpperCase()}:\n`;
            memoria += mejores.map(q => `- "${q}"`).join('\n');
            memoria += '\n';
        }

    } catch(e) { /* silencioso — memoria es opcional */ }
    return memoria;
}

// ── REGENERAR WATERMARKS AL ARRANCAR ─────────────────────────
// Si Railway limpió /tmp (cada ~8 días), restaura las imágenes
// usando la URL original guardada en BD
async function regenerarWatermarksLostidos() {
    try {
        // Buscar noticias cuya imagen apunta a /img/ pero el archivo ya no existe en /tmp
        const r = await pool.query(`
            SELECT id, imagen, imagen_nombre, imagen_original
            FROM noticias
            WHERE imagen LIKE '%/img/%'
              AND imagen_original IS NOT NULL
              AND imagen_original != ''
            ORDER BY fecha DESC LIMIT 50
        `);
        if (!r.rows.length) return;

        let regeneradas = 0;
        for (const n of r.rows) {
            const nombre = n.imagen_nombre || n.imagen.split('/img/')[1];
            if (!nombre) continue;
            const ruta = path.join('/tmp', nombre);
            if (fs.existsSync(ruta)) continue; // ya existe, no regenerar

            // El archivo no existe — reprocesar con watermark
            const resultado = await aplicarMarcaDeAgua(n.imagen_original);
            if (resultado.procesada && resultado.nombre) {
                await pool.query(
                    `UPDATE noticias SET imagen=$1, imagen_nombre=$2 WHERE id=$3`,
                    [`${BASE_URL}/img/${resultado.nombre}`, resultado.nombre, n.id]
                );
                regeneradas++;
            }
            // Pequeña pausa para no saturar al arrancar
            await new Promise(r => setTimeout(r, 200));
        }
        if (regeneradas > 0) {
            console.log(`🏮 Watermarks regenerados: ${regeneradas}`);
            invalidarCache();
        }
    } catch(e) {
        console.log(`⚠️ Regeneración watermarks: ${e.message}`);
    }
}
// ══════════════════════════════════════════════════════════
async function generarNoticia(categoria, comunicadoExterno = null) {
    try {
        if (!CONFIG_IA.enabled) return { success: false, error: 'IA desactivada' };

        // Memoria enriquecida: noticias previas + errores + queries exitosas
        const memoria = await construirMemoria(categoria);

        // Fuente del contenido
        const fuenteContenido = comunicadoExterno
            ? `\nCOMUNICADO OFICIAL:\n"""\n${comunicadoExterno}\n"""\nRedacta una noticia profesional basada en este comunicado. Reescribe con tu estilo periodístico, no copies textualmente.`
            : `\nEscribe una noticia NUEVA sobre la categoría "${categoria}" para República Dominicana. Que sea un hecho real y relevante del contexto actual.`;

        // Consultar Wikipedia ANTES de armar el prompt
        // Si viene de RSS, limpiar el prefijo "TÍTULO:" de la primera línea
        const temaParaWiki = comunicadoExterno
            ? (comunicadoExterno.split('\n')[0] || '').replace(/^T[IÍ]TULO:\s*/i, '').trim() || categoria
            : categoria;

        const contextoWiki = await buscarContextoWikipedia(temaParaWiki, categoria);

        // Prompt periodístico mejorado — coherencia imagen + SEO real
        const prompt = `${CONFIG_IA.instruccion_principal}

ROL: Eres el editor jefe de El Farol al Día con 20 años de experiencia en periodismo dominicano. Escribes exactamente como el Listín Diario o Diario Libre: datos concretos, fuentes verificables, impacto real para el ciudadano dominicano. Periodismo serio, sin exageración ni sensacionalismo.

PENSAMIENTO CRÍTICO ANTES DE ESCRIBIR:
Antes de redactar, respóndete internamente estas preguntas:
1. ¿Quién se ve afectado por esta noticia en República Dominicana?
2. ¿Qué dato concreto (cifra, fecha, nombre de institución) hace esta noticia creíble?
3. ¿Cuál es el ángulo local para Santo Domingo Este / Los Mina / Invivienda si aplica?
4. ¿Qué fuente oficial o institución respalda la información?
5. ¿Qué cambia para el lector dominicano después de leer esto?
Solo procede a escribir cuando tengas respuesta a estas 5 preguntas.

${memoria}
${contextoWiki}
${fuenteContenido}

CATEGORÍA: ${categoria}
TONO: ${CONFIG_IA.tono} — periodismo profesional E-E-A-T (Experiencia, Experticia, Autoridad, Confianza)
EXTENSIÓN: 400-500 palabras en 5 párrafos estructurados
EVITAR: ${CONFIG_IA.evitar}
ÉNFASIS LOCAL: ${CONFIG_IA.enfasis}

ESTRUCTURA OBLIGATORIA (pirámide invertida periodística):
- Párrafo 1 — LEAD (las 5W): QUÉ + QUIÉN + CUÁNDO + DÓNDE + POR QUÉ en máximo 3 líneas. El dato más importante va primero.
- Párrafo 2 — CONTEXTO: Antecedentes con datos concretos (cifras reales, porcentajes, fechas verificables de RD). Sin este párrafo la noticia no tiene credibilidad.
- Párrafo 3 — FUENTES: Citar institución o declaración oficial (Presidencia, ministerio, policía, banco, experto). Usar verbos de atribución: "informó", "confirmó", "según", "declaró".
- Párrafo 4 — IMPACTO CIUDADANO: ¿Qué cambia concretamente para la gente en RD? ¿Precios, servicios, seguridad, empleos?
- Párrafo 5 — CIERRE INFORMATIVO: Próximos pasos, fecha importante próxima, o contexto regional Caribe/LatAm.

REGLAS SEO GOOGLE NEWS 2025 — CRÍTICO PARA INDEXACIÓN:
TÍTULO:
- Entre 10 y 110 caracteres (ideal 60-70 para Google News)
- Debe incluir: hecho concreto + actor + contexto RD
- Formato: [Verbo de acción] + [Quién] + [Qué] + [RD/Dominicana/Santo Domingo]
- BUENOS: "Banco Central RD reduce tasa a 7% para impulsar crédito hipotecario"
- MALOS: "Importantes avances en materia económica" (vago, sin datos, sin actor)
- PROHIBIDO: fechas en el título ("En marzo..."), números al inicio, clickbait

DESCRIPCIÓN SEO (meta description):
- Exactamente 150-160 caracteres — ni más, ni menos
- Responde: QUÉ pasó + QUIÉN lo hizo + DÓNDE en RD + impacto directo
- Incluir keyword principal + "República Dominicana" o ciudad específica
- NO repetir el título palabra por palabra

KEYWORDS (5 palabras clave):
- Siempre incluir "república dominicana" como primera keyword
- Agregar ciudad específica si aplica (santo domingo, santiago, etc.)
- Incluir el tema principal (economía, seguridad, béisbol, etc.)
- Pensar en cómo buscaría esto un dominicano en Google

SEÑALES E-E-A-T EN EL CONTENIDO:
- Mencionar al menos 1 institución oficial dominicana con su nombre completo
- Incluir al menos 1 dato numérico verificable (%, RD$, fecha, cantidad)
- Usar lenguaje de atribución: "según el Ministerio de...", "informó la Policía Nacional"
- Mantener neutralidad — presentar hechos, no opiniones

COHERENCIA IMAGEN — CRÍTICO PARA PEXELS:
La QUERY_IMAGEN describe la escena visual exacta de la noticia.
MAPEO OBLIGATORIO POR TEMA:
  economía/remesas/banco/finanzas  → "latin america business finance professionals"
  seguridad/policía/crimen/narcotráfico → "caribbean police officers law enforcement"
  política/gobierno/ministerio → "dominican republic government building officials"
  béisbol → "dominican republic baseball player stadium bat"
  fútbol/deporte → "caribbean football soccer athlete stadium"
  natación/atletismo → "athlete competition sports arena"
  salud/hospital/medicina → "latin america hospital doctor medical staff"
  tecnología/digital/innovación → "latin america technology digital innovation"
  educación/escuela/universidad → "caribbean students classroom learning"
  turismo/playa/hotel → "dominican republic beach resort tourism"
  construcción/vivienda/MOPC → "latin america construction workers building"
  medio ambiente/clima → "caribbean nature environment conservation"
  haití/frontera/migración → "dominican republic haiti border diplomacy"
  elecciones/votación → "latin america election voting democracy"
  cultura/música/merengue → "dominican republic culture music festival"
PROHIBIDO ABSOLUTAMENTE: wedding, bride, groom, couple, romance, flowers, fashion, cat, dog, pet, party, birthday
SI HAY DUDA: "dominican republic santo domingo urban city"

RESPONDE EXACTAMENTE CON ESTE FORMATO:
TITULO: [60-70 chars, hecho+actor+RD, sin fecha, sin clickbait]
DESCRIPCION: [150-160 chars exactos, qué+quién+dónde+impacto]
PALABRAS: [5 keywords: primera siempre "república dominicana"]
QUERY_IMAGEN: [3-5 palabras inglés, escena periodística, sin bodas ni mascotas]
ALT_IMAGEN: [15-20 palabras español SEO: describe la imagen + tema + RD]
SUBTEMA_LOCAL: [uno de: ${Object.keys(BANCO_LOCAL).join(', ')}]
CONTENIDO:
[400-500 palabras, 5 párrafos, pirámide invertida, párrafos separados por línea en blanco]`;

        console.log(`\n📰 Generando: ${categoria}${comunicadoExterno ? ' (RSS)' : ''}`);
        const texto = await llamarGemini(prompt);

        // Parsear respuesta de Gemini
        // Gemini a veces añade ** o ## antes de las etiquetas — los limpiamos
        const textoLimpio = texto.replace(/^\s*[*#]+\s*/gm, '');

        let titulo = '', desc = '', pals = '', qi = '', ai = '', sub = '', contenido = '';
        let enContenido = false;
        const bloques = [];

        for (const linea of textoLimpio.split('\n')) {
            const t = linea.trim();
            if      (t.startsWith('TITULO:'))        titulo = t.replace('TITULO:', '').trim();
            else if (t.startsWith('DESCRIPCION:'))   desc   = t.replace('DESCRIPCION:', '').trim();
            else if (t.startsWith('PALABRAS:'))      pals   = t.replace('PALABRAS:', '').trim();
            else if (t.startsWith('QUERY_IMAGEN:'))  qi     = t.replace('QUERY_IMAGEN:', '').trim();
            else if (t.startsWith('ALT_IMAGEN:'))    ai     = t.replace('ALT_IMAGEN:', '').trim();
            else if (t.startsWith('SUBTEMA_LOCAL:')) sub    = t.replace('SUBTEMA_LOCAL:', '').trim();
            else if (t.startsWith('CONTENIDO:'))     enContenido = true;
            else if (enContenido && t.length > 0)    bloques.push(t);
        }

        contenido = bloques.join('\n\n');
        titulo    = titulo.replace(/[*_#`"]/g, '').trim();
        desc      = desc.replace(/[*_#`]/g, '').trim();

        // Validación más estricta — detecta respuestas truncadas o mal formateadas
        if (!titulo)
            throw new Error('Gemini no devolvió TITULO');
        if (!contenido || contenido.length < 300)
            throw new Error(`Contenido insuficiente (${contenido.length} chars) — posible respuesta truncada`);

        console.log(`   📝 ${titulo}`);

        // Imagen con lógica RD mejorada
        const urlOrig    = await obtenerImagen(titulo, categoria, sub, qi);
        const imgResult  = await aplicarMarcaDeAgua(urlOrig);
        const urlFinal   = imgResult.procesada ? `${BASE_URL}/img/${imgResult.nombre}` : urlOrig;

        // Alt SEO geolocalizado
        const altFinal   = generarAltSEO(titulo, categoria, ai, sub);

        // Guardar en BD
        const sl    = slugify(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug=$1', [sl]);
        const slFin  = existe.rows.length ? `${sl}-${Date.now()}` : sl;

        await pool.query(
            `INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
                titulo.substring(0, 255), slFin, categoria,
                contenido.substring(0, 10000),
                desc.substring(0, 160),
                (pals || categoria).substring(0, 255),
                redactor(categoria),
                urlFinal,
                altFinal.substring(0, 255),
                `Fotografía periodística: ${titulo}`,
                imgResult.nombre || 'efd.jpg',
                'el-farol',
                urlOrig,        // URL original Pexels — fallback si /tmp se limpia
                'publicada'
            ]
        );

        console.log(`\n✅ /noticia/${slFin}`);
        invalidarCache();

        // Aprender: registrar query de imagen exitosa
        if (qi) registrarQueryPexels(qi, categoria, true);

        // Publicar en redes (no bloquea)
        Promise.allSettled([
            publicarEnFacebook(titulo, slFin, urlFinal, desc),
            publicarEnTwitter(titulo, slFin, desc)
        ]).then(results => {
            const fb = results[0].value ? '📘✅' : '📘❌';
            const tw = results[1].value ? '🐦✅' : '🐦❌';
            console.log(`   Redes: ${fb} ${tw}`);
        });

        return { success: true, slug: slFin, titulo, alt: altFinal, mensaje: '✅ Publicada en web + redes' };

    } catch (error) {
        console.error('❌', error.message);
        // Aprender del error para no repetirlo
        await registrarError('generacion', error.message, categoria);
        return { success: false, error: error.message };
    }
}

// ══════════════════════════════════════════════════════════
// RSS PORTALES GOBIERNO RD
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// FUENTES RSS — 30 FUENTES (gobierno RD + medios dominicanos + Caribe)
// ══════════════════════════════════════════════════════════
const FUENTES_RSS = [
    // ── GOBIERNO RD (10 originales) ──
    { url: 'https://presidencia.gob.do/feed',           categoria: 'Nacionales',      nombre: 'Presidencia RD' },
    { url: 'https://policia.gob.do/feed',               categoria: 'Nacionales',      nombre: 'Policía Nacional' },
    { url: 'https://www.mopc.gob.do/feed',              categoria: 'Nacionales',      nombre: 'MOPC' },
    { url: 'https://www.salud.gob.do/feed',             categoria: 'Nacionales',      nombre: 'Salud Pública' },
    { url: 'https://www.educacion.gob.do/feed',         categoria: 'Nacionales',      nombre: 'Educación' },
    { url: 'https://www.bancentral.gov.do/feed',        categoria: 'Economía',        nombre: 'Banco Central' },
    { url: 'https://mepyd.gob.do/feed',                 categoria: 'Economía',        nombre: 'MEPyD' },
    { url: 'https://www.invivienda.gob.do/feed',        categoria: 'Nacionales',      nombre: 'Invivienda' },
    { url: 'https://mitur.gob.do/feed',                 categoria: 'Nacionales',      nombre: 'Turismo' },
    { url: 'https://pgr.gob.do/feed',                   categoria: 'Nacionales',      nombre: 'Procuraduría' },

    // ── MEDIOS DOMINICANOS ──
    { url: 'https://www.diariolibre.com/feed',          categoria: 'Nacionales',      nombre: 'Diario Libre' },
    { url: 'https://listindiario.com/feed',             categoria: 'Nacionales',      nombre: 'Listín Diario' },
    { url: 'https://elnacional.com.do/feed/',           categoria: 'Nacionales',      nombre: 'El Nacional' },
    { url: 'https://www.eldinero.com.do/feed/',         categoria: 'Economía',        nombre: 'El Dinero' },
    { url: 'https://www.elcaribe.com.do/feed/',         categoria: 'Nacionales',      nombre: 'El Caribe' },
    { url: 'https://acento.com.do/feed/',               categoria: 'Nacionales',      nombre: 'Acento' },
    { url: 'https://www.hoy.com.do/feed/',              categoria: 'Nacionales',      nombre: 'Hoy' },
    { url: 'https://www.noticiassin.com/feed/',         categoria: 'Nacionales',      nombre: 'Noticias SIN' },
    { url: 'https://www.cdt.com.do/feed/',              categoria: 'Deportes',        nombre: 'CDT Deportes' },
    { url: 'https://www.beisbolrd.com/feed/',           categoria: 'Deportes',        nombre: 'Béisbol RD' },

    // ── INTERNACIONALES / CARIBE ──
    { url: 'https://www.reuters.com/arc/outboundfeeds/rss/category/latam/?outputType=xml', categoria: 'Internacionales', nombre: 'Reuters LatAm' },
    { url: 'https://feeds.bbci.co.uk/mundo/rss.xml',   categoria: 'Internacionales', nombre: 'BBC Mundo' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', categoria: 'Internacionales', nombre: 'NYT World' },
    { url: 'https://www.elnuevoherald.com/ultimas-noticias/?widgetName=rssfeed&widgetContentId=725095&getXmlFeed=true', categoria: 'Internacionales', nombre: 'El Nuevo Herald' },

    // ── TECNOLOGÍA / ECONOMÍA GLOBAL ──
    { url: 'https://feeds.feedburner.com/TechCrunch',  categoria: 'Tecnología',      nombre: 'TechCrunch' },
    { url: 'https://www.wired.com/feed/rss',           categoria: 'Tecnología',      nombre: 'Wired' },
    { url: 'https://feeds.bloomberg.com/markets/news.rss', categoria: 'Economía',   nombre: 'Bloomberg Markets' },

    // ── ESPECTÁCULOS / CULTURA ──
    { url: 'https://www.primerahora.com/entretenimiento/feed/',  categoria: 'Espectáculos', nombre: 'Primera Hora Ent.' },
    { url: 'https://www.telemundo.com/shows/rss',      categoria: 'Espectáculos',    nombre: 'Telemundo' },
    { url: 'https://www.univision.com/rss',            categoria: 'Espectáculos',    nombre: 'Univision' },
];

async function procesarRSS() {
    if (!CONFIG_IA.enabled) return;
    console.log('\n📡 Procesando RSS portales gobierno...');
    let procesadas = 0;

    for (const fuente of FUENTES_RSS) {
        try {
            const feed = await rssParser.parseURL(fuente.url).catch(() => null);
            if (!feed?.items?.length) continue;

            for (const item of feed.items.slice(0, 3)) {
                const guid = item.guid || item.link || item.title;
                if (!guid) continue;

                const yaExiste = await pool.query('SELECT id FROM rss_procesados WHERE item_guid=$1', [guid.substring(0, 500)]);
                if (yaExiste.rows.length) continue;

                const comunicado = [
                    item.title         ? `TÍTULO: ${item.title}`                              : '',
                    item.contentSnippet? `RESUMEN: ${item.contentSnippet}`                    : '',
                    item.content       ? `CONTENIDO: ${item.content?.substring(0, 2000)}`     : '',
                    `FUENTE OFICIAL: ${fuente.nombre}`
                ].filter(Boolean).join('\n');

                const resultado = await generarNoticia(fuente.categoria, comunicado);
                if (resultado.success) {
                    await pool.query('INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING', [guid.substring(0, 500), fuente.nombre]);
                    procesadas++;
                    await new Promise(r => setTimeout(r, 5000));
                }
                break;
            }
        } catch (err) {
            console.warn(`   ⚠️ ${fuente.nombre}: ${err.message}`);
        }
    }
    console.log(`\n📡 RSS: ${procesadas} noticias nuevas`);
}

// ══════════════════════════════════════════════════════════
// CRON
// ══════════════════════════════════════════════════════════
const CATS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];

// ── KEEP-ALIVE — evita cold start de Railway ──────────
// Hace ping al propio servidor cada 14 minutos para mantenerlo despierto
cron.schedule('*/14 * * * *', async () => {
    try {
        await fetch(`http://localhost:${PORT}/health`);
    } catch(e) { /* silencioso */ }
});

// Cada 4 horas: generar una noticia nueva
cron.schedule('0 */4 * * *', async () => {
    if (!CONFIG_IA.enabled) return;
    await generarNoticia(CATS[Math.floor(Math.random() * CATS.length)]);
});

// 4 veces al día: procesar RSS gobierno
cron.schedule('0 1,7,13,19 * * *', async () => {
    await procesarRSS();
});

// ══════════════════════════════════════════════════════════
// RUTAS
// ══════════════════════════════════════════════════════════
app.get('/health',     (req, res) => res.json({ status: 'OK', version: '31.0' }));
app.get('/',           (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion',  (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/contacto',   (req, res) => res.sendFile(path.join(__dirname, 'client', 'contacto.html')));
app.get('/nosotros',   (req, res) => res.sendFile(path.join(__dirname, 'client', 'nosotros.html')));
app.get('/privacidad', (req, res) => res.sendFile(path.join(__dirname, 'client', 'privacidad.html')));

// ── CACHÉ EN MEMORIA — evita ir a BD en cada visita ──
let _cacheNoticias = null;
let _cacheFecha    = 0;
const CACHE_TTL    = 60 * 1000; // 60 segundos

function invalidarCache() { _cacheNoticias = null; _cacheFecha = 0; }

app.get('/api/noticias', async (req, res) => {
    try {
        // Servir desde caché si es reciente
        if (_cacheNoticias && (Date.now() - _cacheFecha) < CACHE_TTL) {
            return res.json({ success: true, noticias: _cacheNoticias, cached: true });
        }
        const r = await pool.query(
            `SELECT id,titulo,slug,seccion,imagen,imagen_alt,fecha,vistas,redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30`,
            ['publicada']
        );
        _cacheNoticias = r.rows;
        _cacheFecha    = Date.now();
        res.setHeader('Cache-Control', 'public,max-age=60');
        res.json({ success: true, noticias: r.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/actualizar-imagen/:id', async (req, res) => {
    const { pin, imagen } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    const id = parseInt(req.params.id);
    if (!id || !imagen) return res.status(400).json({ success: false, error: 'Faltan datos' });
    try {
        await pool.query('UPDATE noticias SET imagen=$1 WHERE id=$2', [imagen, id]);
        invalidarCache();
        console.log(`🖼️ Imagen actualizada: ID ${id}`);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/eliminar/:id', async (req, res) => {
    const { pin } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'ID inválido' });
    try {
        await pool.query('DELETE FROM noticias WHERE id=$1', [id]);
        invalidarCache();
        console.log(`🗑️ Noticia eliminada: ID ${id}`);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/generar-noticia', async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });
    const r = await generarNoticia(categoria);
    res.status(r.success ? 200 : 500).json(r);
});

app.post('/api/procesar-rss', async (req, res) => {
    const { pin } = req.body;
    if (pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    procesarRSS();
    res.json({ success: true, mensaje: 'RSS iniciado' });
});

// ▶ Endpoint para probar Wikipedia en aislado
// Ver memoria del sistema
// ── COMENTARIOS ─────────────────────────────────────────
// ORDEN CRÍTICO: rutas específicas ANTES que rutas con parámetros dinámicos

// POST: eliminar comentario — VA PRIMERO (evita que Express confunda "eliminar" con :noticia_id)
app.post('/api/comentarios/eliminar/:id', async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ error: 'PIN incorrecto' });
    try {
        await pool.query('DELETE FROM comentarios WHERE id=$1', [parseInt(req.params.id)]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET: todos los comentarios para admin
app.get('/api/admin/comentarios', async (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'PIN requerido' });
    try {
        const r = await pool.query(`
            SELECT c.id, c.nombre, c.texto, c.fecha,
                   n.titulo as noticia_titulo, n.slug as noticia_slug
            FROM comentarios c
            JOIN noticias n ON n.id = c.noticia_id
            ORDER BY c.fecha DESC LIMIT 50
        `);
        res.json({ success: true, comentarios: r.rows });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET: comentarios de una noticia (ruta paramétrica — va DESPUÉS de las específicas)
app.get('/api/comentarios/:noticia_id', async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT id, nombre, texto, fecha
            FROM comentarios
            WHERE noticia_id=$1 AND aprobado=true
            ORDER BY fecha ASC
        `, [req.params.noticia_id]);
        res.json({ success: true, comentarios: r.rows });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST: publicar comentario
app.post('/api/comentarios/:noticia_id', async (req, res) => {
    const { nombre, texto } = req.body;
    const noticia_id = parseInt(req.params.noticia_id);
    if (isNaN(noticia_id) || noticia_id <= 0)
        return res.status(400).json({ success: false, error: 'ID de noticia inválido' });
    if (!nombre?.trim() || !texto?.trim())
        return res.status(400).json({ success: false, error: 'Nombre y comentario son requeridos' });
    if (nombre.trim().length > 80)
        return res.status(400).json({ success: false, error: 'Nombre demasiado largo' });
    if (texto.trim().length > 1000)
        return res.status(400).json({ success: false, error: 'Comentario muy largo (máx 1000 chars)' });
    if (texto.trim().length < 3)
        return res.status(400).json({ success: false, error: 'Comentario muy corto' });
    try {
        const r = await pool.query(`
            INSERT INTO comentarios(noticia_id, nombre, texto)
            VALUES($1, $2, $3)
            RETURNING id, nombre, texto, fecha
        `, [noticia_id, nombre.trim().substring(0,80), texto.trim().substring(0,1000)]);
        console.log(`💬 Comentario: noticia ${noticia_id} — ${nombre.trim()}`);
        res.json({ success: true, comentario: r.rows[0] });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/memoria', async (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'PIN requerido' });
    try {
        const queries = await pool.query(`
            SELECT tipo, valor, categoria, exitos, fallos,
                   ROUND((exitos::float / GREATEST(exitos+fallos,1))*100) as pct_exito,
                   ultima_vez
            FROM memoria_ia
            ORDER BY ultima_vez DESC LIMIT 50
        `);
        res.json({ success: true, registros: queries.rows });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/wikipedia', async (req, res) => {
    const { tema, categoria } = req.query;
    if (!tema) return res.status(400).json({ error: 'Falta ?tema=' });
    const contexto = await buscarContextoWikipedia(tema, categoria || 'Nacionales');
    res.json({ success: true, longitud: contexto.length, contexto });
});

app.get('/noticia/:slug', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM noticias WHERE slug=$1 AND estado=$2', [req.params.slug, 'publicada']);
        if (!r.rows.length) return res.status(404).send('No encontrada');

        const n = r.rows[0];
        await pool.query('UPDATE noticias SET vistas=vistas+1 WHERE id=$1', [n.id]);

        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
            const urlN  = `${BASE_URL}/noticia/${n.slug}`;
            const cHTML = n.contenido.split('\n').filter(p => p.trim()).map(p => `<p>${p.trim()}</p>`).join('');
            html = html
                .replace('<!-- META_TAGS -->', metaTagsCompletos(n, urlN))
                .replace(/{{TITULO}}/g,    esc(n.titulo))
                .replace(/{{CONTENIDO}}/g, cHTML)
                .replace(/{{FECHA}}/g,     new Date(n.fecha).toLocaleDateString('es-DO', { year: 'numeric', month: 'long', day: 'numeric' }))
                .replace(/{{IMAGEN}}/g,    n.imagen)
                .replace(/{{ALT}}/g,       esc(n.imagen_alt || n.titulo))
                .replace(/{{VISTAS}}/g,    n.vistas)
                .replace(/{{REDACTOR}}/g,  esc(n.redactor))
                .replace(/{{SECCION}}/g,   esc(n.seccion))
                .replace(/{{URL}}/g,       encodeURIComponent(urlN));
            res.setHeader('Content-Type',  'text/html;charset=utf-8');
            res.setHeader('Cache-Control', 'public,max-age=300');
            res.send(html);
        } catch (e) {
            res.json({ success: true, noticia: n });
        }
    } catch (e) {
        res.status(500).send('Error');
    }
});

app.get('/sitemap.xml', async (req, res) => {
    try {
        const r = await pool.query('SELECT slug,fecha FROM noticias WHERE estado=$1 ORDER BY fecha DESC', ['publicada']);
        const now = Date.now();
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `<url><loc>${BASE_URL}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>\n`;
        r.rows.forEach(n => {
            const d = (now - new Date(n.fecha).getTime()) / 86400000;
            xml += `<url><loc>${BASE_URL}/noticia/${n.slug}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><changefreq>${d < 1 ? 'hourly' : d < 7 ? 'daily' : 'weekly'}</changefreq><priority>${d < 1 ? '1.0' : d < 7 ? '0.9' : d < 30 ? '0.7' : '0.5'}</priority></url>\n`;
        });
        xml += '</urlset>';
        res.header('Content-Type',  'application/xml');
        res.header('Cache-Control', 'public,max-age=3600');
        res.send(xml);
    } catch (e) {
        res.status(500).send('Error');
    }
});

app.get('/robots.txt', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send(`User-agent: *\nAllow: /\nDisallow: /api/admin\nDisallow: /redaccion\n\nUser-agent: Googlebot\nAllow: /\nCrawl-delay: 1\n\nSitemap: ${BASE_URL}/sitemap.xml`);
});

app.get('/api/estadisticas', async (req, res) => {
    try {
        const r = await pool.query('SELECT COUNT(*) as c, SUM(vistas) as v FROM noticias WHERE estado=$1', ['publicada']);
        res.json({ success: true, totalNoticias: parseInt(r.rows[0].c), totalVistas: parseInt(r.rows[0].v) || 0 });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/configuracion', (req, res) => {
    try {
        const c = fs.existsSync(path.join(__dirname, 'config.json'))
            ? JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
            : { googleAnalytics: '' };
        res.json({ success: true, config: c });
    } catch (e) {
        res.json({ success: true, config: { googleAnalytics: '' } });
    }
});

app.post('/api/configuracion', express.json(), (req, res) => {
    const { pin, googleAnalytics } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    try {
        fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify({ googleAnalytics }, null, 2));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/publicar', express.json(), async (req, res) => {
    const { pin, titulo, seccion, contenido, redactor: red } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN' });
    if (!titulo || !seccion || !contenido) return res.status(400).json({ success: false, error: 'Faltan campos' });
    try {
        const sl = slugify(titulo);
        const e  = await pool.query('SELECT id FROM noticias WHERE slug=$1', [sl]);
        const slF = e.rows.length ? `${sl}-${Date.now()}` : sl;
        await pool.query(
            `INSERT INTO noticias(titulo,slug,seccion,contenido,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [titulo, slF, seccion, contenido, red || 'Manual',
             `${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`,
             `${titulo} - noticias República Dominicana El Farol al Día`,
             `Fotografía: ${titulo}`, 'efd.jpg', 'el-farol', 'publicada']
        );
        res.json({ success: true, slug: slF });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/admin/config', (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    res.json(CONFIG_IA);
});

app.post('/api/admin/config', express.json(), async (req, res) => {
    const { pin, enabled, instruccion_principal, tono, extension, evitar, enfasis } = req.body;
    if (pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    // Actualizar en memoria
    if (enabled !== undefined)  CONFIG_IA.enabled = enabled;
    if (instruccion_principal)  CONFIG_IA.instruccion_principal = instruccion_principal;
    if (tono)                   CONFIG_IA.tono = tono;
    if (extension)              CONFIG_IA.extension = extension;
    if (evitar)                 CONFIG_IA.evitar = evitar;
    if (enfasis)                CONFIG_IA.enfasis = enfasis;
    // Guardar en PostgreSQL — persiste entre reinicios
    const ok = await guardarConfigIA(CONFIG_IA);
    res.json({ success: ok });
});

app.get('/status', async (req, res) => {
    try {
        const r   = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado=$1', ['publicada']);
        const rss = await pool.query('SELECT COUNT(*) FROM rss_procesados');
        res.json({
            status: 'OK', version: '31.0',
            noticias:       parseInt(r.rows[0].count),
            rss_procesados: parseInt(rss.rows[0].count),
            facebook:       FB_PAGE_ID && FB_PAGE_TOKEN    ? '✅ Activo' : '⚠️ Sin credenciales',
            twitter:        TWITTER_API_KEY && TWITTER_ACCESS_TOKEN ? '✅ Activo' : '⚠️ Sin credenciales',
            pexels_api:     PEXELS_API_KEY ? '✅ Activa' : '⚠️ Sin key',
            wikipedia:      '✅ Activa (API pública, sin key)',
            marca_de_agua:  fs.existsSync(WATERMARK_PATH) ? '✅ Activa' : '⚠️ Falta watermark.png',
            ia_activa:      CONFIG_IA.enabled,
            sistema:        'Web + Facebook + Twitter + RSS gobierno + Wikipedia + Watermark + SEO'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.use((req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));

// ══════════════════════════════════════════════════════════
// ARRANQUE
// ══════════════════════════════════════════════════════════
async function iniciar() {
    await inicializarBase();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — V32.0                                     ║
╠══════════════════════════════════════════════════════════════════╣
║  🌐 Web · 📘 Facebook · 🐦 Twitter · 📚 Wikipedia               ║
║  🧠 Memoria IA · 💬 Comentarios · 🔍 SEO E-E-A-T               ║
║  🏮 Watermark auto-regenera si Railway limpia /tmp              ║
║                                                                  ║
║  Facebook:  ${FB_PAGE_ID && FB_PAGE_TOKEN            ? '✅ ACTIVO          ' : '⚠️  Sin credenciales'}║
║  Twitter:   ${TWITTER_API_KEY && TWITTER_ACCESS_TOKEN? '✅ ACTIVO          ' : '⚠️  Sin credenciales'}║
║  Watermark: ${fs.existsSync(WATERMARK_PATH)          ? '✅ ACTIVA          ' : '⚠️  Falta watermark '}║
╚══════════════════════════════════════════════════════════════════╝`);
    });
    // 5 segundos después de arrancar: regenerar watermarks si /tmp fue limpiado
    setTimeout(regenerarWatermarksLostidos, 5000);
}

iniciar();
module.exports = app;
