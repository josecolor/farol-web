/**
 * 🏮 EL FAROL AL DÍA — V34.0 INTERNACIONAL (CORREGIDA)
 * + Wikipedia API como contexto inteligente para Gemini
 * + Wikipedia Imágenes para personajes públicos
 * + Wikimedia Commons (73M imágenes) 
 * + Lógica de imágenes mejorada (prioridad RD / SDE)
 * + Alt SEO geolocalizado República Dominicana
 * + HREFLANG para SEO internacional
 * + Selector de país/idioma
 * + SISTEMA DE MEMORIA IA
 * + COMENTARIOS EN NOTICIAS
 * + COACH DE REDACCIÓN
 * + ERRORES CORREGIDOS
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { Pool } = require('pg');
const sharp = require('sharp');
const RSSParser = require('rss-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// Cookie Parser - Instalar: npm install cookie-parser
let cookieParser;
try {
    cookieParser = require('cookie-parser');
    app.use(cookieParser());
    console.log('✅ CookieParser instalado');
} catch (e) {
    console.warn('⚠️ cookie-parser no instalado, ejecuta: npm install cookie-parser');
    // Middleware manual para cookies
    app.use((req, res, next) => {
        req.cookies = {};
        if (req.headers.cookie) {
            req.headers.cookie.split(';').forEach(cookie => {
                const parts = cookie.split('=');
                req.cookies[parts[0].trim()] = parts[1]?.trim() || '';
            });
        }
        next();
    });
}

if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL requerido'); process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY requerido'); process.exit(1); }

const PEXELS_API_KEY = process.env.PEXELS_API_KEY || null;
const FB_PAGE_ID = process.env.FB_PAGE_ID || null;
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || null;
const TWITTER_API_KEY = process.env.TWITTER_API_KEY || null;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET || null;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN || null;
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
    console.warn('⚠️ No se encontró archivo de watermark');
    return path.join(__dirname, 'static', 'watermark.png'); // fallback
})();

const rssParser = new RSSParser({ timeout: 10000 });

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
// ▶ DETECCIÓN DE PAÍS E IDIOMA
// ══════════════════════════════════════════════════════════

function detectarPaisIdioma(req) {
    // 1. Verificar cookie
    if (req.cookies && req.cookies.pais_seleccionado) {
        return req.cookies.pais_seleccionado;
    }
    
    // 2. Detectar por Accept-Language
    const acceptLang = req.headers['accept-language'] || '';
    
    const mapaIdiomas = {
        'es-DO': 'es-do',
        'es-US': 'es-us',
        'es-ES': 'es-es',
        'es': 'es',
        'en-US': 'en-us',
        'en': 'en-us',
        'fr': 'fr',
        'fr-FR': 'fr',
        'pt': 'pt',
        'pt-BR': 'pt'
    };
    
    for (const [lang, codigo] of Object.entries(mapaIdiomas)) {
        if (acceptLang.includes(lang)) {
            return codigo;
        }
    }
    
    // 3. Por defecto: República Dominicana
    return 'es-do';
}

// Middleware para inyectar país/idioma
app.use((req, res, next) => {
    req.paisIdioma = detectarPaisIdioma(req);
    res.locals.paisIdioma = req.paisIdioma;
    next();
});

// ══════════════════════════════════════════════════════════
// ▶ MAPEO FORZADO DE IMÁGENES - PERSONAJES PÚBLICOS
// ══════════════════════════════════════════════════════════

const MAPEO_IMAGENES = {
    // 🇺🇸 PERSONAJES POLÍTICOS INTERNACIONALES
    'donald trump': [
        'donald trump white house official',
        'president trump speech podium',
        'trump inauguration ceremony',
        'donald trump signing executive order',
        'trump presidential portrait official'
    ],
    'trump': [
        'donald trump white house official',
        'president trump speech podium',
        'trump inauguration ceremony',
        'donald trump signing executive order',
        'trump presidential portrait official'
    ],
    'casa blanca': [
        'white house official washington dc',
        'white house exterior presidential mansion',
        'white house north lawn flag',
        'white house oval office interior',
        'white house aerial view'
    ],
    'white house': [
        'white house official washington dc',
        'white house exterior presidential mansion',
        'white house north lawn flag',
        'white house oval office interior',
        'white house aerial view'
    ],
    'joe biden': [
        'joe biden president official portrait',
        'president biden white house speech',
        'joe biden oval office desk',
        'biden signing legislation',
        'president biden public event'
    ],
    'biden': [
        'joe biden president official portrait',
        'president biden white house speech',
        'joe biden oval office desk',
        'biden signing legislation',
        'president biden public event'
    ],
    
    // 🇩🇴 PERSONAJES POLÍTICOS DOMINICANOS
    'abinader': [
        'presidente luis abinader inauguracion',
        'presidente dominicano discurso oficial',
        'abinader gobierno republica dominicana',
        'presidente abinader acto publico',
        'gobierno dominicano presidente abinader'
    ],
    'luis abinader': [
        'presidente luis abinader inauguracion',
        'presidente dominicano discurso oficial',
        'abinader gobierno republica dominicana',
        'presidente abinader acto publico',
        'gobierno dominicano presidente abinader'
    ],
    
    // ⚾ PELOTEROS DOMINICANOS
    'david ortiz': [
        'david ortiz big papi baseball',
        'david ortiz boston red sox hitter',
        'big papi fenway park batting',
        'david ortiz world series champion',
        'david ortiz red sox legend hall of fame'
    ],
    'big papi': [
        'david ortiz big papi baseball',
        'david ortiz boston red sox hitter',
        'big papi fenway park batting',
        'david ortiz world series champion',
        'david ortiz red sox legend hall of fame'
    ],
    
    // 🏛️ INSTITUCIONES DOMINICANAS
    'inapa': [
        'inapa agua potable dominicana',
        'acueducto construccion republica dominicana',
        'planta tratamiento agua instalaciones',
        'obras hidraulicas santo domingo',
        'tanque almacenamiento agua infrastructure'
    ],
    'acueducto': [
        'acueducto construccion republica dominicana',
        'planta tratamiento agua instalaciones',
        'obras hidraulicas santo domingo',
        'tanque almacenamiento agua infrastructure',
        'tuberias agua potable instalacion'
    ],
    
    // BÉISBOL
    'beisbol': [
        'baseball dominican republic stadium fans',
        'baseball player batting caribbean',
        'dominican baseball league action',
        'baseball game santo domingo crowd',
        'latin american baseball pitcher'
    ],
    'béisbol': [
        'baseball dominican republic stadium fans',
        'baseball player batting caribbean',
        'dominican baseball league action',
        'baseball game santo domingo crowd',
        'latin american baseball pitcher'
    ],
    
    // POR CATEGORÍA (FALLBACK)
    'Nacionales': [
        'dominican republic government building',
        'santo domingo city street life',
        'dominican flag waving',
        'caribbean capital city architecture',
        'latin america urban daily life'
    ],
    'Deportes': [
        'dominican republic sports athlete',
        'caribbean sports stadium fans',
        'latin american competition event',
        'sports action professional athlete',
        'dominican athlete training'
    ],
    'Internacionales': [
        'international diplomacy meeting',
        'world flags conference',
        'caribbean latin america relations',
        'global business international',
        'world leaders summit'
    ],
    'Economía': [
        'dominican republic business finance',
        'santo domingo stock market',
        'caribbean economic development',
        'latin american bank building',
        'business professionals meeting'
    ],
    'Tecnología': [
        'technology latin america digital',
        'caribbean innovation tech startup',
        'dominican republic software developer',
        'computer science education',
        'digital transformation caribbean'
    ],
    'Espectáculos': [
        'dominican music concert fans',
        'caribbean festival dancing',
        'merengue performance stage',
        'latin entertainment show',
        'dominican artist performing'
    ]
};

// PALABRAS PROHIBIDAS
const QUERIES_PROHIBIDAS = [
    'wedding', 'bride', 'groom', 'bridal', 'couple', 'romance', 'romantic',
    'fashion', 'model', 'catwalk', 'flowers', 'bouquet', 'love', 'kiss',
    'marriage', 'engagement', 'honeymoon', 'valentine', 'party decoration',
    'birthday', 'celebration cake', 'gift', 'present', 'pet', 'dog', 'cat',
    'animal', 'nature landscape', 'sunset beach vacation', 'travel holiday',
    'scenery', 'mountains', 'forest', 'flowers garden', 'still life',
    'abstract art', 'illustration', 'digital art', '3d render', 'cartoon'
];

function detectarQueriesPexels(titulo, categoria, queryIA) {
    const tituloLower = titulo.toLowerCase();
    let queriesFinales = [];
    
    for (const [palabraClave, queries] of Object.entries(MAPEO_IMAGENES)) {
        if (tituloLower.includes(palabraClave)) {
            console.log(`   🎯 Mapeo por palabra: "${palabraClave}"`);
            queriesFinales.push(...queries);
            break;
        }
    }
    
    if (queriesFinales.length === 0 && MAPEO_IMAGENES[categoria]) {
        console.log(`   🎯 Mapeo por categoría: "${categoria}"`);
        queriesFinales.push(...MAPEO_IMAGENES[categoria]);
    }
    
    if (queriesFinales.length === 0) {
        console.log(`   🎯 Usando fallback genérico`);
        queriesFinales.push(
            'dominican republic santo domingo city',
            'caribbean latin america urban',
            'dominican flag culture people',
            'republica dominicana vida cotidiana'
        );
    }
    
    queriesFinales = queriesFinales.filter(query => {
        const queryLower = query.toLowerCase();
        return !QUERIES_PROHIBIDAS.some(prohibida => queryLower.includes(prohibida));
    });
    
    if (queriesFinales.length === 0) {
        queriesFinales = ['dominican republic news', 'santo domingo daily life'];
    }
    
    return [...new Set(queriesFinales)];
}

// ══════════════════════════════════════════════════════════
// ▶ WIKIPEDIA API — CONTEXTO INTELIGENTE (TEXTO)
// ══════════════════════════════════════════════════════════

const WIKI_TERMINOS_RD = {
    'los mina': 'Los Mina Santo Domingo',
    'invivienda': 'Instituto Nacional de la Vivienda República Dominicana',
    'ensanche ozama': 'Ensanche Ozama Santo Domingo Este',
    'santo domingo este': 'Santo Domingo Este',
    'sabana perdida': 'Sabana Perdida Santo Domingo',
    'villa mella': 'Villa Mella Santo Domingo',
    'policia nacional': 'Policía Nacional República Dominicana',
    'presidencia': 'Presidencia de la República Dominicana',
    'procuraduria': 'Procuraduría General de la República Dominicana',
    'banco central': 'Banco Central de la República Dominicana',
    'beisbol': 'Béisbol en República Dominicana',
    'turismo': 'Turismo en República Dominicana',
    'economia': 'Economía de República Dominicana',
    'educacion': 'Educación en República Dominicana',
    'salud publica': 'Ministerio de Salud Pública República Dominicana',
    'mopc': 'Ministerio de Obras Públicas República Dominicana',
    'haití': 'Relaciones entre República Dominicana y Haití',
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
                'Nacionales': `${titulo} República Dominicana`,
                'Deportes': `${titulo} deporte dominicano`,
                'Internacionales': `${titulo} América Latina Caribe`,
                'Economía': `${titulo} economía dominicana`,
                'Tecnología': titulo,
                'Espectáculos': `${titulo} cultura dominicana`,
            };
            terminoBusqueda = mapaCategoria[categoria] || `${titulo} República Dominicana`;
        }

        const urlBusqueda = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(terminoBusqueda)}&format=json&srlimit=3&origin=*`;
        const ctrlBusq = new AbortController();
        const tmBusq = setTimeout(() => ctrlBusq.abort(), 6000);
        const resBusqueda = await fetch(urlBusqueda, { 
            signal: ctrlBusq.signal,
            headers: { 'User-Agent': 'ElFarolAlDia/1.0 (contacto@elfarolaldia.com)' }
        }).finally(() => clearTimeout(tmBusq));
        if (!resBusqueda.ok) return '';

        const dataBusqueda = await resBusqueda.json();
        const resultados = dataBusqueda?.query?.search;
        if (!resultados?.length) return '';

        const paginaId = resultados[0].pageid;

        const urlExtracto = `https://es.wikipedia.org/w/api.php?action=query&pageids=${paginaId}&prop=extracts&exintro=true&exchars=1500&format=json&origin=*`;
        const ctrlExtr = new AbortController();
        const tmExtr = setTimeout(() => ctrlExtr.abort(), 6000);
        const resExtracto = await fetch(urlExtracto, { 
            signal: ctrlExtr.signal,
            headers: { 'User-Agent': 'ElFarolAlDia/1.0 (contacto@elfarolaldia.com)' }
        }).finally(() => clearTimeout(tmExtr));
        if (!resExtracto.ok) return '';

        const dataExtracto = await resExtracto.json();
        const pagina = dataExtracto?.query?.pages?.[paginaId];
        if (!pagina?.extract) return '';

        const textoLimpio = pagina.extract
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 1200);

        console.log(`   📚 Wikipedia contexto: "${resultados[0].title}" (${textoLimpio.length} chars)`);
        return `\n📚 CONTEXTO WIKIPEDIA (usar como referencia factual, no copiar):\nArtículo: "${resultados[0].title}"\n${textoLimpio}\n`;

    } catch (err) {
        console.log(`   📚 Wikipedia: no disponible (${err.message})`);
        return '';
    }
}

// ══════════════════════════════════════════════════════════
// ▶ WIKIPEDIA IMÁGENES - FOTO PRINCIPAL DEL ARTÍCULO
// ══════════════════════════════════════════════════════════

async function buscarImagenWikipedia(titulo, categoria) {
    try {
        console.log(`   🖼️ Buscando imagen en Wikipedia para: "${titulo}"`);
        
        const tituloLower = titulo.toLowerCase();
        const esPersonaje = [
            'trump', 'donald trump', 'biden', 'obama', 'putin', 'bukele',
            'david ortiz', 'big papi', 'pedro martinez', 'vladimir guerrero', 'juan soto',
            'abinader', 'luis abinader', 'leonel', 'hipolito', 'danilo medina',
            'messi', 'lionel messi', 'ronaldo', 'cristiano ronaldo'
        ].some(p => tituloLower.includes(p));
        
        let urlBusqueda = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`;
        let resBusqueda = await fetch(urlBusqueda, {
            headers: { 'User-Agent': 'ElFarolAlDia/1.0 (contacto@elfarolaldia.com)' }
        });
        let dataBusqueda = await resBusqueda.json();
        
        let pageTitle, wikiLang;
        
        if (dataBusqueda.query?.search?.length) {
            pageTitle = dataBusqueda.query.search[0].title;
            wikiLang = 'es';
        } else {
            urlBusqueda = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`;
            resBusqueda = await fetch(urlBusqueda, {
                headers: { 'User-Agent': 'ElFarolAlDia/1.0 (contacto@elfarolaldia.com)' }
            });
            dataBusqueda = await resBusqueda.json();
            if (!dataBusqueda.query?.search?.length) return null;
            pageTitle = dataBusqueda.query.search[0].title;
            wikiLang = 'en';
        }
        
        const urlImagenes = `https://${wikiLang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=pageimages&format=json&pithumbsize=800&origin=*`;
        const resImagenes = await fetch(urlImagenes, {
            headers: { 'User-Agent': 'ElFarolAlDia/1.0 (contacto@elfarolaldia.com)' }
        });
        const dataImagenes = await resImagenes.json();
        
        const pages = dataImagenes.query.pages;
        const pageId = Object.keys(pages)[0];
        
        if (pages[pageId].thumbnail?.source) {
            const imagenUrl = pages[pageId].thumbnail.source;
            console.log(`   ✅ Wikipedia imagen: ${pageTitle}`);
            return imagenUrl;
        }
        
        return null;
        
    } catch (err) {
        console.log(`   ⚠️ Error imagen Wikipedia: ${err.message}`);
        return null;
    }
}

// ══════════════════════════════════════════════════════════
// ▶ WIKIMEDIA COMMONS - 73 MILLONES DE IMÁGENES
// ══════════════════════════════════════════════════════════

async function buscarImagenWikimediaCommons(titulo, categoria) {
    try {
        console.log(`   🖼️ Buscando en Wikimedia Commons: "${titulo}"`);
        
        const tituloLower = titulo.toLowerCase();
        const esPersonaje = [
            'trump', 'donald trump', 'biden', 'obama', 'putin', 'bukele',
            'david ortiz', 'big papi', 'pedro martinez', 'vladimir guerrero', 'juan soto',
            'abinader', 'luis abinader', 'leonel', 'hipolito', 'danilo medina',
            'messi', 'lionel messi', 'ronaldo', 'cristiano ronaldo'
        ].some(p => tituloLower.includes(p));
        
        let urlBusqueda = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`;
        let resBusqueda = await fetch(urlBusqueda, {
            headers: { 'User-Agent': 'ElFarolAlDia/1.0 (contacto@elfarolaldia.com)' }
        });
        let dataBusqueda = await resBusqueda.json();
        
        let pageTitle;
        
        if (dataBusqueda.query?.search?.length) {
            pageTitle = dataBusqueda.query.search[0].title;
        } else {
            urlBusqueda = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`;
            resBusqueda = await fetch(urlBusqueda, {
                headers: { 'User-Agent': 'ElFarolAlDia/1.0 (contacto@elfarolaldia.com)' }
            });
            dataBusqueda = await resBusqueda.json();
            if (!dataBusqueda.query?.search?.length) return null;
            pageTitle = dataBusqueda.query.search[0].title;
        }
        
        const urlCommons = `https://commons.wikimedia.org/w/api.php?action=query&generator=images&titles=${encodeURIComponent(pageTitle)}&gimlimit=10&prop=imageinfo&iiprop=url|mime&format=json&origin=*`;
        const resCommons = await fetch(urlCommons, {
            headers: { 'User-Agent': 'ElFarolAlDia/1.0 (contacto@elfarolaldia.com)' }
        });
        const dataCommons = await resCommons.json();
        
        let imagenes = [];
        
        if (dataCommons.query?.pages) {
            for (const pageId in dataCommons.query.pages) {
                const page = dataCommons.query.pages[pageId];
                if (page.imageinfo && page.imageinfo.length > 0) {
                    const img = page.imageinfo[0];
                    if (img.mime && img.mime.startsWith('image/')) {
                        imagenes.push({
                            url: img.url,
                            title: page.title
                        });
                    }
                }
            }
        }
        
        if (imagenes.length > 0) {
            console.log(`   ✅ Wikimedia Commons: ${imagenes.length} imágenes`);
            return imagenes[0].url;
        }
        
        return null;
        
    } catch (err) {
        console.log(`   ⚠️ Error Wikimedia Commons: ${err.message}`);
        return null;
    }
}

// ══════════════════════════════════════════════════════════
// ▶ BUSCADOR INTEGRADO: WIKIPEDIA + COMMONS + PEXELS
// ══════════════════════════════════════════════════════════

async function obtenerImagenInteligente(titulo, categoria, subtemaLocal, queryIA) {
    console.log(`   🔍 Búsqueda integrada para: "${titulo}"`);
    
    const imagenCommons = await buscarImagenWikimediaCommons(titulo, categoria);
    if (imagenCommons) {
        console.log(`   ✅ Usando imagen de Wikimedia Commons`);
        return imagenCommons;
    }
    
    const imagenWiki = await buscarImagenWikipedia(titulo, categoria);
    if (imagenWiki) {
        console.log(`   ✅ Usando imagen de Wikipedia`);
        return imagenWiki;
    }
    
    console.log(`   📸 Sin resultados en Wikimedia → usando Pexels`);
    const queries = detectarQueriesPexels(titulo, categoria, queryIA);
    const urlPexels = await buscarEnPexels(queries);
    if (urlPexels) return urlPexels;
    
    console.log(`   📸 Pexels sin resultado → banco local`);
    return imgLocal(subtemaLocal, categoria);
}

// ══════════════════════════════════════════════════════════
// ▶ PEXELS — BÚSQUEDA
// ══════════════════════════════════════════════════════════

async function buscarEnPexels(queries) {
    if (!PEXELS_API_KEY) return null;

    const listaQueries = Array.isArray(queries) ? queries : [queries];

    for (const query of listaQueries) {
        try {
            const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=10&orientation=landscape`;
            const ctrl = new AbortController();
            const tm = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(url, {
                headers: { Authorization: PEXELS_API_KEY },
                signal: ctrl.signal
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

// ══════════════════════════════════════════════════════════
// BANCO LOCAL DE IMÁGENES
// ══════════════════════════════════════════════════════════
const PB = 'https://images.pexels.com/photos';
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
};

const FALLBACK_CAT = {
    'Nacionales': 'politica-gobierno',
    'Deportes': 'deporte-general',
    'Internacionales': 'relaciones-internacionales',
    'Economía': 'economia-mercado',
    'Tecnología': 'tecnologia',
    'Espectáculos': 'cultura-musica',
};

function imgLocal(sub, cat) {
    const banco = BANCO_LOCAL[sub] || BANCO_LOCAL[FALLBACK_CAT[cat]] || BANCO_LOCAL['politica-gobierno'];
    return banco[Math.floor(Math.random() * banco.length)];
}

// ══════════════════════════════════════════════════════════
// ▶ ALT SEO MEJORADO
// ══════════════════════════════════════════════════════════

function generarAltSEO(titulo, categoria, altIA, subtema) {
    if (altIA && altIA.length > 15) {
        const yaTieneRD = altIA.toLowerCase().includes('dominican') ||
            altIA.toLowerCase().includes('república') ||
            altIA.toLowerCase().includes('santo domingo');

        if (yaTieneRD) return `${altIA} - El Farol al Día`;

        const contextoCat = {
            'Nacionales': 'noticias República Dominicana',
            'Deportes': 'deportes dominicanos',
            'Internacionales': 'noticias internacionales impacto RD',
            'Economía': 'economía República Dominicana',
            'Tecnología': 'tecnología innovación RD',
            'Espectáculos': 'cultura entretenimiento dominicano',
        };
        return `${altIA}, ${contextoCat[categoria] || 'República Dominicana'} - El Farol al Día`;
    }

    const base = {
        'Nacionales': `Noticia nacional ${titulo.substring(0, 40)} - Santo Domingo, República Dominicana`,
        'Deportes': `Deportes dominicanos ${titulo.substring(0, 40)} - El Farol al Día RD`,
        'Internacionales': `Noticias internacionales ${titulo.substring(0, 30)} - impacto en República Dominicana`,
        'Economía': `Economía dominicana ${titulo.substring(0, 35)} - finanzas República Dominicana`,
        'Tecnología': `Tecnología ${titulo.substring(0, 35)} - innovación República Dominicana`,
        'Espectáculos': `Espectáculos dominicanos ${titulo.substring(0, 35)} - cultura RD`,
    };

    return (base[categoria] || `${titulo.substring(0, 50)} - noticias República Dominicana El Farol al Día`);
}

// ══════════════════════════════════════════════════════════
// ▶ SEO HTML META TAGS CON HREFLANG INTERNACIONAL
// ══════════════════════════════════════════════════════════

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function metaTagsCompletos(n, url, paisActual = 'es-do') {
    const t = esc(n.titulo), d = esc(n.seo_description || ''), k = esc(n.seo_keywords || '');
    const img = esc(n.imagen), red = esc(n.redactor), sec = esc(n.seccion);
    const fi = new Date(n.fecha).toISOString();
    const wc = (n.contenido || '').split(/\s+/).filter(w => w).length;
    
    const urlsPorPais = {
        'es-do': `${BASE_URL}/es-do/noticia/${n.slug}`,
        'es-us': `${BASE_URL}/es-us/noticia/${n.slug}`,
        'es-es': `${BASE_URL}/es-es/noticia/${n.slug}`,
        'es': `${BASE_URL}/es/noticia/${n.slug}`,
        'en-us': `${BASE_URL}/en-us/noticia/${n.slug}`,
        'fr': `${BASE_URL}/fr/noticia/${n.slug}`,
        'pt': `${BASE_URL}/pt/noticia/${n.slug}`
    };
    
    let hreflangTags = '';
    for (const [pais, urlCompleta] of Object.entries(urlsPorPais)) {
        hreflangTags += `<link rel="alternate" hreflang="${pais}" href="${urlCompleta}" />\n`;
    }
    hreflangTags += `<link rel="alternate" hreflang="x-default" href="${BASE_URL}/es-do/noticia/${n.slug}" />`;
    
    const schema = {
        "@context": "https://schema.org", "@type": "NewsArticle",
        "mainEntityOfPage": { "@type": "WebPage", "@id": urlsPorPais[paisActual] },
        "headline": n.titulo, "description": n.seo_description || '',
        "image": { "@type": "ImageObject", "url": n.imagen, "caption": n.imagen_caption || n.titulo, "width": 1200, "height": 630 },
        "datePublished": fi, "dateModified": fi,
        "author": { "@type": "Person", "name": n.redactor, "url": `${BASE_URL}/nosotros` },
        "publisher": { "@type": "Organization", "name": "El Farol al Día", "url": BASE_URL, "logo": { "@type": "ImageObject", "url": `${BASE_URL}/static/favicon.png` } },
        "articleSection": n.seccion, "wordCount": wc, "inLanguage": paisActual.replace('-', '_'), "isAccessibleForFree": true
    };
    
    const bread = {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Inicio", "item": BASE_URL },
            { "@type": "ListItem", "position": 2, "name": n.seccion, "item": `${BASE_URL}/#${(n.seccion || '').toLowerCase()}` },
            { "@type": "ListItem", "position": 3, "name": n.titulo, "item": urlsPorPais[paisActual] }
        ]
    };
    
    // OpenGraph tags
    const ogTags = `
<meta property="og:type" content="article">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(n.imagen_alt || n.titulo)}">
<meta property="og:url" content="${urlsPorPais[paisActual]}">
<meta property="og:site_name" content="El Farol al Día">
<meta property="og:locale" content="${paisActual.replace('-', '_')}">
<meta property="article:published_time" content="${fi}">
<meta property="article:modified_time" content="${fi}">
<meta property="article:author" content="${red}">
<meta property="article:section" content="${sec}">
<meta property="article:tag" content="${k}">`;

    // Twitter tags
    const twitterTags = `
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
<meta name="twitter:image:alt" content="${esc(n.imagen_alt || n.titulo)}">
<meta name="twitter:site" content="@elfarolaldia">`;
    
    return `<title>${t} | El Farol al Día</title>
<meta name="description" content="${d}">
<meta name="keywords" content="${k}">
<meta name="author" content="${red}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="${urlsPorPais[paisActual]}">
${hreflangTags}
${ogTags}
${twitterTags}
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
    { nombre: 'Carlos Méndez', esp: 'Nacionales' },
    { nombre: 'Laura Santana', esp: 'Deportes' },
    { nombre: 'Roberto Peña', esp: 'Internacionales' },
    { nombre: 'Ana María Castillo', esp: 'Economía' },
    { nombre: 'José Miguel Fernández', esp: 'Tecnología' },
    { nombre: 'Patricia Jiménez', esp: 'Espectáculos' }
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
            `).catch(() => { });
        }

        await client.query(`
            CREATE TABLE IF NOT EXISTS rss_procesados(
                id SERIAL PRIMARY KEY,
                item_guid VARCHAR(500) UNIQUE,
                fuente VARCHAR(100),
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_memoria_tipo
            ON memoria_ia(tipo, categoria)
        `).catch(() => { });

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
        `).catch(() => { });

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
    await cargarConfigIA();
}

// ══════════════════════════════════════════════════════════
// ▶ CONFIG IA
// ══════════════════════════════════════════════════════════

const CONFIG_IA_DEFAULT = {
    enabled: true,
    instruccion_principal: 'Eres un periodista profesional dominicano de alto nivel, con visión nacional e internacional. Escribes noticias verificadas, equilibradas y con impacto real. Cubres República Dominicana completa, el Caribe, Latinoamérica y el mundo. Cuando la noticia tiene conexión con Santo Domingo Este o RD, lo destacas con contexto local.',
    tono: 'profesional',
    extension: 'media',
    enfasis: 'Si la noticia es nacional: prioriza SDE, Los Mina, Invivienda, Ensanche Ozama. Si es internacional: conecta con el impacto en República Dominicana y el Caribe.',
    evitar: 'Limitar el tema solo a Santo Domingo Este. Especulación sin fuentes. Titulares sensacionalistas. Repetir noticias ya publicadas. Copiar texto de Wikipedia.'
};

let CONFIG_IA = { ...CONFIG_IA_DEFAULT };

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
    } catch (e) {
        CONFIG_IA = { ...CONFIG_IA_DEFAULT };
        console.log('⚠️ Config IA: usando defecto (' + e.message + ')');
    }
    return CONFIG_IA;
}

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
    } catch (e) {
        console.error('❌ guardarConfigIA:', e.message);
        return false;
    }
}

// ══════════════════════════════════════════════════════════
// GEMINI
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
                            temperature: 0.8,
                            maxOutputTokens: 4000,
                            stopSequences: []
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
            const data = await res.json();
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
// FACEBOOK
// ══════════════════════════════════════════════════════════
async function publicarEnFacebook(titulo, slug, urlImagen, descripcion) {
    if (!FB_PAGE_ID || !FB_PAGE_TOKEN) return false;
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const mensaje = `🏮 ${titulo}\n\n${descripcion || ''}\n\nLee la noticia completa 👇\n${urlNoticia}\n\n#ElFarolAlDía #RepúblicaDominicana #NoticiaRD`;

        const form = new URLSearchParams();
        form.append('url', urlImagen);
        form.append('caption', mensaje);
        form.append('access_token', FB_PAGE_TOKEN);

        const res = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/photos`, { method: 'POST', body: form });
        const data = await res.json();

        if (data.error) {
            const form2 = new URLSearchParams();
            form2.append('message', mensaje);
            form2.append('link', urlNoticia);
            form2.append('access_token', FB_PAGE_TOKEN);
            const res2 = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/feed`, { method: 'POST', body: form2 });
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
// TWITTER
// ══════════════════════════════════════════════════════════
function generarOAuthHeader(method, url, params, consumerKey, consumerSecret, accessToken, tokenSecret) {
    const oauthParams = {
        oauth_consumer_key: consumerKey,
        oauth_nonce: crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_token: accessToken,
        oauth_version: '1.0'
    };
    const allParams = { ...params, ...oauthParams };
    const sortedParams = Object.keys(allParams).sort()
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`).join('&');
    const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
    const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
    const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
    oauthParams.oauth_signature = signature;
    return 'OAuth ' + Object.keys(oauthParams).sort()
        .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
        .join(', ');
}

async function publicarEnTwitter(titulo, slug, descripcion) {
    if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) return false;
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const textoBase = `🏮 ${titulo}\n\n${urlNoticia}\n\n#ElFarolAlDía #RD`;
        const tweet = textoBase.length > 280 ? textoBase.substring(0, 277) + '...' : textoBase;
        const tweetUrl = 'https://api.twitter.com/2/tweets';
        const authHeader = generarOAuthHeader('POST', tweetUrl, {}, TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET);
        const res = await fetch(tweetUrl, {
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
        const bufOrig = Buffer.from(await response.arrayBuffer());
        if (!fs.existsSync(WATERMARK_PATH)) { console.warn('   ⚠️ Watermark no encontrado'); return { url: urlImagen, procesada: false }; }
        const meta = await sharp(bufOrig).metadata();
        const w = meta.width || 800;
        const h = meta.height || 500;
        const wmAncho = Math.min(Math.round(w * 0.28), 300);
        const wmResized = await sharp(WATERMARK_PATH).resize(wmAncho, null, { fit: 'inside' }).toBuffer();
        const wmMeta = await sharp(wmResized).metadata();
        const wmAlto = wmMeta.height || 60;
        const margen = Math.round(w * 0.02);
        const bufFinal = await sharp(bufOrig)
            .composite([{ input: wmResized, left: Math.max(0, w - wmAncho - margen), top: Math.max(0, h - wmAlto - margen), blend: 'over' }])
            .jpeg({ quality: 88 }).toBuffer();
        const nombre = `efd-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.jpg`;
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
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public,max-age=604800');
        return res.sendFile(ruta);
    }
    try {
        const nombre = req.params.nombre;
        const r = await pool.query(
            `SELECT imagen_original FROM noticias WHERE imagen_nombre=$1 LIMIT 1`,
            [nombre]
        );
        if (r.rows.length && r.rows[0].imagen_original) {
            return res.redirect(302, r.rows[0].imagen_original);
        }
    } catch (e) { /* silencioso */ }
    res.status(404).send('Imagen no disponible');
});

