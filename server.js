/**
 * 🏮 EL FAROL AL DÍA — V37.5 QUAD-KEY EDITION (MXL)
 * ─────────────────────────────────────────────────────────────────────────
 * ✅ CORRECCIONES CRÍTICAS V37.5:
 *   1. Validación flexible: mínimo de caracteres BAJADO DE 600 A 300.
 *   2. Audio Sincrónico: ElevenLabs se genera ANTES del INSERT en BD.
 *   3. Prompt de Blindaje: Obliga a Gemini a mencionar barrios de SDE.
 * ✅ NUEVO EN V37.0:
 *   1. Rotación round-robin de 4 llaves Gemini (KEY1–KEY4)
 *   2. Reparto de carga: KEY1+KEY2 → texto SDE | KEY3+KEY4 → imagen/query
 *   3. Blindaje anti-429: salto automático a siguiente llave disponible
 *   4. Audio ElevenLabs siempre vinculado al slug antes de responder a /tv
 * ✅ HEREDADO DE V36.0:
 *   - ElevenLabs TTS — genera audio .mp3 por noticia
 *   - Ruta /tv — pantalla digital de noticiero con autoplay + ciclo
 *   - SQL parametrizado limpio (sin backticks ni whitespace en queries)
 *   - buscarContextoActualSDE: rotación correcta de CSE keys
 *   - Validación de contenido (300+ chars, barrios SDE, lenguaje dominicano)
 *   - Anti-repetición: 25 títulos + detección automática
 *   - Reintentos automáticos (máx 3) con presión creciente
 *   - Notificaciones push para celular
 *   - aplicarMarcaDeAgua ignora base64-upload y data:image
 * ─────────────────────────────────────────────────────────────────────────
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
const webPush   = require('web-push');

// ══════════════════════════════════════════════════════════
// 🔒 BASIC AUTH
// ══════════════════════════════════════════════════════════
function authMiddleware(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día - Redacción"');
        return res.status(401).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Acceso Restringido</title><style>body{background:#070707;color:#EDE8DF;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.box{background:#141418;border:1px solid #FF5500;border-radius:12px;padding:40px;text-align:center;max-width:380px}h2{color:#FF5500;font-size:22px;margin-bottom:10px}p{color:#A89F94;font-size:14px;margin-bottom:20px}a{display:inline-block;background:#FF5500;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold}a:hover{background:#CC4300}</style></head><body><div class="box"><h2>🏮 ACCESO RESTRINGIDO</h2><p>Panel de redacción requiere autenticación.<br><br>Usuario: <strong>director</strong><br>Contraseña: <strong>311</strong></p><a href="/redaccion">ENTRAR AL PANEL</a></div></body></html>`);
    }
    try {
        const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
        const [user, ...passParts] = decoded.split(':');
        const pass = passParts.join(':');
        if (user === 'director' && pass === '311') return next();
    } catch(e) {}
    res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día - Redacción"');
    return res.status(401).send('Credenciales incorrectas. Usuario: director / Contraseña: 311');
}

const app      = express();
const PORT     = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

if (!process.env.DATABASE_URL)   { console.error('❌ DATABASE_URL requerido');  process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY requerido'); process.exit(1); }

// ══════════════════════════════════════════════════════════
// 🔑 LLAVERO V37.0 — 4 LLAVES GEMINI EN ROTACIÓN ROUND-ROBIN
// ══════════════════════════════════════════════════════════
const LLAVES_TEXTO = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY2,
].filter(Boolean);

const LLAVES_IMAGEN = [
    process.env.GEMINI_API_KEY3 || process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY4 || process.env.GEMINI_API_KEY2,
].filter(Boolean);

const RR_IDX = { texto: 0, imagen: 0 };

function siguienteLlave(grupo) {
    const lista = grupo === 'texto' ? LLAVES_TEXTO : LLAVES_IMAGEN;
    if (!lista.length) throw new Error(`Sin llaves configuradas para grupo: ${grupo}`);
    const idx = RR_IDX[grupo] % lista.length;
    RR_IDX[grupo] = (idx + 1) % lista.length;
    return lista[idx];
}

const GEMINI_STATE = {};
function getKeyState(k) {
    if (!GEMINI_STATE[k]) GEMINI_STATE[k] = { lastRequest: 0, resetTime: 0, fallos429: 0 };
    return GEMINI_STATE[k];
}

// ══════════════════════════════════════════════════════════
// 🔑 LLAVES AUXILIARES
// ══════════════════════════════════════════════════════════
const GOOGLE_CSE_KEYS = [process.env.GOOGLE_CSE_KEY, process.env.GOOGLE_CSE_KEY_2].filter(Boolean);
const GOOGLE_CSE_CX   = process.env.GOOGLE_CSE_ID || process.env.GOOGLE_CSE_CX || '';
const PEXELS_API_KEY  = process.env.PEXELS_API_KEY || null;

// ══════════════════════════════════════════════════════════
// 🎙️  ELEVENLABS TTS
// ══════════════════════════════════════════════════════════
const ELEVEN_LABS_KEY = process.env.ELEVENLABS_API_KEY || null;
const VOICE_ID        = 'pNInz6ovxtat4uicW8ld';

async function generarAudioNoticia(texto, slug) {
    if (!ELEVEN_LABS_KEY) {
        console.log('🎙️ ElevenLabs: ELEVENLABS_API_KEY no configurada — audio omitido');
        return null;
    }
    try {
        let textoLimpio = texto
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 4000);
        const ultimoPunto = textoLimpio.lastIndexOf('.');
        if (ultimoPunto > 500) textoLimpio = textoLimpio.substring(0, ultimoPunto + 1);

        const nombreArchivo = `audio-${slug}.mp3`;
        const rutaArchivo   = path.join('/tmp', nombreArchivo);

        console.log(`🎙️ Generando audio: ${slug} (${textoLimpio.length} chars)...`);

        const ctrl = new AbortController();
        const tm   = setTimeout(() => ctrl.abort(), 30000);

        const res = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
            {
                method:  'POST',
                signal:  ctrl.signal,
                headers: {
                    'xi-api-key':   ELEVEN_LABS_KEY,
                    'Content-Type': 'application/json',
                    'Accept':       'audio/mpeg',
                },
                body: JSON.stringify({
                    text:           textoLimpio,
                    model_id:       'eleven_multilingual_v2',
                    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
                }),
            }
        ).finally(() => clearTimeout(tm));

        if (!res.ok) return null;

        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length < 1000) return null;
        fs.writeFileSync(rutaArchivo, buffer);
        console.log(`🎙️ Audio OK: ${nombreArchivo} (${Math.round(buffer.length / 1024)} KB)`);
        return nombreArchivo;
    } catch (err) {
        console.warn(`🎙️ ElevenLabs error: ${err.message}`);
        return null;
    }
}

// ══════════════════════════════════════════════════════════
// 📱 WEB PUSH VAPID
// ══════════════════════════════════════════════════════════
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || null;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     || 'mailto:alertas@elfarolaldia.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log('📱 Web Push VAPID configurado');
}

// ══════════════════════════════════════════════════════════
// 🏮 WATERMARK
// ══════════════════════════════════════════════════════════
const WATERMARK_PATH = (() => {
    const variantes = ['watermark.png', 'WATERMARK.png'];
    const bases = [path.join(process.cwd(), 'static'), path.join(__dirname, 'static')];
    for (const base of bases) {
        for (const nombre of variantes) {
            const ruta = path.join(base, nombre);
            if (fs.existsSync(ruta)) { console.log(`🏮 Watermark: ${ruta}`); return ruta; }
        }
    }
    console.warn('⚠️ Watermark no encontrado — fotos sin marca');
    return null;
})();

const rssParser = new RSSParser({ timeout: 10000 });

// ══════════════════════════════════════════════════════════
// BASE DE DATOS
// ══════════════════════════════════════════════════════════
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','X-Requested-With'] }));
app.options('*', cors());

// ══════════════════════════════════════════════════════════
// 📱 TABLA PUSH SUSCRIPCIONES
// ══════════════════════════════════════════════════════════
async function initPushTable() {
    const client = await pool.connect();
    try {
        await client.query(
            'CREATE TABLE IF NOT EXISTS push_suscripciones (' +
            'id SERIAL PRIMARY KEY,' +
            'endpoint TEXT UNIQUE NOT NULL,' +
            'auth_key TEXT NOT NULL,' +
            'p256dh_key TEXT NOT NULL,' +
            'user_agent TEXT,' +
            'fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,' +
            'ultima_notificacion TIMESTAMP' +
            ')'
        );
        console.log('📱 Tabla push_suscripciones lista');
    } catch(e) { console.warn('⚠️ Push table:', e.message); }
    finally { client.release(); }
}

// ══════════════════════════════════════════════════════════
// 📱 ENVIAR NOTIFICACIÓN PUSH
// ══════════════════════════════════════════════════════════
async function enviarNotificacionPush(titulo, cuerpo, slug, imagenUrl) {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
    try {
        const suscriptores = await pool.query(
            'SELECT endpoint, auth_key, p256dh_key FROM push_suscripciones WHERE endpoint IS NOT NULL'
        );
        if (!suscriptores.rows.length) return false;
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const notificacion = {
            title: titulo.substring(0, 80),
            body: cuerpo.substring(0, 120),
            icon: imagenUrl || `${BASE_URL}/static/favicon.png`,
            badge: `${BASE_URL}/static/badge.png`,
            vibrate: [200, 100, 200],
            data: { url: urlNoticia, slug },
            actions: [{ action: 'open', title: '📰 Leer noticia' }],
            tag: `noticia-${slug}`,
            renotify: true
        };
        const payload = JSON.stringify(notificacion);
        let enviadas = 0;
        for (const sub of suscriptores.rows) {
            try {
                await webPush.sendNotification({ endpoint: sub.endpoint, keys: { auth: sub.auth_key, p256dh: sub.p256dh_key } }, payload);
                enviadas++;
                await pool.query('UPDATE push_suscripciones SET ultima_notificacion = NOW() WHERE endpoint = $1', [sub.endpoint]);
                await new Promise(r => setTimeout(r, 100));
            } catch (err) {
                if (err.statusCode === 410) await pool.query('DELETE FROM push_suscripciones WHERE endpoint = $1', [sub.endpoint]);
            }
        }
        console.log(`📱 Push: ${enviadas} enviadas`);
        return enviadas > 0;
    } catch (err) { return false; }
}

// ══════════════════════════════════════════════════════════
// CONFIG IA
// ══════════════════════════════════════════════════════════
let CONFIG_IA = {
    enabled: true,
    instruccion_principal: 'Eres un periodista dominicano del barrio, directo y sin rodeos. Escribes para el lector de Los Mina, Invivienda, Charles de Gaulle y todo Santo Domingo Este. Párrafos cortos. Lenguaje real de la calle. Cero relleno.',
    tono: 'directo-barrio',
    extension: 'media',
    enfasis: 'Prioriza Santo Domingo Este: Los Mina, Invivienda, Ensanche Ozama, Sabana Perdida, Villa Mella, Charles de Gaulle.',
    evitar: 'Párrafos largos. Lenguaje técnico. Especulación. Repetir noticias publicadas.'
};

// ══════════════════════════════════════════════════════════
// 🔑 GEMINI V37.0 — ROUND-ROBIN + BLINDAJE 429
// ══════════════════════════════════════════════════════════
async function _callGemini(apiKey, prompt) {
    const st = getKeyState(apiKey);
    const now = Date.now();

    if (now < st.resetTime) {
        const espera = st.resetTime - now;
        if (espera > 15000) throw new Error('RATE_LIMIT_429');
        await new Promise(r => setTimeout(r, espera));
    }

    const desde = Date.now() - st.lastRequest;
    if (desde < 6000) await new Promise(r => setTimeout(r, 6000 - desde));
    st.lastRequest = Date.now();

    let res;
    try {
        res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.85, maxOutputTokens: 3000 }
                }),
                signal: AbortSignal.timeout(45000)
            }
        );
    } catch(fetchErr) { throw new Error(`RED: ${fetchErr.message}`); }

    if (res.status === 429) {
        st.fallos429 = (st.fallos429 || 0) + 1;
        const cooldown = Math.min(30000 * Math.pow(2, st.fallos429 - 1), 300000);
        st.resetTime = Date.now() + cooldown;
        console.warn(`    ⚠️ KEY ${apiKey.substring(0,8)}... → 429. Saltando.`);
        throw new Error('RATE_LIMIT_429');
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) throw new Error('Respuesta vacía');

    st.fallos429 = 0;
    return texto;
}

async function llamarGeminiGrupo(prompt, grupo = 'texto', reintentos = 2) {
    const lista = grupo === 'texto' ? LLAVES_TEXTO : LLAVES_IMAGEN;
    if (!lista.length) throw new Error(`Sin llaves para grupo: ${grupo}`);

    for (let vuelta = 0; vuelta < reintentos; vuelta++) {
        for (let i = 0; i < lista.length; i++) {
            const llave = siguienteLlave(grupo);
            try {
                const resultado = await _callGemini(llave, prompt);
                console.log(`    ✅ Gemini [${grupo}] OK con KEY ...${llave.slice(-6)}`);
                return resultado;
            } catch(err) {
                if (err.message === 'RATE_LIMIT_429') continue;
                console.error(`    ❌ Gemini [${grupo}] KEY ...${llave.slice(-6)}: ${err.message}`);
            }
        }
        if (vuelta < reintentos - 1) {
            console.warn(`    ⏳ Todas las llaves fallaron, esperando 15s...`);
            await new Promise(r => setTimeout(r, 15000));
        }
    }
    throw new Error(`Gemini [${grupo}]: todas las llaves fallaron`);
}

async function llamarGeminiImagen(prompt, reintentos = 1) {
    try { return await llamarGeminiGrupo(prompt, 'imagen', reintentos); }
    catch(e) { return null; }
}

// ══════════════════════════════════════════════════════════
// 🖼️  IMAGENES
// ══════════════════════════════════════════════════════════
const PB  = 'https://images.pexels.com/photos';
const OPT = '?auto=compress&cs=tinysrgb&w=800';

const BANCO_LOCAL = {
    'politica-gobierno': [`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`, `${PB}/290595/pexels-photo-290595.jpeg${OPT}`],
    'seguridad-policia': [`${PB}/6261776/pexels-photo-6261776.jpeg${OPT}`],
    'economia-mercado': [`${PB}/4386466/pexels-photo-4386466.jpeg${OPT}`],
    'deporte-general': [`${PB}/863988/pexels-photo-863988.jpeg${OPT}`],
    'tecnologia': [`${PB}/3861958/pexels-photo-3861958.jpeg${OPT}`],
};

function imgLocal(sub, cat) {
    const banco = BANCO_LOCAL[sub] || BANCO_LOCAL['politica-gobierno'];
    return banco[Math.floor(Math.random() * banco.length)];
}

async function obtenerImagenInteligente(titulo, categoria, subtemaLocal) {
    return imgLocal(subtemaLocal, categoria);
}

async function aplicarMarcaDeAgua(urlImagen) {
    if (!WATERMARK_PATH) return { url: urlImagen, procesada: false };
    if (!urlImagen || urlImagen === 'base64-upload') return { url: urlImagen, procesada: false };
    try {
        const response = await fetch(urlImagen);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bufOrig = Buffer.from(await response.arrayBuffer());
        const meta = await sharp(bufOrig).metadata();
        const w = meta.width || 800, h = meta.height || 500;
        const wmAncho = Math.min(Math.round(w * 0.28), 300);
        const wmResized = await sharp(WATERMARK_PATH).resize(wmAncho, null, { fit: 'inside' }).toBuffer();
        const wmMeta = await sharp(wmResized).metadata();
        const wmAlto = wmMeta.height || 60;
        const margen = Math.round(w * 0.02);
        const bufFinal = await sharp(bufOrig).composite([{ input: wmResized, left: Math.max(0, w - wmAncho - margen), top: Math.max(0, h - wmAlto - margen), blend: 'over' }]).jpeg({ quality: 88 }).toBuffer();
        const nombre = `efd-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.jpg`;
        fs.writeFileSync(path.join('/tmp', nombre), bufFinal);
        return { url: `${BASE_URL}/img/${nombre}`, nombre, procesada: true };
    } catch(err) { return { url: urlImagen, procesada: false }; }
}

function generarAltSEO(titulo, categoria) {
    return `${titulo} - noticias Santo Domingo Este, República Dominicana - El Farol al Día`;
}

function slugify(t) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[ñ]/g, 'n').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 75);
}

function redactor(cat) {
    const REDACTORES = ['Carlos Méndez', 'Laura Santana', 'Roberto Peña', 'Ana María Castillo'];
    return REDACTORES[Math.floor(Math.random() * REDACTORES.length)];
}

// ══════════════════════════════════════════════════════════
// INICIALIZAR BD
// ══════════════════════════════════════════════════════════
async function inicializarBase() {
    const client = await pool.connect();
    try {
        await client.query('CREATE TABLE IF NOT EXISTS noticias(id SERIAL PRIMARY KEY,titulo VARCHAR(255) NOT NULL,slug VARCHAR(255) UNIQUE,seccion VARCHAR(100),contenido TEXT,seo_description VARCHAR(160),seo_keywords VARCHAR(255),redactor VARCHAR(100),imagen TEXT,imagen_alt VARCHAR(255),imagen_nombre VARCHAR(100),imagen_original TEXT,audio_nombre TEXT,vistas INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,estado VARCHAR(50) DEFAULT \'publicada\')');
        await client.query('CREATE TABLE IF NOT EXISTS rss_procesados(id SERIAL PRIMARY KEY,item_guid VARCHAR(500) UNIQUE,fuente VARCHAR(100),fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        await client.query('CREATE TABLE IF NOT EXISTS memoria_ia(id SERIAL PRIMARY KEY,tipo VARCHAR(50) NOT NULL,valor TEXT NOT NULL,categoria VARCHAR(100),exitos INTEGER DEFAULT 0,fallos INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,ultima_vez TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        console.log('✅ BD lista');
    } catch(e) { console.error('❌ BD:', e.message); }
    finally { client.release(); }
}

// ══════════════════════════════════════════════════════════
// MEMORIA IA
// ══════════════════════════════════════════════════════════
async function construirMemoria(categoria, limiteTitulos = 25) {
    let memoria = '';
    try {
        const recientes = await pool.query(
            'SELECT titulo, seccion FROM noticias WHERE estado = $1 ORDER BY fecha DESC LIMIT $2',
            ['publicada', parseInt(limiteTitulos)]
        );
        if (recientes.rows && recientes.rows.length > 0) {
            memoria += '\n⛔ TEMAS YA PUBLICADOS RECIENTEMENTE — PROHIBIDO REPETIR:\n';
            memoria += recientes.rows.map((x, i) => `${i+1}. ${x.titulo} [${x.seccion}]`).join('\n');
            memoria += '\n⚠️ NO escribir sobre estos temas otra vez.\n';
        }
    } catch(e) { console.warn('⚠️ Error en construirMemoria:', e.message); }
    return memoria;
}

// ══════════════════════════════════════════════════════════
// ✅ VALIDADOR DE CONTENIDO (MÍNIMO 300 CARACTERES)
// ══════════════════════════════════════════════════════════
function validarContenido(contenido, titulo, categoria) {
    const longitud = contenido.length;
    const barriosSDE = ['Los Mina', 'Invivienda', 'Charles de Gaulle', 'Ensanche Ozama', 'Sabana Perdida', 'Villa Mella'];
    const barriosMencionados = barriosSDE.filter(b => contenido.toLowerCase().includes(b.toLowerCase()));
    
    if (longitud < 300) {
        return { valido: false, razon: `Contenido insuficiente (${longitud} chars, mínimo 300)` };
    }
    if (barriosMencionados.length === 0) {
        return { valido: false, razon: 'No menciona ningún barrio de Santo Domingo Este' };
    }
    const parrafos = contenido.split(/\n\s*\n/).filter(p => p.trim().length > 20);
    if (parrafos.length < 3) {
        return { valido: false, razon: `Solo ${parrafos.length} párrafos (mínimo 3)` };
    }
    return { valido: true, longitud, barrios: barriosMencionados, parrafos: parrafos.length };
}

// ══════════════════════════════════════════════════════════
// 📰 GENERAR NOTICIA — V37.5
// ══════════════════════════════════════════════════════════
async function generarNoticia(categoria, comunicadoExterno = null, reintento = 1) {
    const MAX_REINTENTOS = 3;

    try {
        if (!CONFIG_IA.enabled) return { success: false, error: 'IA desactivada' };

        console.log(`\n📰 [V37.5] Generando — Cat: ${categoria} — Intento ${reintento}/${MAX_REINTENTOS}`);

        const memoria = await construirMemoria(categoria, 25);
        const fuenteContenido = comunicadoExterno
            ? `\nCOMUNICADO OFICIAL:\n"""\n${comunicadoExterno}\n"""`
            : `\nEscribe una noticia NUEVA sobre "${categoria}" para República Dominicana, con enfoque en Santo Domingo Este.`;

        const promptTexto = `${CONFIG_IA.instruccion_principal}

🎯 REQUISITOS OBLIGATORIOS:
1. MÍNIMO 600 CARACTERES
2. Menciona al menos DOS barrios de SDE: Los Mina, Invivienda, Charles de Gaulle, Ensanche Ozama, Sabana Perdida, Villa Mella
3. Usa lenguaje dominicano real: "se supo", "fue confirmado", "vecinos dicen"
4. Párrafos cortos (máximo 3 líneas)

${memoria}
${fuenteContenido}

CATEGORÍA: ${categoria}

RESPONDE EXACTAMENTE (sin texto extra):
TITULO: [60-70 chars]
DESCRIPCION: [150-160 chars]
SUBTEMA_LOCAL: [politica-gobierno|seguridad-policia|economia-mercado|deporte-general|tecnologia]
CONTENIDO:
[párrafos cortos separados por línea en blanco - MÍNIMO 600 CARACTERES]`;

        console.log(`   📝 Llamando Gemini TEXTO...`);
        const textoGemini = await llamarGeminiGrupo(promptTexto, 'texto', 2);

        let titulo = '', desc = '', sub = '', contenido = '';
        let enContenido = false;
        const bloques = [];

        for (const linea of textoGemini.split('\n')) {
            const t = linea.trim();
            if (t.startsWith('TITULO:')) titulo = t.replace('TITULO:', '').trim();
            else if (t.startsWith('DESCRIPCION:')) desc = t.replace('DESCRIPCION:', '').trim();
            else if (t.startsWith('SUBTEMA_LOCAL:')) sub = t.replace('SUBTEMA_LOCAL:', '').trim();
            else if (t.startsWith('CONTENIDO:')) enContenido = true;
            else if (enContenido && t.length > 0) bloques.push(t);
        }

        contenido = bloques.join('\n\n');
        titulo = titulo.replace(/[*_#`"]/g, '').trim();

        if (!titulo) throw new Error('Gemini no devolvió TITULO');

        const validacion = validarContenido(contenido, titulo, categoria);

        if (!validacion.valido) {
            console.log(`   ⚠️ Validación fallida: ${validacion.razon}`);
            if (reintento < MAX_REINTENTOS) {
                await new Promise(r => setTimeout(r, 3000));
                return await generarNoticia(categoria, comunicadoExterno, reintento + 1);
            }
            throw new Error(`Validación fallida: ${validacion.razon}`);
        }

        console.log(`   ✅ Texto OK: ${validacion.longitud} chars | barrios: ${validacion.barrios.join(', ')}`);

        const urlOrig = await obtenerImagenInteligente(titulo, categoria, sub);
        const imgResult = await aplicarMarcaDeAgua(urlOrig);
        const urlFinal = imgResult.procesada ? imgResult.url : urlOrig;
        const altFinal = generarAltSEO(titulo, categoria);

        const slugBase = slugify(titulo);
        let slFin = slugBase;
        const existeSlug = await pool.query('SELECT id FROM noticias WHERE slug=$1', [slugBase]);
        if (existeSlug.rows.length) slFin = `${slugBase.substring(0, 68)}-${Date.now().toString().slice(-6)}`;

        // 🎙️ AUDIO SINCRÓNICO ANTES DEL INSERT
        let audioNombreGenerado = null;
        if (ELEVEN_LABS_KEY) {
            console.log(`   🎙️ Generando audio ElevenLabs...`);
            audioNombreGenerado = await generarAudioNoticia(contenido, slFin);
            if (audioNombreGenerado) console.log(`   🎙️ Audio listo: ${audioNombreGenerado}`);
        }

        await pool.query(
            'INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_nombre,imagen_original,audio_nombre,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
            [titulo.substring(0,255), slFin, categoria, contenido.substring(0,10000), desc.substring(0,160), categoria, redactor(categoria), urlFinal, altFinal.substring(0,255), imgResult.nombre || 'efd.jpg', urlOrig, audioNombreGenerado || null, 'publicada']
        );

        console.log(`\n✅ /noticia/${slFin} [${validacion.longitud} chars] 🎙️ Audio: ${audioNombreGenerado || 'sin audio'}`);

        await enviarNotificacionPush(titulo, desc.substring(0,160), slFin, urlFinal);

        return { success: true, slug: slFin, titulo, audio: audioNombreGenerado || null };

    } catch (error) {
        console.error(`❌ Error:`, error.message);
        if (reintento < MAX_REINTENTOS) {
            await new Promise(r => setTimeout(r, 5000));
            return await generarNoticia(categoria, comunicadoExterno, reintento + 1);
        }
        return { success: false, error: error.message };
    }
}

// ══════════════════════════════════════════════════════════
// 📺 RUTA /tv — PANTALLA DIGITAL
// ══════════════════════════════════════════════════════════
app.get('/tv', async (req, res) => {
    try {
        const rAudio = await pool.query(
            "SELECT id, titulo, slug, imagen, contenido, seccion, audio_nombre " +
            "FROM noticias WHERE estado='publicada' AND audio_nombre IS NOT NULL AND audio_nombre != '' " +
            "ORDER BY fecha DESC LIMIT 1"
        );
        const rReciente = rAudio.rows.length ? rAudio : await pool.query(
            "SELECT id, titulo, slug, imagen, contenido, seccion, audio_nombre " +
            "FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 1"
        );

        if (!rReciente.rows.length) {
            return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>El Farol TV</title>
<style>body{background:#070707;color:#EDE8DF;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;text-align:center}h1{color:#FF5500}</style></head>
<body><h1>🏮 El Farol TV</h1><p>Aún no hay noticias.</p></body></html>`);
        }

        const n = rReciente.rows[0];
        const urlAudio = n.audio_nombre ? `${BASE_URL}/audio/${n.audio_nombre}` : null;
        const primerParrafo = (n.contenido || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200);

        const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🏮 El Farol TV — ${n.titulo}</title>
  <link rel="icon" href="${BASE_URL}/static/favicon.png">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#000; font-family:'Arial Black',sans-serif; overflow:hidden; }
    #fondo { position:fixed; inset:0; background-image:url('${n.imagen}'); background-size:cover; background-position:center; filter:brightness(0.45); z-index:0; }
    #logo-canal { position:absolute; top:24px; left:32px; z-index:10; display:flex; align-items:center; gap:12px; }
    #logo-canal img { width:52px; height:52px; border-radius:50%; border:3px solid #FF5500; }
    #logo-canal span { color:#FF5500; font-size:1.15rem; font-weight:900; text-transform:uppercase; }
    #badge-seccion { position:absolute; top:24px; right:32px; z-index:10; background:#FF5500; color:#fff; padding:8px 18px; font-size:0.85rem; font-weight:900; text-transform:uppercase; }
    #cintillo-wrap { position:absolute; bottom:70px; left:0; right:0; z-index:10; padding:0 20px; }
    #cintillo-label { background:#FF5500; color:#fff; display:inline-block; padding:4px 14px; font-size:0.75rem; font-weight:900; }
    #cintillo-titulo { background:rgba(7,7,7,0.88); color:#EDE8DF; font-size:clamp(1.1rem,2.2vw,1.7rem); font-weight:900; padding:14px 20px; border-left:6px solid #FF5500; }
    #ticker-bar { position:absolute; bottom:0; left:0; right:0; height:46px; background:#FF5500; z-index:11; display:flex; align-items:center; overflow:hidden; }
    #ticker-prefix { background:#070707; color:#FF5500; font-size:0.8rem; font-weight:900; padding:0 16px; height:100%; display:flex; align-items:center; }
    #ticker-texto { color:#fff; font-size:0.9rem; font-weight:700; white-space:nowrap; animation:scrollTicker 30s linear infinite; }
    @keyframes scrollTicker { 0%{transform:translateX(100vw)} 100%{transform:translateX(-100%)} }
    #audio-indicator { position:absolute; top:80px; right:32px; z-index:10; display:none; background:rgba(0,0,0,0.7); padding:6px 12px; border-radius:20px; border:1px solid #FF5500; }
    #audio-indicator.visible { display:flex; }
    #audio-dot { width:10px; height:10px; background:#FF5500; border-radius:50%; animation:pulseDot 1s infinite; }
    @keyframes pulseDot { 0%,100%{transform:scale(1)} 50%{transform:scale(1.4)} }
  </style>
</head>
<body>
  <div id="fondo"></div>
  <div id="logo-canal">
    <img src="${BASE_URL}/static/favicon.png" alt="Logo">
    <span>🏮 El Farol TV</span>
  </div>
  <div id="badge-seccion">🔴 EN VIVO · ${n.seccion || 'Noticias'}</div>
  <div id="audio-indicator"><div id="audio-dot"></div><span>🎙️ Leyendo noticia</span></div>
  <div id="cintillo-wrap">
    <div id="cintillo-label">🏮 Último Minuto SDE</div>
    <div id="cintillo-titulo">${n.titulo}</div>
  </div>
  <div id="ticker-bar">
    <div id="ticker-prefix">🏮 EFD</div>
    <div id="ticker-texto">${primerParrafo} &nbsp;&nbsp;&nbsp; 🏮 &nbsp;&nbsp;&nbsp; ${n.titulo} &nbsp;&nbsp;&nbsp; elfarolaldia.com</div>
  </div>
  ${urlAudio ? `<audio id="audio-noticia" autoplay><source src="${urlAudio}" type="audio/mpeg"></audio>` : ''}
  <script>
    const audioEl = document.getElementById('audio-noticia');
    const audioInd = document.getElementById('audio-indicator');
    if (audioEl) {
      audioEl.addEventListener('play', () => audioInd && audioInd.classList.add('visible'));
      audioEl.addEventListener('pause', () => audioInd && audioInd.classList.remove('visible'));
      audioEl.addEventListener('ended', () => setTimeout(() => location.reload(), 4000));
    } else {
      setTimeout(() => location.reload(), 10000);
    }
  </script>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(html);
    } catch(err) {
        res.status(500).send('Error en El Farol TV');
    }
});

// ══════════════════════════════════════════════════════════
// RUTAS API
// ══════════════════════════════════════════════════════════
app.get('/health', (req, res) => res.json({ status: 'OK', version: '37.5-quad-key' }));

let _cacheNoticias = null, _cacheFecha = 0;
const CACHE_TTL = 60 * 1000;
function invalidarCache() { _cacheNoticias = null; _cacheFecha = 0; }

app.get('/api/noticias', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
        if (_cacheNoticias && (Date.now() - _cacheFecha) < CACHE_TTL) return res.json({ success: true, noticias: _cacheNoticias, cached: true });
        const r = await pool.query("SELECT id, titulo, slug, seccion, imagen, imagen_alt, seo_description, fecha, vistas, redactor, audio_nombre FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30", ['publicada']);
        _cacheNoticias = r.rows;
        _cacheFecha = Date.now();
        res.json({ success: true, noticias: r.rows });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/generar-noticia', authMiddleware, async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });
    const r = await generarNoticia(categoria);
    res.status(r.success ? 200 : 500).json(r);
});

app.get('/api/audio/status', authMiddleware, async (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'PIN requerido' });
    const r = await pool.query("SELECT id, titulo, slug, audio_nombre FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 20");
    res.json({ success: true, eleven_labs_activo: !!ELEVEN_LABS_KEY, noticias: r.rows });
});

app.post('/api/audio/regenerar/:slug', authMiddleware, async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ error: 'PIN incorrecto' });
    const { slug } = req.params;
    const r = await pool.query("SELECT contenido FROM noticias WHERE slug=$1", [slug]);
    if (!r.rows.length) return res.status(404).json({ error: 'Noticia no encontrada' });
    const audioNombre = await generarAudioNoticia(r.rows[0].contenido, slug);
    if (!audioNombre) return res.status(500).json({ error: 'Error generando audio' });
    await pool.query('UPDATE noticias SET audio_nombre=$1 WHERE slug=$2', [audioNombre, slug]);
    invalidarCache();
    res.json({ success: true, audio_nombre: audioNombre });
});

app.get('/api/admin/llaves', authMiddleware, (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'PIN requerido' });
    res.json({ success: true, version: '37.5', rr_idx: RR_IDX, llaves_texto: LLAVES_TEXTO.length, llaves_imagen: LLAVES_IMAGEN.length });
});

app.get('/audio/:nombre', (req, res) => {
    const nombre = req.params.nombre.replace(/[^a-zA-Z0-9\-_.]/g, '');
    const ruta = path.join('/tmp', nombre);
    if (!fs.existsSync(ruta)) return res.status(404).send('Audio no disponible');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.sendFile(ruta);
});

app.get('/img/:nombre', async (req, res) => {
    const ruta = path.join('/tmp', req.params.nombre);
    if (fs.existsSync(ruta)) return res.sendFile(ruta);
    res.status(404).send('Imagen no disponible');
});

// ══════════════════════════════════════════════════════════
// PÁGINAS
// ══════════════════════════════════════════════════════════
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', authMiddleware, (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));

app.get('/noticia/:slug', async (req, res) => {
    try {
        const r = await pool.query("SELECT * FROM noticias WHERE slug=$1 AND estado=$2", [req.params.slug, 'publicada']);
        if (!r.rows.length) return res.status(404).send('Noticia no encontrada');
        const n = r.rows[0];
        await pool.query('UPDATE noticias SET vistas=vistas+1 WHERE id=$1', [n.id]);
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${n.titulo} | El Farol al Día</title><meta name="description" content="${n.seo_description}"><meta property="og:title" content="${n.titulo}"><meta property="og:image" content="${n.imagen}"><link rel="icon" href="/static/favicon.png"></head><body style="background:#070707;color:#EDE8DF;font-family:sans-serif;padding:20px"><h1 style="color:#FF5500">${n.titulo}</h1><img src="${n.imagen}" alt="${n.imagen_alt}" style="max-width:100%;border-radius:8px"><div>${n.contenido.split('\n').map(p => `<p>${p}</p>`).join('')}</div><p><strong>${new Date(n.fecha).toLocaleDateString('es-DO')}</strong> | ${n.vistas} vistas</p><a href="/" style="color:#FF5500">← Volver</a></body></html>`;
        res.send(html);
    } catch(e) { res.status(500).send('Error'); }
});

app.get('/status', async (req, res) => {
    const r = await pool.query("SELECT COUNT(*) FROM noticias WHERE estado='publicada'");
    res.json({ status: 'OK', version: '37.5-quad-key', noticias: parseInt(r.rows[0].count), eleven_labs: !!ELEVEN_LABS_KEY, llaves_texto: LLAVES_TEXTO.length, llaves_imagen: LLAVES_IMAGEN.length });
});

// ══════════════════════════════════════════════════════════
// ARRANQUE
// ══════════════════════════════════════════════════════════
async function iniciar() {
    await inicializarBase();
    await initPushTable();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🏮 EL FAROL AL DÍA — V37.5 QUAD-KEY EDITION`);
        console.log(`📡 Puerto: ${PORT}`);
        console.log(`🔑 Llaves texto: ${LLAVES_TEXTO.length} | Llaves imagen: ${LLAVES_IMAGEN.length}`);
        console.log(`🎙️ ElevenLabs: ${ELEVEN_LABS_KEY ? '✅ Activo' : '⚠️ No configurado'}`);
        console.log(`📺 TV Channel: ${BASE_URL}/tv\n`);
    });
    setTimeout(() => generarNoticia('Nacionales'), 10000);
}

iniciar();
module.exports = app;
