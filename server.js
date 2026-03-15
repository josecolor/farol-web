/**
 * 🏮 EL FAROL AL DÍA — V31.0 FINAL - 100% FUNCIONAL
 * + Wikipedia API como contexto inteligente para Gemini
 * + Lógica de imágenes mejorada (prioridad RD / SDE)
 * + Alt SEO geolocalizado República Dominicana
 * + Query de imagen inteligente por zona local
 * + SSL CORREGIDO - SIN ERRORES
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

// Validaciones de entorno
if (!process.env.DATABASE_URL) { 
    console.error('❌ DATABASE_URL requerido');  
    process.exit(1); 
}
if (!process.env.GEMINI_API_KEY) { 
    console.error('❌ GEMINI_API_KEY requerido'); 
    process.exit(1); 
}

// Credenciales opcionales
const PEXELS_API_KEY        = process.env.PEXELS_API_KEY        || null;
const FB_PAGE_ID            = process.env.FB_PAGE_ID            || null;
const FB_PAGE_TOKEN         = process.env.FB_PAGE_TOKEN         || null;
const TWITTER_API_KEY       = process.env.TWITTER_API_KEY       || null;
const TWITTER_API_SECRET    = process.env.TWITTER_API_SECRET    || null;
const TWITTER_ACCESS_TOKEN  = process.env.TWITTER_ACCESS_TOKEN  || null;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET || null;

// Rutas estáticas
const WATERMARK_PATH = path.join(__dirname, 'static', 'watermark.png');
const rssParser      = new RSSParser({ timeout: 10000 });

// ══════════════════════════════════════════════════════════
// ▶ BASE DE DATOS - CON SSL CORREGIDO (SIN ERRORES)
// ══════════════════════════════════════════════════════════
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : {
        rejectUnauthorized: false  // Solo esto es suficiente, sin sslmode extra
    }
});

// Middleware
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

// Headers SEO adicionales
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// ══════════════════════════════════════════════════════════
// ▶ WIKIPEDIA API — CONTEXTO INTELIGENTE
// ══════════════════════════════════════════════════════════

const WIKI_TERMINOS_RD = {
    'los mina':          'Los Mina Santo Domingo',
    'invivienda':        'Instituto Nacional de la Vivienda República Dominicana',
    'ensanche ozama':    'Ensanche Ozama Santo Domingo Este',
    'santo domingo este':'Santo Domingo Este',
    'sabana perdida':    'Sabana Perdida Santo Domingo',
    'villa mella':       'Villa Mella Santo Domingo',
    'policia nacional':  'Policía Nacional República Dominicana',
    'presidencia':       'Presidencia de la República Dominicana',
    'procuraduria':      'Procuraduría General de la República Dominicana',
    'banco central':     'Banco Central de la República Dominicana',
    'beisbol':           'Béisbol en República Dominicana',
    'turismo':           'Turismo en República Dominicana',
    'economia':          'Economía de República Dominicana',
    'educacion':         'Educación en República Dominicana',
    'salud publica':     'Ministerio de Salud Pública República Dominicana',
    'mopc':              'Ministerio de Obras Públicas República Dominicana',
    'haití':             'Relaciones entre República Dominicana y Haití',
};

async function buscarContextoWikipedia(titulo, categoria) {
    try {
        const tituloLower = titulo.toLowerCase();
        let terminoBusqueda = null;

        for (const [clave, termino] of Object.entries(WIKI_TERMINOS_RD)) {
            if (tituloLower.includes(clave)) {
                terminoBusqueda = termino;
                break;
            }
        }

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

        const urlBusqueda = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(terminoBusqueda)}&format=json&srlimit=3&origin=*`;
        const ctrlBusq    = new AbortController();
        const tmBusq      = setTimeout(() => ctrlBusq.abort(), 6000);
        const resBusqueda = await fetch(urlBusqueda, { signal: ctrlBusq.signal }).finally(() => clearTimeout(tmBusq));
        if (!resBusqueda.ok) return '';

        const dataBusqueda = await resBusqueda.json();
        const resultados   = dataBusqueda?.query?.search;
        if (!resultados?.length) return '';

        const paginaId = resultados[0].pageid;

        const urlExtracto = `https://es.wikipedia.org/w/api.php?action=query&pageids=${paginaId}&prop=extracts&exintro=true&exchars=1500&format=json&origin=*`;
        const ctrlExtr    = new AbortController();
        const tmExtr      = setTimeout(() => ctrlExtr.abort(), 6000);
        const resExtracto = await fetch(urlExtracto, { signal: ctrlExtr.signal }).finally(() => clearTimeout(tmExtr));
        if (!resExtracto.ok) return '';

        const dataExtracto = await resExtracto.json();
        const pagina       = dataExtracto?.query?.pages?.[paginaId];
        if (!pagina?.extract) return '';

        const textoLimpio = pagina.extract
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 1200);

        console.log(`   📚 Wikipedia: "${resultados[0].title}" (${textoLimpio.length} chars)`);
        return `\n📚 CONTEXTO WIKIPEDIA (usar como referencia factual, no copiar):\nArtículo: "${resultados[0].title}"\n${textoLimpio}\n`;

    } catch (err) {
        console.log(`   📚 Wikipedia: no disponible (${err.message})`);
        return '';
    }
}

// ══════════════════════════════════════════════════════════
// ▶ FACEBOOK - FUNCIONAL
// ══════════════════════════════════════════════════════════
async function publicarEnFacebook(titulo, slug, urlImagen, descripcion) {
    if (!FB_PAGE_ID || !FB_PAGE_TOKEN) {
        console.log('   📘 Facebook: No configurado');
        return false;
    }
    
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const mensaje    = `🏮 ${titulo}\n\n${descripcion || ''}\n\nLee la noticia completa 👇\n${urlNoticia}\n\n#ElFarolAlDía #RepúblicaDominicana #NoticiaRD`;

        const form = new URLSearchParams();
        form.append('url',          urlImagen);
        form.append('caption',      mensaje);
        form.append('access_token', FB_PAGE_TOKEN);

        const res  = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/photos`, { 
            method: 'POST', 
            body: form 
        });
        
        const data = await res.json();

        if (data.error) {
            const form2 = new URLSearchParams();
            form2.append('message',      mensaje);
            form2.append('link',         urlNoticia);
            form2.append('access_token', FB_PAGE_TOKEN);
            
            const res2  = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/feed`, { 
                method: 'POST', 
                body: form2 
            });
            
            const data2 = await res2.json();
            if (data2.error) { 
                console.warn(`   ⚠️ FB: ${data2.error.message}`); 
                return false; 
            }
        }

        console.log(`   📘 Facebook ✅`);
        return true;
    } catch (err) {
        console.warn(`   ⚠️ Facebook: ${err.message}`);
        return false;
    }
}

// ══════════════════════════════════════════════════════════
// ▶ TWITTER / X — FUNCIONAL
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
    if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
        console.log('   🐦 Twitter: No configurado');
        return false;
    }
    
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const textoBase  = `🏮 ${titulo}\n\n${urlNoticia}\n\n#ElFarolAlDía #RD`;
        const tweet      = textoBase.length > 280 ? textoBase.substring(0, 277) + '...' : textoBase;
        const tweetUrl   = 'https://api.twitter.com/2/tweets';
        const authHeader = generarOAuthHeader('POST', tweetUrl, {}, TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET);
        
        const res        = await fetch(tweetUrl, {
            method: 'POST',
            headers: { 
                'Authorization': authHeader, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ text: tweet })
        });
        
        const data = await res.json();
        if (data.errors || data.error) { 
            console.warn(`   ⚠️ Twitter: ${JSON.stringify(data.errors || data.error)}`); 
            return false; 
        }
        
        console.log(`   🐦 Twitter ✅ ID: ${data.data?.id}`);
        return true;
    } catch (err) {
        console.warn(`   ⚠️ Twitter: ${err.message}`);
        return false;
    }
}

// ══════════════════════════════════════════════════════════
// ▶ MARCA DE AGUA - FUNCIONAL
// ══════════════════════════════════════════════════════════
async function aplicarMarcaDeAgua(urlImagen) {
    try {
        const response = await fetch(urlImagen);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const bufOrig   = Buffer.from(await response.arrayBuffer());
        
        if (!fs.existsSync(WATERMARK_PATH)) { 
            console.warn('   ⚠️ Watermark no encontrado'); 
            return { url: urlImagen, procesada: false }; 
        }
        
        const meta      = await sharp(bufOrig).metadata();
        const w         = meta.width  || 800;
        const h         = meta.height || 500;
        const wmAncho   = Math.min(Math.round(w * 0.28), 300);
        
        const wmResized = await sharp(WATERMARK_PATH)
            .resize(wmAncho, null, { fit: 'inside' })
            .toBuffer();
            
        const wmMeta    = await sharp(wmResized).metadata();
        const wmAlto    = wmMeta.height || 60;
        const margen    = Math.round(w * 0.02);
        
        const bufFinal  = await sharp(bufOrig)
            .composite([{ 
                input: wmResized, 
                left: Math.max(0, w - wmAncho - margen), 
                top: Math.max(0, h - wmAlto - margen), 
                blend: 'over' 
            }])
            .jpeg({ quality: 88 })
            .toBuffer();
            
        const nombre    = `efd-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.jpg`;
        const rutaTmp   = path.join('/tmp', nombre);
        fs.writeFileSync(rutaTmp, bufFinal);
        console.log(`   🏮 Watermark: ${nombre}`);
        
        return { url: urlImagen, rutaTmp, nombre, procesada: true };
    } catch (err) {
        console.warn(`   ⚠️ Watermark: ${err.message}`);
        return { url: urlImagen, procesada: false };
    }
}

app.get('/img/:nombre', (req, res) => {
    const ruta = path.join('/tmp', req.params.nombre);
    if (fs.existsSync(ruta)) {
        res.setHeader('Content-Type',  'image/jpeg');
        res.setHeader('Cache-Control', 'public,max-age=604800');
        res.sendFile(ruta);
    } else { 
        res.status(404).send('No encontrada'); 
    }
});

// ══════════════════════════════════════════════════════════
// ▶ CONFIG IA
// ══════════════════════════════════════════════════════════
const CONFIG_IA_PATH = path.join(__dirname, 'config-ia.json');

function cargarConfigIA() {
    const def = {
        enabled: true,
        instruccion_principal: 'Eres un periodista profesional dominicano de alto nivel, con visión nacional e internacional. Escribes noticias verificadas, equilibradas y con impacto real. Cubres República Dominicana completa, el Caribe, Latinoamérica y el mundo. Cuando la noticia tiene conexión con Santo Domingo Este o RD, lo destacas con contexto local.',
        tono: 'profesional', 
        extension: 'media',
        enfasis: 'Si la noticia es nacional: prioriza SDE, Los Mina, Invivienda, Ensanche Ozama. Si es internacional: conecta con el impacto en República Dominicana y el Caribe.',
        evitar: 'Limitar el tema solo a Santo Domingo Este. Especulación sin fuentes. Titulares sensacionalistas. Repetir noticias ya publicadas. Copiar texto de Wikipedia.'
    };
    
    try { 
        if (fs.existsSync(CONFIG_IA_PATH)) {
            return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_IA_PATH, 'utf8')) }; 
        }
    } catch (e) {}
    
    fs.writeFileSync(CONFIG_IA_PATH, JSON.stringify(def, null, 2));
    return def;
}

function guardarConfigIA(c) { 
    try { 
        fs.writeFileSync(CONFIG_IA_PATH, JSON.stringify(c, null, 2)); 
        return true; 
    } catch (e) { 
        return false; 
    } 
}

let CONFIG_IA = cargarConfigIA();

// ══════════════════════════════════════════════════════════
// ▶ GEMINI — con Wikipedia integrado
// ══════════════════════════════════════════════════════════
const GS = { lastRequest: 0, resetTime: 0 };

async function llamarGemini(prompt, reintentos = 3) {
    for (let i = 0; i < reintentos; i++) {
        try {
            console.log(`   🤖 Gemini (intento ${i + 1})`);
            
            const ahora = Date.now();
            if (ahora < GS.resetTime) {
                await new Promise(r => setTimeout(r, Math.min(GS.resetTime - ahora, 10000)));
            }
            
            const desde = Date.now() - GS.lastRequest;
            if (desde < 3000) {
                await new Promise(r => setTimeout(r, 3000 - desde));
            }
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
                            maxOutputTokens: 4000,
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
            if (i < reintentos - 1) {
                await new Promise(r => setTimeout(r, Math.pow(2, i) * 3000));
            }
        }
    }
    throw new Error('Gemini no respondió');
}

// ══════════════════════════════════════════════════════════
// ▶ PEXELS — BÚSQUEDA MEJORADA CON CONTEXTO RD
// ══════════════════════════════════════════════════════════

const PEXELS_QUERIES_RD = {
    'los mina':           ['dominican republic city street', 'caribbean urban neighborhood', 'santo domingo streets'],
    'invivienda':         ['dominican republic housing', 'caribbean social housing', 'latin america residential'],
    'ensanche ozama':     ['dominican republic urban area', 'caribbean city infrastructure'],
    'santo domingo este': ['santo domingo dominican republic', 'caribbean capital city'],
    'villa mella':        ['dominican republic suburb', 'caribbean neighborhood street'],
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
    'haiti':              ['haiti dominican republic border', 'caribbean diplomacy'],
    'caribe':             ['caribbean sea islands', 'caribbean region aerial'],
};

async function buscarEnPexels(queries) {
    if (!PEXELS_API_KEY) return null;

    const listaQueries = Array.isArray(queries) ? queries : [queries];

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

            const foto = data.photos.slice(0, 5)[Math.floor(Math.random() * Math.min(5, data.photos.length))];
            console.log(`   📸 Pexels: "${query}" → ${foto.id}`);
            
            return foto.src.large2x || foto.src.large || foto.src.original;
        } catch { continue; }
    }
    return null;
}

function detectarQueriesPexels(titulo, categoria, queryIA) {
    const tituloLower = titulo.toLowerCase();
    const queries     = [];

    for (const [zona, zonaQueries] of Object.entries(PEXELS_QUERIES_RD)) {
        if (tituloLower.includes(zona)) {
            queries.push(...zonaQueries);
            break;
        }
    }

    if (queryIA) queries.push(queryIA);

    const mapaCat = {
        'Nacionales':      ['dominican republic news', 'santo domingo dominican'],
        'Deportes':        ['dominican republic sport', 'baseball caribbean'],
        'Internacionales': ['caribbean diplomacy international', 'latin america world news'],
        'Economía':        ['dominican republic economy business', 'caribbean finance'],
        'Tecnología':      ['technology innovation latin america'],
        'Espectáculos':    ['dominican culture entertainment', 'caribbean music festival'],
    };
    
    if (mapaCat[categoria]) queries.push(...mapaCat[categoria]);

    queries.push('dominican republic', 'caribbean');

    return [...new Set(queries)];
}

// ══════════════════════════════════════════════════════════
// ▶ BANCO LOCAL DE IMÁGENES
// ══════════════════════════════════════════════════════════
const PB  = 'https://images.pexels.com/photos';
const OPT = '?auto=compress&cs=tinysrgb&w=800';

const BANCO_LOCAL = {
    'politica-gobierno':          [`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`, `${PB}/290595/pexels-photo-290595.jpeg${OPT}`, `${PB}/3616480/pexels-photo-3616480.jpeg${OPT}`, `${PB}/3183150/pexels-photo-3183150.jpeg${OPT}`],
    'seguridad-policia':          [`${PB}/6261776/pexels-photo-6261776.jpeg${OPT}`, `${PB}/5699456/pexels-photo-5699456.jpeg${OPT}`, `${PB}/3807517/pexels-photo-3807517.jpeg${OPT}`, `${PB}/6980997/pexels-photo-6980997.jpeg${OPT}`],
    'relaciones-internacionales': [`${PB}/2860705/pexels-photo-2860705.jpeg${OPT}`, `${PB}/358319/pexels-photo-358319.jpeg${OPT}`, `${PB}/3407617/pexels-photo-3407617.jpeg${OPT}`, `${PB}/3997992/pexels-photo-3997992.jpeg${OPT}`],
    'economia-mercado':           [`${PB}/4386466/pexels-photo-4386466.jpeg${OPT}`, `${PB}/6772070/pexels-photo-6772070.jpeg${OPT}`, `${PB}/3532557/pexels-photo-3532557.jpeg${OPT}`, `${PB}/6801648/pexels-photo-6801648.jpeg${OPT}`],
    'infraestructura':            [`${PB}/1216589/pexels-photo-1216589.jpeg${OPT}`, `${PB}/323780/pexels-photo-323780.jpeg${OPT}`, `${PB}/2219024/pexels-photo-2219024.jpeg${OPT}`, `${PB}/3183197/pexels-photo-3183197.jpeg${OPT}`],
    'salud-medicina':             [`${PB}/3786157/pexels-photo-3786157.jpeg${OPT}`, `${PB}/40568/pexels-photo-40568.jpeg${OPT}`, `${PB}/4386467/pexels-photo-4386467.jpeg${OPT}`, `${PB}/1170979/pexels-photo-1170979.jpeg${OPT}`],
    'deporte-beisbol':            [`${PB}/1661950/pexels-photo-1661950.jpeg${OPT}`, `${PB}/209977/pexels-photo-209977.jpeg${OPT}`, `${PB}/248318/pexels-photo-248318.jpeg${OPT}`, `${PB}/1884574/pexels-photo-1884574.jpeg${OPT}`],
    'deporte-futbol':             [`${PB}/46798/pexels-photo-46798.jpeg${OPT}`, `${PB}/3621943/pexels-photo-3621943.jpeg${OPT}`, `${PB}/3873098/pexels-photo-3873098.jpeg${OPT}`, `${PB}/1884574/pexels-photo-1884574.jpeg${OPT}`],
    'deporte-general':            [`${PB}/863988/pexels-photo-863988.jpeg${OPT}`, `${PB}/936094/pexels-photo-936094.jpeg${OPT}`, `${PB}/2526878/pexels-photo-2526878.jpeg${OPT}`, `${PB}/3621943/pexels-photo-3621943.jpeg${OPT}`],
    'tecnologia':                 [`${PB}/3861958/pexels-photo-3861958.jpeg${OPT}`, `${PB}/2582937/pexels-photo-2582937.jpeg${OPT}`, `${PB}/5632399/pexels-photo-5632399.jpeg${OPT}`, `${PB}/3932499/pexels-photo-3932499.jpeg${OPT}`],
    'educacion':                  [`${PB}/256490/pexels-photo-256490.jpeg${OPT}`, `${PB}/289737/pexels-photo-289737.jpeg${OPT}`, `${PB}/1205651/pexels-photo-1205651.jpeg${OPT}`, `${PB}/4143791/pexels-photo-4143791.jpeg${OPT}`],
    'cultura-musica':             [`${PB}/1190297/pexels-photo-1190297.jpeg${OPT}`, `${PB}/1540406/pexels-photo-1540406.jpeg${OPT}`, `${PB}/3651308/pexels-photo-3651308.jpeg${OPT}`, `${PB}/2521317/pexels-photo-2521317.jpeg${OPT}`],
    'medio-ambiente':             [`${PB}/1108572/pexels-photo-1108572.jpeg${OPT}`, `${PB}/1366919/pexels-photo-1366919.jpeg${OPT}`, `${PB}/2559941/pexels-photo-2559941.jpeg${OPT}`, `${PB}/414612/pexels-photo-414612.jpeg${OPT}`],
    'turismo':                    [`${PB}/1450353/pexels-photo-1450353.jpeg${OPT}`, `${PB}/1174732/pexels-photo-1174732.jpeg${OPT}`, `${PB}/3601425/pexels-photo-3601425.jpeg${OPT}`, `${PB}/2104152/pexels-photo-2104152.jpeg${OPT}`],
    'emergencia':                 [`${PB}/1437862/pexels-photo-1437862.jpeg${OPT}`, `${PB}/263402/pexels-photo-263402.jpeg${OPT}`, `${PB}/3807517/pexels-photo-3807517.jpeg${OPT}`, `${PB}/3616480/pexels-photo-3616480.jpeg${OPT}`]
};

const FALLBACK_CAT = {
    'Nacionales':      'politica-gobierno',
    'Deportes':        'deporte-general',
    'Internacionales': 'relaciones-internacionales',
    'Economía':        'economia-mercado',
    'Tecnología':      'tecnologia',
    'Espectáculos':    'cultura-musica'
};

function imgLocal(sub, cat) {
    const banco = BANCO_LOCAL[sub] || BANCO_LOCAL[FALLBACK_CAT[cat]] || BANCO_LOCAL['politica-gobierno'];
    return banco[Math.floor(Math.random() * banco.length)];
}

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

function generarAltSEO(titulo, categoria, altIA, subtema) {
    if (altIA && altIA.length > 15) {
        const yaTieneRD = altIA.toLowerCase().includes('dominican') ||
                          altIA.toLowerCase().includes('república') ||
                          altIA.toLowerCase().includes('santo domingo');

        if (yaTieneRD) return `${altIA} - El Farol al Día`;

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
// ▶ SEO HTML META TAGS
// ══════════════════════════════════════════════════════════
const esc = s => String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;