// ══════════════════════════════════════════════════════════
// ▶ SISTEMA DE MEMORIA IA
// ══════════════════════════════════════════════════════════

async function registrarQueryPexels(query, categoria, exito) {
    try {
        await pool.query(`
            INSERT INTO memoria_ia(tipo, valor, categoria, exitos, fallos)
            VALUES('pexels_query', $1, $2, $3, $4)
            ON CONFLICT DO NOTHING
        `, [query, categoria, exito ? 1 : 0, exito ? 0 : 1]);

        await pool.query(`
            UPDATE memoria_ia
            SET exitos = exitos + $1,
                fallos = fallos + $2,
                ultima_vez = NOW()
            WHERE tipo = 'pexels_query' AND valor = $3 AND categoria = $4
        `, [exito ? 1 : 0, exito ? 0 : 1, query, categoria]);
    } catch (e) { /* silencioso */ }
}

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
    } catch (e) { return []; }
}

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
    } catch (e) { /* silencioso */ }
}

async function construirMemoria(categoria) {
    let memoria = '';
    try {
        const recientes = await pool.query(`
            SELECT titulo, fecha FROM noticias
            WHERE estado = 'publicada'
            ORDER BY fecha DESC LIMIT 15
        `);
        if (recientes.rows.length) {
            memoria += `\n⛔ YA PUBLICADAS — NO repetir ni parafrasear:\n`;
            memoria += recientes.rows.map((x, i) => `${i + 1}. ${x.titulo}`).join('\n');
            memoria += '\n';
        }

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

        const mejores = await obtenerMejoresQueries(categoria);
        if (mejores.length) {
            memoria += `\n💡 QUERIES DE IMAGEN QUE FUNCIONAN BIEN PARA ${categoria.toUpperCase()}:\n`;
            memoria += mejores.map(q => `- "${q}"`).join('\n');
            memoria += '\n';
        }

    } catch (e) { /* silencioso */ }
    return memoria;
}

async function regenerarWatermarksLostidos() {
    try {
        const r = await pool.query(`
            SELECT id, imagen, imagen_nombre, imagen_original
            FROM noticias
            WHERE imagen LIKE '%/img/%'
              AND imagen_original IS NOT NULL
              AND imagen_original != ''
            ORDER BY fecha DESC LIMIT 10
        `);
        if (!r.rows.length) return;

        let regeneradas = 0;
        for (const n of r.rows) {
            const nombre = n.imagen_nombre || n.imagen.split('/img/')[1];
            if (!nombre) continue;
            const ruta = path.join('/tmp', nombre);
            if (fs.existsSync(ruta)) continue;

            const resultado = await aplicarMarcaDeAgua(n.imagen_original);
            if (resultado.procesada && resultado.nombre) {
                await pool.query(
                    `UPDATE noticias SET imagen=$1, imagen_nombre=$2 WHERE id=$3`,
                    [`${BASE_URL}/img/${resultado.nombre}`, resultado.nombre, n.id]
                );
                regeneradas++;
            }
            await new Promise(r => setTimeout(r, 100));
        }
        if (regeneradas > 0) {
            console.log(`🏮 Watermarks regenerados: ${regeneradas}`);
            invalidarCache();
        }
    } catch (e) {
        console.log(`⚠️ Regeneración watermarks: ${e.message}`);
    }
}

// ══════════════════════════════════════════════════════════
// ▶ GENERAR NOTICIA
// ══════════════════════════════════════════════════════════

async function generarNoticia(categoria, comunicadoExterno = null) {
    try {
        if (!CONFIG_IA.enabled) return { success: false, error: 'IA desactivada' };

        const memoria = await construirMemoria(categoria);

        const fuenteContenido = comunicadoExterno
            ? `\nCOMUNICADO OFICIAL:\n"""\n${comunicadoExterno}\n"""\nRedacta una noticia profesional basada en este comunicado. Reescribe con tu estilo periodístico, no copies textualmente.`
            : `\nEscribe una noticia NUEVA sobre la categoría "${categoria}" para República Dominicana. Que sea un hecho real y relevante del contexto actual.`;

        const temaParaWiki = comunicadoExterno
            ? (comunicadoExterno.split('\n')[0] || '').replace(/^T[IÍ]TULO:\s*/i, '').trim() || categoria
            : categoria;

        const contextoWiki = await buscarContextoWikipedia(temaParaWiki, categoria);

        const prompt = `${CONFIG_IA.instruccion_principal}

ROL: Eres el editor jefe de El Farol al Día con 20 años de experiencia en periodismo dominicano. Escribes exactamente como el Listín Diario o Diario Libre: datos concretos, fuentes verificables, impacto real para el ciudadano dominicano. Periodismo serio, sin exageración ni sensacionalismo.

${memoria}
${contextoWiki}
${fuenteContenido}

CATEGORÍA: ${categoria}
TONO: ${CONFIG_IA.tono}
EXTENCIÓN: 400-500 palabras
EVITAR: ${CONFIG_IA.evitar}
ÉNFASIS LOCAL: ${CONFIG_IA.enfasis}

RESPONDE EXACTAMENTE CON ESTE FORMATO:
TITULO: [60-70 chars]
DESCRIPCION: [150-160 chars]
PALABRAS: [5 keywords]
QUERY_IMAGEN: [3-5 palabras inglés]
ALT_IMAGEN: [15-20 palabras español]
SUBTEMA_LOCAL: [politica-gobierno, seguridad-policia, relaciones-internacionales, economia-mercado, infraestructura, salud-medicina, deporte-beisbol, deporte-general, tecnologia, educacion, cultura-musica, medio-ambiente, turismo, emergencia]
CONTENIDO:
[400-500 palabras, párrafos separados por línea en blanco]`;

        console.log(`\n📰 Generando: ${categoria}${comunicadoExterno ? ' (RSS)' : ''}`);
        const texto = await llamarGemini(prompt);

        const textoLimpio = texto.replace(/^\s*[*#]+\s*/gm, '');

        let titulo = '', desc = '', pals = '', qi = '', ai = '', sub = '', contenido = '';
        let enContenido = false;
        const bloques = [];

        for (const linea of textoLimpio.split('\n')) {
            const t = linea.trim();
            if (t.startsWith('TITULO:')) titulo = t.replace('TITULO:', '').trim();
            else if (t.startsWith('DESCRIPCION:')) desc = t.replace('DESCRIPCION:', '').trim();
            else if (t.startsWith('PALABRAS:')) pals = t.replace('PALABRAS:', '').trim();
            else if (t.startsWith('QUERY_IMAGEN:')) qi = t.replace('QUERY_IMAGEN:', '').trim();
            else if (t.startsWith('ALT_IMAGEN:')) ai = t.replace('ALT_IMAGEN:', '').trim();
            else if (t.startsWith('SUBTEMA_LOCAL:')) sub = t.replace('SUBTEMA_LOCAL:', '').trim();
            else if (t.startsWith('CONTENIDO:')) enContenido = true;
            else if (enContenido && t.length > 0) bloques.push(t);
        }

        contenido = bloques.join('\n\n');
        titulo = titulo.replace(/[*_#`"]/g, '').trim();
        desc = desc.replace(/[*_#`]/g, '').trim();

        if (!titulo)
            throw new Error('Gemini no devolvió TITULO');
        if (!contenido || contenido.length < 300)
            throw new Error(`Contenido insuficiente (${contenido.length} chars)`);

        console.log(`   📝 ${titulo}`);

        const urlOrig = await obtenerImagenInteligente(titulo, categoria, sub, qi);
        const imgResult = await aplicarMarcaDeAgua(urlOrig);
        const urlFinal = imgResult.procesada ? `${BASE_URL}/img/${imgResult.nombre}` : urlOrig;

        const altFinal = generarAltSEO(titulo, categoria, ai, sub);

        const sl = slugify(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug=$1', [sl]);
        const slFin = existe.rows.length ? `${sl}-${Date.now()}` : sl;

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
                urlOrig,
                'publicada'
            ]
        );

        console.log(`\n✅ /noticia/${slFin}`);
        invalidarCache();

        if (qi) registrarQueryPexels(qi, categoria, true);

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
        await registrarError('generacion', error.message, categoria);
        return { success: false, error: error.message };
    }
}

// ══════════════════════════════════════════════════════════
// RSS
// ══════════════════════════════════════════════════════════
const FUENTES_RSS = [
    { url: 'https://presidencia.gob.do/feed', categoria: 'Nacionales', nombre: 'Presidencia RD' },
    { url: 'https://policia.gob.do/feed', categoria: 'Nacionales', nombre: 'Policía Nacional' },
    { url: 'https://www.mopc.gob.do/feed', categoria: 'Nacionales', nombre: 'MOPC' },
    { url: 'https://www.salud.gob.do/feed', categoria: 'Nacionales', nombre: 'Salud Pública' },
    { url: 'https://www.educacion.gob.do/feed', categoria: 'Nacionales', nombre: 'Educación' },
    { url: 'https://www.bancentral.gov.do/feed', categoria: 'Economía', nombre: 'Banco Central' },
    { url: 'https://mepyd.gob.do/feed', categoria: 'Economía', nombre: 'MEPyD' },
    { url: 'https://www.invivienda.gob.do/feed', categoria: 'Nacionales', nombre: 'Invivienda' },
    { url: 'https://mitur.gob.do/feed', categoria: 'Nacionales', nombre: 'Turismo' },
    { url: 'https://pgr.gob.do/feed', categoria: 'Nacionales', nombre: 'Procuraduría' },
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
                    item.title ? `TÍTULO: ${item.title}` : '',
                    item.contentSnippet ? `RESUMEN: ${item.contentSnippet}` : '',
                    item.content ? `CONTENIDO: ${item.content?.substring(0, 2000)}` : '',
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

cron.schedule('*/14 * * * *', async () => {
    try {
        await fetch(`http://localhost:${PORT}/health`);
    } catch (e) { /* silencioso */ }
});

cron.schedule('0 */4 * * *', async () => {
    if (!CONFIG_IA.enabled) return;
    await generarNoticia(CATS[Math.floor(Math.random() * CATS.length)]);
});

cron.schedule('0 1,7,13,19 * * *', async () => {
    await procesarRSS();
});

// ══════════════════════════════════════════════════════════
// CACHÉ
// ══════════════════════════════════════════════════════════
let _cacheNoticias = null;
let _cacheFecha = 0;
const CACHE_TTL = 60 * 1000;

function invalidarCache() { _cacheNoticias = null; _cacheFecha = 0; }

// ══════════════════════════════════════════════════════════
// ▶ COACH DE REDACCIÓN
// ══════════════════════════════════════════════════════════

async function analizarRendimiento(dias = 7) {
    try {
        const noticias = await pool.query(`
            SELECT 
                id, titulo, seccion, vistas, fecha,
                EXTRACT(epoch FROM (NOW() - fecha))/3600 as horas_desde_publicacion
            FROM noticias 
            WHERE estado = 'publicada' 
            AND fecha > NOW() - INTERVAL '${dias} days'
            ORDER BY vistas DESC
        `);

        if (noticias.rows.length === 0) {
            return { success: true, mensaje: 'No hay noticias en el período', noticias: [] };
        }

        const totalVistas = noticias.rows.reduce((sum, n) => sum + (n.vistas || 0), 0);
        const promedioGeneral = Math.round(totalVistas / noticias.rows.length);

        const categorias = {};
        const categoriasArray = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];
        
        categoriasArray.forEach(cat => {
            const noticiasCat = noticias.rows.filter(n => n.seccion === cat);
            if (noticiasCat.length > 0) {
                const vistasCat = noticiasCat.reduce((sum, n) => sum + (n.vistas || 0), 0);
                const promedioCat = Math.round(vistasCat / noticiasCat.length);
                const mejorNoticia = noticiasCat.reduce((best, n) => (n.vistas > (best?.vistas || 0) ? n : best), null);
                
                categorias[cat] = {
                    total: noticiasCat.length,
                    vistas_totales: vistasCat,
                    vistas_promedio: promedioCat,
                    rendimiento: Math.round((promedioCat / promedioGeneral) * 100),
                    mejor_noticia: mejorNoticia ? {
                        titulo: mejorNoticia.titulo,
                        vistas: mejorNoticia.vistas,
                        slug: mejorNoticia.slug
                    } : null
                };
            } else {
                categorias[cat] = {
                    total: 0,
                    vistas_totales: 0,
                    vistas_promedio: 0,
                    rendimiento: 0,
                    mejor_noticia: null
                };
            }
        });

        const imagenes = await pool.query(`
            SELECT valor, exitos, fallos, categoria,
                   (exitos::float / GREATEST(exitos + fallos, 1)) as tasa_exito
            FROM memoria_ia
            WHERE tipo = 'pexels_query' 
            AND (exitos + fallos) > 2
            ORDER BY tasa_exito DESC, exitos DESC
            LIMIT 10
        `);

        const errores = await pool.query(`
            SELECT valor, fallos, categoria
            FROM memoria_ia
            WHERE tipo = 'error'
            AND ultima_vez > NOW() - INTERVAL '7 days'
            ORDER BY fallos DESC
            LIMIT 5
        `);

        const tendencias = await pool.query(`
            SELECT 
                DATE_TRUNC('hour', fecha) as hora,
                COUNT(*) as noticias,
                AVG(vistas) as vistas_promedio_hora
            FROM noticias
            WHERE estado = 'publicada'
            AND fecha > NOW() - INTERVAL '3 days'
            GROUP BY DATE_TRUNC('hour', fecha)
            ORDER BY hora DESC
            LIMIT 24
        `);

        return {
            success: true,
            periodo: `${dias} días`,
            total_noticias: noticias.rows.length,
            total_vistas: totalVistas,
            promedio_general: promedioGeneral,
            categorias,
            imagenes: imagenes.rows.map(i => ({
                query: i.valor,
                categoria: i.categoria,
                exitos: i.exitos,
                fallos: i.fallos,
                tasa_exito: Math.round(i.tasa_exito * 100)
            })),
            errores: errores.rows.map(e => ({
                mensaje: e.valor,
                categoria: e.categoria,
                frecuencia: e.fallos
            })),
            tendencias: tendencias.rows.map(t => ({
                hora: t.hora,
                noticias: t.noticias,
                vistas_promedio: Math.round(t.vistas_promedio_hora || 0)
            }))
        };

    } catch (error) {
        console.error('❌ Error analizando rendimiento:', error);
        return { success: false, error: error.message };
    }
}

// ══════════════════════════════════════════════════════════
// RUTAS API
// ══════════════════════════════════════════════════════════

app.get('/health', (req, res) => res.json({ status: 'OK', version: '34.0' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/contacto', (req, res) => res.sendFile(path.join(__dirname, 'client', 'contacto.html')));
app.get('/nosotros', (req, res) => res.sendFile(path.join(__dirname, 'client', 'nosotros.html')));
app.get('/privacidad', (req, res) => res.sendFile(path.join(__dirname, 'client', 'privacidad.html')));

app.get('/cambiar-pais/:pais', (req, res) => {
    const paisesPermitidos = ['es-do', 'es-us', 'es-es', 'es', 'en-us', 'fr', 'pt'];
    const pais = req.params.pais;
    
    if (paisesPermitidos.includes(pais)) {
        res.cookie('pais_seleccionado', pais, { 
            maxAge: 30 * 24 * 60 * 60 * 1000,
            httpOnly: true 
        });
        res.redirect(req.get('referer') || '/');
    } else {
        res.status(400).send('País no válido');
    }
});

app.get('/api/pais-actual', (req, res) => {
    res.json({ pais: req.paisIdioma || 'es-do' });
});

app.get('/api/coach', async (req, res) => {
    const { dias = 7, pin } = req.query;
    
    if (pin !== '311') {
        const analisis = await analizarRendimiento(parseInt(dias));
        if (!analisis.success) {
            return res.status(500).json(analisis);
        }
        
        return res.json({
            success: true,
            periodo: analisis.periodo,
            resumen: {
                total_noticias: analisis.total_noticias,
                total_vistas: analisis.total_vistas,
                promedio_general: analisis.promedio_general
            },
            categorias: Object.entries(analisis.categorias).map(([nombre, data]) => ({
                nombre,
                vistas_promedio: data.vistas_promedio,
                rendimiento: data.rendimiento,
                total_noticias: data.total
            })),
            mejores_queries: analisis.imagenes.slice(0, 5).map(i => i.query)
        });
    }
    
    const analisis = await analizarRendimiento(parseInt(dias));
    res.json(analisis);
});

app.get('/api/coach/recomendar', async (req, res) => {
    try {
        const analisis = await analizarRendimiento(30);
        
        if (!analisis.success) {
            return res.status(500).json(analisis);
        }
        
        const recomendaciones = [];
        
        const categoriasBajas = Object.entries(analisis.categorias)
            .filter(([_, data]) => data.rendimiento < 70 && data.total > 0)
            .sort((a, b) => a[1].rendimiento - b[1].rendimiento);
        
        if (categoriasBajas.length > 0) {
            categoriasBajas.forEach(([cat, data]) => {
                recomendaciones.push({
                    tipo: 'mejora',
                    categoria: cat,
                    mensaje: `La categoría "${cat}" tiene ${data.rendimiento}% del promedio general.`,
                    sugerencia: `Usa queries como: ${analisis.imagenes.filter(i => i.categoria === cat).map(i => i.query).join(', ') || 'dominican republic urban life'}`
                });
            });
        }
        
        const mejoresQueries = analisis.imagenes.filter(i => i.tasa_exito > 80).slice(0, 3);
        if (mejoresQueries.length > 0) {
            recomendaciones.push({
                tipo: 'imagenes',
                mensaje: 'Estas queries tienen MEJOR rendimiento:',
                sugerencia: mejoresQueries.map(q => `"${q.query}" (${q.tasa_exito}% éxito)`).join(' · ')
            });
        }
        
        res.json({
            success: true,
            fecha: new Date().toISOString(),
            total_recomendaciones: recomendaciones.length,
            recomendaciones
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// COMENTARIOS
app.post('/api/comentarios/eliminar/:id', async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ error: 'PIN incorrecto' });
    try {
        await pool.query('DELETE FROM comentarios WHERE id=$1', [parseInt(req.params.id)]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

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
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/comentarios/:noticia_id', async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT id, nombre, texto, fecha
            FROM comentarios
            WHERE noticia_id=$1 AND aprobado=true
            ORDER BY fecha ASC
        `, [req.params.noticia_id]);
        res.json({ success: true, comentarios: r.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

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
        `, [noticia_id, nombre.trim().substring(0, 80), texto.trim().substring(0, 1000)]);
        console.log(`💬 Comentario: noticia ${noticia_id} — ${nombre.trim()}`);
        res.json({ success: true, comentario: r.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// OTRAS API
app.get('/api/noticias', async (req, res) => {
    try {
        if (_cacheNoticias && (Date.now() - _cacheFecha) < CACHE_TTL) {
            return res.json({ success: true, noticias: _cacheNoticias, cached: true });
        }
        const r = await pool.query(
            `SELECT id,titulo,slug,seccion,imagen,imagen_alt,fecha,vistas,redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30`,
            ['publicada']
        );
        _cacheNoticias = r.rows;
        _cacheFecha = Date.now();
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
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/wikipedia', async (req, res) => {
    const { tema, categoria } = req.query;
    if (!tema) return res.status(400).json({ error: 'Falta ?tema=' });
    const contexto = await buscarContextoWikipedia(tema, categoria || 'Nacionales');
    res.json({ success: true, longitud: contexto.length, contexto });
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
        const e = await pool.query('SELECT id FROM noticias WHERE slug=$1', [sl]);
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
    if (enabled !== undefined) CONFIG_IA.enabled = enabled;
    if (instruccion_principal) CONFIG_IA.instruccion_principal = instruccion_principal;
    if (tono) CONFIG_IA.tono = tono;
    if (extension) CONFIG_IA.extension = extension;
    if (evitar) CONFIG_IA.evitar = evitar;
    if (enfasis) CONFIG_IA.enfasis = enfasis;
    const ok = await guardarConfigIA(CONFIG_IA);
    res.json({ success: ok });
});

app.get('/status', async (req, res) => {
    try {
        const r = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado=$1', ['publicada']);
        const rss = await pool.query('SELECT COUNT(*) FROM rss_procesados');
        res.json({
            status: 'OK', 
            version: '34.0',
            noticias: parseInt(r.rows[0].count),
            rss_procesados: parseInt(rss.rows[0].count),
            facebook: FB_PAGE_ID && FB_PAGE_TOKEN ? '✅ Activo' : '⚠️ Sin credenciales',
            twitter: TWITTER_API_KEY && TWITTER_ACCESS_TOKEN ? '✅ Activo' : '⚠️ Sin credenciales',
            pexels_api: PEXELS_API_KEY ? '✅ Activa' : '⚠️ Sin key',
            wikipedia: '✅ Activa',
            wikimedia_commons: '✅ Activo',
            marca_de_agua: fs.existsSync(WATERMARK_PATH) ? '✅ Activa' : '⚠️ Falta watermark.png',
            ia_activa: CONFIG_IA.enabled,
            pais_detectado: req.paisIdioma || 'es-do',
            sistema: 'Web + Facebook + Twitter + RSS + Wikipedia + Wikimedia + SEO + HREFLANG + Comentarios + Coach'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/noticia/:slug', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM noticias WHERE slug=$1 AND estado=$2', [req.params.slug, 'publicada']);
        if (!r.rows.length) return res.status(404).send('No encontrada');

        const n = r.rows[0];
        await pool.query('UPDATE noticias SET vistas=vistas+1 WHERE id=$1', [n.id]);

        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
            const urlN = `${BASE_URL}/noticia/${n.slug}`;
            const cHTML = n.contenido.split('\n').filter(p => p.trim()).map(p => `<p>${p.trim()}</p>`).join('');
            html = html
                .replace('<!-- META_TAGS -->', metaTagsCompletos(n, urlN, req.paisIdioma))
                .replace(/{{TITULO}}/g, esc(n.titulo))
                .replace(/{{CONTENIDO}}/g, cHTML)
                .replace(/{{FECHA}}/g, new Date(n.fecha).toLocaleDateString('es-DO', { year: 'numeric', month: 'long', day: 'numeric' }))
                .replace(/{{IMAGEN}}/g, n.imagen)
                .replace(/{{ALT}}/g, esc(n.imagen_alt || n.titulo))
                .replace(/{{VISTAS}}/g, n.vistas)
                .replace(/{{REDACTOR}}/g, esc(n.redactor))
                .replace(/{{SECCION}}/g, esc(n.seccion))
                .replace(/{{URL}}/g, encodeURIComponent(urlN));
            res.setHeader('Content-Type', 'text/html;charset=utf-8');
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
        res.header('Content-Type', 'application/xml');
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

app.use((req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));

// ══════════════════════════════════════════════════════════
// ARRANQUE
// ══════════════════════════════════════════════════════════
async function iniciar() {
    await inicializarBase();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — V34.0 INTERNACIONAL (CORREGIDA)           ║
╠══════════════════════════════════════════════════════════════════╣
║  🌐 Web · 📘 Facebook · 🐦 Twitter · 📚 Wikipedia               ║
║  🖼️ Wikimedia Commons (73M imágenes) · 🧠 Memoria IA            ║
║  💬 Comentarios · 🔍 SEO E-E-A-T · 📊 Coach · 🌍 HREFLANG       ║
║  🏮 Watermark automático · 👤 Personajes públicos               ║
║                                                                  ║
║  Facebook:  ${FB_PAGE_ID && FB_PAGE_TOKEN ? '✅ ACTIVO          ' : '⚠️  Sin credenciales'}║
║  Twitter:   ${TWITTER_API_KEY && TWITTER_ACCESS_TOKEN ? '✅ ACTIVO          ' : '⚠️  Sin credenciales'}║
║  Watermark: ${fs.existsSync(WATERMARK_PATH) ? '✅ ACTIVA          ' : '⚠️  Falta watermark '}║
╚══════════════════════════════════════════════════════════════════╝`);
    });
    setTimeout(regenerarWatermarksLostidos, 5000);
}

iniciar();
module.exports = app;
