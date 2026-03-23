/**
 * 🏮 EL FAROL AL DÍA — V34.51
 * Stack: Node.js · Express · PostgreSQL · Railway · Sharp · Gemini 2.5 Flash
 * SIN: Pexels · Pixabay · Wikimedia · Facebook · Twitter · Telegram
 */

'use strict';

const BROWSER_HEADERS = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept':          'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'es-DO,es;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control':   'no-cache',
    'Pragma':          'no-cache',
    'Referer':         'https://www.google.com/',
    'sec-fetch-dest':  'image',
    'sec-fetch-mode':  'no-cors',
    'sec-fetch-site':  'cross-site',
};

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const cron      = require('node-cron');
const { Pool }  = require('pg');
const sharp     = require('sharp');
const RSSParser = require('rss-parser');
const crypto    = require('crypto');

function authMiddleware(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Dia - Redaccion"');
        return res.status(401).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Acceso Restringido</title><style>body{background:#070707;color:#EDE8DF;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.box{background:#141418;border:1px solid #FF5500;border-radius:12px;padding:40px;text-align:center;max-width:380px}h2{color:#FF5500;font-size:22px;margin-bottom:10px}p{color:#A89F94;font-size:14px;margin-bottom:20px}a{display:inline-block;background:#FF5500;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold}</style></head><body><div class="box"><h2>ACCESO RESTRINGIDO</h2><p>Usuario: <strong>director</strong><br>Contrasena: <strong>311</strong></p><a href="/redaccion">ENTRAR</a></div></body></html>`);
    }
    try {
        const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
        const [user, ...pp] = decoded.split(':');
        if (user === 'director' && pp.join(':') === '311') return next();
    } catch (_) {}
    res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Dia - Redaccion"');
    return res.status(401).send('Credenciales incorrectas.');
}

const app      = express();
const PORT     = process.env.PORT || 8080;
const BASE_URL = (process.env.BASE_URL || 'https://elfarolaldia.com').replace(/\/$/, '');

if (!process.env.DATABASE_URL)   { console.error('[FATAL] DATABASE_URL requerido');   process.exit(1); }
if (!process.env.GOOGLE_CSE_KEY) console.warn('[IMG] GOOGLE_CSE_KEY no configurada');

const GEMINI_KEYS = [
    process.env.GEMINI_API_KEY  || null,
    process.env.GEMINI_API_KEY2 || null,
    process.env.GEMINI_API_KEY3 || null,
    process.env.GEMINI_API_KEY4 || null,
    process.env.GEMINI_API_KEY5 || null,
].filter(Boolean);

if (!GEMINI_KEYS.length) { console.error('[FATAL] Se necesita al menos una GEMINI_API_KEY'); process.exit(1); }
console.log(`[Gemini] ${GEMINI_KEYS.length} key(s) disponibles`);

let   GEMINI_KEY_INDEX = 0;
const GEMINI_KEY_RESET = {};
const GEMINI_DESCANSO  = 60000;

GEMINI_KEYS.forEach((k, i) => console.log(`   Key ${i+1}: ...${k.slice(-6)}`));

function getGeminiKey() {
    const ahora = Date.now();
    for (let i = 0; i < GEMINI_KEYS.length; i++) {
        const idx   = (GEMINI_KEY_INDEX + i) % GEMINI_KEYS.length;
        const libre = GEMINI_KEY_RESET[idx] || 0;
        if (ahora >= libre) {
            GEMINI_KEY_INDEX = (idx + 1) % GEMINI_KEYS.length;
            return { key: GEMINI_KEYS[idx], idx };
        }
    }
    let menorEspera = Infinity, menorIdx = 0;
    for (let i = 0; i < GEMINI_KEYS.length; i++) {
        const espera = (GEMINI_KEY_RESET[i] || 0) - ahora;
        if (espera < menorEspera) { menorEspera = espera; menorIdx = i; }
    }
    return { key: GEMINI_KEYS[menorIdx], idx: menorIdx, espera: menorEspera };
}

function marcarKeyDescansando(idx) {
    GEMINI_KEY_RESET[idx] = Date.now() + GEMINI_DESCANSO;
    console.log(`   [Gemini] Key ${idx+1} descansando 60s`);
}

const WATERMARK_CANDIDATES = ['WATERMARK(1).png','watermark(1).png','WATERMARK (1).png','watermark (1).png','WATERMARK(2).png','watermark (2).png','WATERMARK.png','watermark.png'];
const WATERMARK_PATH = (() => {
    for (const name of WATERMARK_CANDIDATES) {
        const full = path.join(__dirname, 'static', name);
        if (fs.existsSync(full)) { console.log('[Watermark] Encontrado: static/' + name); return full; }
    }
    console.warn('[Watermark] No encontrado — publicando sin marca.');
    return null;
})();

const pool      = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
const rssParser = new RSSParser({ timeout: 10000 });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/static', express.static(path.join(__dirname, 'static'), { setHeaders: (res) => res.setHeader('Cache-Control','public,max-age=2592000,immutable') }));
app.use(express.static(path.join(__dirname, 'client'), { setHeaders: (res, fp) => { if (/\.(jpg|jpeg|png|gif|webp|ico|svg)$/i.test(fp)) res.setHeader('Cache-Control','public,max-age=2592000,immutable'); else if (/\.(css|js)$/i.test(fp)) res.setHeader('Cache-Control','public,max-age=86400'); } }));
app.use(cors({ origin:'*', methods:['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders:['Content-Type','Authorization','X-Requested-With'] }));
app.options('*', cors());

const WIKI_TERMINOS_RD = {
    'los mina':'Los Mina Santo Domingo','invivienda':'Instituto Nacional de la Vivienda Republica Dominicana',
    'ensanche ozama':'Ensanche Ozama Santo Domingo Este','santo domingo este':'Santo Domingo Este',
    'policia nacional':'Policia Nacional Republica Dominicana','presidencia':'Presidencia de la Republica Dominicana',
    'banco central':'Banco Central de la Republica Dominicana','beisbol':'Beisbol en Republica Dominicana',
    'turismo':'Turismo en Republica Dominicana','economia':'Economia de Republica Dominicana',
    'haiti':'Relaciones entre Republica Dominicana y Haiti',
};

async function buscarContextoWikipedia(titulo, categoria) {
    try {
        const tl = titulo.toLowerCase();
        let termino = null;
        for (const [k,v] of Object.entries(WIKI_TERMINOS_RD)) { if (tl.includes(k)) { termino = v; break; } }
        if (!termino) { const map = { Nacionales:`${titulo} Republica Dominicana`, Deportes:`${titulo} deporte dominicano`, Internacionales:`${titulo} America Latina`, Economia:`${titulo} economia dominicana`, Tecnologia:titulo, Espectaculos:`${titulo} cultura dominicana` }; termino = map[categoria] || `${titulo} Republica Dominicana`; }
        const ctrl1 = new AbortController(); const t1 = setTimeout(()=>ctrl1.abort(),5000);
        const r1 = await fetch(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(termino)}&format=json&srlimit=1&origin=*`,{signal:ctrl1.signal}).finally(()=>clearTimeout(t1));
        if (!r1.ok) return '';
        const d1 = await r1.json(); const pid = d1?.query?.search?.[0]?.pageid; if (!pid) return '';
        const ctrl2 = new AbortController(); const t2 = setTimeout(()=>ctrl2.abort(),5000);
        const r2 = await fetch(`https://es.wikipedia.org/w/api.php?action=query&pageids=${pid}&prop=extracts&exintro=true&exchars=800&format=json&origin=*`,{signal:ctrl2.signal}).finally(()=>clearTimeout(t2));
        if (!r2.ok) return '';
        const d2 = await r2.json(); const ext = d2?.query?.pages?.[pid]?.extract; if (!ext) return '';
        const txt = ext.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().substring(0,600);
        console.log(`   [Wiki] OK (${txt.length} chars)`);
        return `\nCONTEXTO REFERENCIA (no copiar):\n${txt}\n`;
    } catch (_) { return ''; }
}

async function aplicarMarcaDeAgua(urlImagen) {
    if (!WATERMARK_PATH) return { url: urlImagen, procesada: false };
    let response, lastErr;
    for (let intento = 0; intento < 3; intento++) {
        try {
            let urlDescarga = urlImagen;
            if (urlImagen.includes('diariolibre.com') || urlImagen.includes('listindiario.com')) {
                urlDescarga = urlImagen.replace(/-\d+x\d+(\.\w+)$/,'$1').replace(/[?&](w|width|size)=\d+/g,'').replace(/[?&](h|height)=\d+/g,'').replace('thumbnail','full').replace('-thumb','').replace('-small','').replace('-medium','-large');
            }
            const ctrl = new AbortController(); const tm = setTimeout(()=>ctrl.abort(),15000);
            response = await fetch(urlDescarga,{headers:{...BROWSER_HEADERS,'Cache-Control':'no-cache'},signal:ctrl.signal}).finally(()=>clearTimeout(tm));
            if (!response.ok && urlDescarga !== urlImagen) response = await fetch(urlImagen,{headers:BROWSER_HEADERS}).catch(()=>null);
            if (response.ok) break;
            lastErr = 'HTTP '+response.status;
        } catch(e) { lastErr = e.message; await new Promise(r=>setTimeout(r,1500*(intento+1))); }
    }
    try {
        if (!response?.ok) throw new Error(lastErr||'Sin respuesta');
        const bufOrig = Buffer.from(await response.arrayBuffer());
        const metaOrig = await sharp(bufOrig).metadata();
        const anchoOrig = metaOrig.width||0;
        console.log(`   [IMG-SIZE] Original: ${anchoOrig}x${metaOrig.height||0}px`);
        let bufEscalado;
        if (anchoOrig >= 900) { bufEscalado = await sharp(bufOrig).resize(1200,630,{fit:'cover',position:'attention',withoutEnlargement:true,kernel:'lanczos2'}).modulate({saturation:1.08}).sharpen({sigma:0.6}).toBuffer(); }
        else if (anchoOrig >= 500) { bufEscalado = await sharp(bufOrig).resize(900,null,{fit:'inside',withoutEnlargement:true,kernel:'lanczos3'}).modulate({saturation:1.1}).sharpen({sigma:0.8}).toBuffer(); }
        else { bufEscalado = await sharp(bufOrig).modulate({saturation:1.1,brightness:1.02}).sharpen({sigma:0.5}).toBuffer(); }
        const meta = await sharp(bufEscalado).metadata(); const w=meta.width||800; const h=meta.height||500;
        let wmPct; if (w>=1000) wmPct=0.20; else if (w>=600) wmPct=0.25; else wmPct=0.30;
        const wmAncho = Math.round(w*wmPct);
        const wmRes = await sharp(WATERMARK_PATH).resize(wmAncho,null,{fit:'inside'}).toBuffer();
        const wmMeta = await sharp(wmRes).metadata(); const wmAlto = wmMeta.height||40;
        const margen = Math.max(8,Math.round(w*0.02));
        const bufFin = await sharp(bufEscalado).composite([{input:wmRes,left:Math.max(0,w-wmAncho-margen),top:Math.max(0,h-wmAlto-margen),blend:'over'}]).jpeg({quality:92,progressive:true,mozjpeg:true}).toBuffer();
        const nombre = `efd-${Date.now()}-${Math.random().toString(36).substring(2,8)}.jpg`;
        fs.writeFileSync(path.join('/tmp',nombre),bufFin);
        console.log('   [WM] '+nombre);
        return { url:urlImagen, nombre, procesada:true };
    } catch(err) { console.warn('[WM] Error: '+err.message); SALUD.erroresImagen++; return { url:urlImagen, procesada:false }; }
}

app.get('/img/:nombre',(req,res)=>{
    const ruta = path.join('/tmp',path.basename(req.params.nombre));
    if (fs.existsSync(ruta)) { res.setHeader('Content-Type','image/jpeg'); res.setHeader('Cache-Control','public,max-age=604800,immutable'); return res.sendFile(ruta); }
    res.status(404).send('No disponible');
});

const CONFIG_IA_DEFAULT = { enabled:true, instruccion_principal:'Periodista elite de El Farol al Dia. Cobertura RD completa, Caribe y mundo. SEO maximo, piramide invertida estricta, datos verificables, impacto ciudadano real.', tono:'profesional-urgente', extension:'completa', enfasis:'Nacional: prioriza SDE, Los Mina, Invivienda, Ensanche Ozama. Internacional: conecta con impacto en RD y Caribe.', evitar:'Relleno sin valor. Citas inventadas. Titulares vagos. Repetir noticias ya publicadas.' };
let CONFIG_IA = { ...CONFIG_IA_DEFAULT };

async function cargarConfigIA() {
    try { const r = await pool.query("SELECT valor FROM memoria_ia WHERE tipo='config_ia' ORDER BY ultima_vez DESC LIMIT 1"); if (r.rows.length) { CONFIG_IA = {...CONFIG_IA_DEFAULT,...JSON.parse(r.rows[0].valor)}; console.log('[IA] Config desde BD'); } else console.log('[IA] Config defecto'); } catch (_) { CONFIG_IA = {...CONFIG_IA_DEFAULT}; }
}
async function guardarConfigIA(cfg) {
    try { const v=JSON.stringify(cfg); await pool.query("INSERT INTO memoria_ia(tipo,valor,categoria,exitos,fallos) VALUES('config_ia',$1,'sistema',1,0) ON CONFLICT DO NOTHING",[v]); await pool.query("UPDATE memoria_ia SET valor=$1,ultima_vez=NOW() WHERE tipo='config_ia' AND categoria='sistema'",[v]); return true; } catch (_) { return false; }
}

const GEMINI_MODEL   = 'gemini-2.5-flash';
const GEMINI_TIMEOUT = 90000;
const GS = { lastRequest:0, resetTime:0 };

async function llamarGemini(prompt, reintentos=3) {
    for (let i=0; i<reintentos; i++) {
        let tm;
        try {
            const { key, idx, espera:esperaCooldown } = getGeminiKey();
            if (esperaCooldown>0) { console.log(`   [Gemini] Key ${idx+1} cooldown ${Math.round(esperaCooldown/1000)}s`); await new Promise(r=>setTimeout(r,Math.min(esperaCooldown,20000))); }
            console.log(`   [Gemini] intento ${i+1}/${reintentos} (key ${idx+1})`);
            const lag = Date.now()-GS.lastRequest; if (lag<15000) await new Promise(r=>setTimeout(r,15000-lag));
            GS.lastRequest = Date.now();
            const ctrl = new AbortController(); tm = setTimeout(()=>ctrl.abort(),GEMINI_TIMEOUT);
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,{method:'POST',headers:{'Content-Type':'application/json'},signal:ctrl.signal,body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.8,maxOutputTokens:4000}})}).finally(()=>clearTimeout(tm));
            if (res.status===429) { const espera=Math.pow(2,i)*20000; const {idx:idxA}=getGeminiKey(); GEMINI_KEY_RESET[idxA]=Date.now()+espera; GEMINI_KEY_INDEX=(idxA+1)%GEMINI_KEYS.length; console.warn(`   [Gemini] 429 key ${idxA+1}`); await new Promise(r=>setTimeout(r,3000)); continue; }
            if (res.status===503||res.status===502) { await new Promise(r=>setTimeout(r,Math.pow(2,i)*4000)); continue; }
            if (!res.ok) throw new Error('HTTP '+res.status);
            const data = await res.json(); const texto = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!texto) throw new Error('Respuesta vacia');
            console.log(`   [Gemini] OK (${texto.length} chars) Key ${idx+1}`);
            marcarKeyDescansando(idx); return texto;
        } catch(err) {
            if (tm) clearTimeout(tm);
            const isTimeout = err.name==='AbortError';
            if (isTimeout) SALUD.timeoutsGemini++;
            console.error(`   [Gemini] ERROR ${i+1}: ${isTimeout?'TIMEOUT':err.message}`);
            if (i<reintentos-1) await new Promise(r=>setTimeout(r,Math.pow(2,i)*3000));
        }
    }
    throw new Error(`Gemini no respondio tras ${reintentos} intentos`);
}

const PB='https://images.pexels.com/photos';
const BANCO_LOCAL = {
    'politica-gobierno':[`${PB}/1550337/pexels-photo-1550337.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3182812/pexels-photo-3182812.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3183197/pexels-photo-3183197.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3184418/pexels-photo-3184418.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/2182970/pexels-photo-2182970.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1464217/pexels-photo-1464217.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3183150/pexels-photo-3183150.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3184339/pexels-photo-3184339.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/8849295/pexels-photo-8849295.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/4427611/pexels-photo-4427611.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'seguridad-policia':[`${PB}/6049159/pexels-photo-6049159.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/5699456/pexels-photo-5699456.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/6289059/pexels-photo-6289059.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/7512968/pexels-photo-7512968.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/4252382/pexels-photo-4252382.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3807517/pexels-photo-3807517.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/6980997/pexels-photo-6980997.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/5726825/pexels-photo-5726825.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'relaciones-internacionales':[`${PB}/2860705/pexels-photo-2860705.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3997992/pexels-photo-3997992.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3183197/pexels-photo-3183197.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1550337/pexels-photo-1550337.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3407777/pexels-photo-3407777.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3182812/pexels-photo-3182812.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/7948035/pexels-photo-7948035.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3184292/pexels-photo-3184292.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'economia-mercado':[`${PB}/4386466/pexels-photo-4386466.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/6801648/pexels-photo-6801648.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/210607/pexels-photo-210607.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3943723/pexels-photo-3943723.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/7567443/pexels-photo-7567443.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/6120214/pexels-photo-6120214.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/5849559/pexels-photo-5849559.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3760067/pexels-photo-3760067.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1797428/pexels-photo-1797428.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/4386442/pexels-photo-4386442.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'infraestructura':[`${PB}/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/323780/pexels-photo-323780.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/2219024/pexels-photo-2219024.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1463917/pexels-photo-1463917.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/2760241/pexels-photo-2760241.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1134166/pexels-photo-1134166.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/247763/pexels-photo-247763.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/159306/pexels-photo-159306.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'salud-medicina':[`${PB}/3786157/pexels-photo-3786157.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/4386467/pexels-photo-4386467.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1170979/pexels-photo-1170979.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/5327580/pexels-photo-5327580.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3993212/pexels-photo-3993212.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/4021775/pexels-photo-4021775.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/5214958/pexels-photo-5214958.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/4226219/pexels-photo-4226219.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'deporte-beisbol':[`${PB}/1661950/pexels-photo-1661950.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/209977/pexels-photo-209977.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/248318/pexels-photo-248318.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1884574/pexels-photo-1884574.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/163452/pexels-photo-163452.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1618200/pexels-photo-1618200.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/186077/pexels-photo-186077.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1752757/pexels-photo-1752757.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'deporte-futbol':[`${PB}/46798/pexels-photo-46798.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3621943/pexels-photo-3621943.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/274422/pexels-photo-274422.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1171084/pexels-photo-1171084.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3873098/pexels-photo-3873098.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/114296/pexels-photo-114296.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/2277981/pexels-photo-2277981.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1884574/pexels-photo-1884574.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'deporte-general':[`${PB}/863988/pexels-photo-863988.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/936094/pexels-photo-936094.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/2526878/pexels-photo-2526878.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3764014/pexels-photo-3764014.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1552252/pexels-photo-1552252.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/2294353/pexels-photo-2294353.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/4761671/pexels-photo-4761671.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3621517/pexels-photo-3621517.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'tecnologia':[`${PB}/3861958/pexels-photo-3861958.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/2582937/pexels-photo-2582937.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/5632399/pexels-photo-5632399.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3932499/pexels-photo-3932499.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/574071/pexels-photo-574071.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3861969/pexels-photo-3861969.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1181244/pexels-photo-1181244.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/7988086/pexels-photo-7988086.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'educacion':[`${PB}/256490/pexels-photo-256490.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1205651/pexels-photo-1205651.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/4143791/pexels-photo-4143791.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/5905559/pexels-photo-5905559.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3769021/pexels-photo-3769021.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/4491461/pexels-photo-4491461.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/289737/pexels-photo-289737.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/8617816/pexels-photo-8617816.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'cultura-musica':[`${PB}/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3651308/pexels-photo-3651308.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/2521317/pexels-photo-2521317.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1047442/pexels-photo-1047442.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/995301/pexels-photo-995301.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/2191013/pexels-photo-2191013.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1769280/pexels-photo-1769280.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'medio-ambiente':[`${PB}/1108572/pexels-photo-1108572.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/2559941/pexels-photo-2559941.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/414612/pexels-photo-414612.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1666012/pexels-photo-1666012.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1366919/pexels-photo-1366919.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/572897/pexels-photo-572897.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1021142/pexels-photo-1021142.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3225517/pexels-photo-3225517.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'turismo':[`${PB}/1450353/pexels-photo-1450353.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1174732/pexels-photo-1174732.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3601425/pexels-photo-3601425.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/2104152/pexels-photo-2104152.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/994605/pexels-photo-994605.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1268855/pexels-photo-1268855.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3155666/pexels-photo-3155666.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1450360/pexels-photo-1450360.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'emergencia':[`${PB}/1437862/pexels-photo-1437862.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/263402/pexels-photo-263402.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/6129049/pexels-photo-6129049.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/7541956/pexels-photo-7541956.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3259629/pexels-photo-3259629.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/6129113/pexels-photo-6129113.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/4386396/pexels-photo-4386396.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/5726825/pexels-photo-5726825.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'vivienda-social':[`${PB}/323780/pexels-photo-323780.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1396122/pexels-photo-1396122.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/2102587/pexels-photo-2102587.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1370704/pexels-photo-1370704.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/259588/pexels-photo-259588.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1029599/pexels-photo-1029599.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/280229/pexels-photo-280229.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/534151/pexels-photo-534151.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
    'transporte-vial':[`${PB}/93398/pexels-photo-93398.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1494277/pexels-photo-1494277.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/210182/pexels-photo-210182.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/2199293/pexels-photo-2199293.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3806978/pexels-photo-3806978.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/163786/pexels-photo-163786.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/3802510/pexels-photo-3802510.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,`${PB}/1004409/pexels-photo-1004409.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`],
};

const FALLBACK_CAT = { Nacionales:'politica-gobierno', Deportes:'deporte-general', Internacionales:'relaciones-internacionales', Economia:'economia-mercado', Tecnologia:'tecnologia', Espectaculos:'cultura-musica' };
const fotosUsadasReciente = new Set();
setInterval(()=>fotosUsadasReciente.clear(), 6*60*60*1000);

function imgLocal(sub, cat) {
    const b = BANCO_LOCAL[sub]||BANCO_LOCAL[FALLBACK_CAT[cat]]||BANCO_LOCAL['politica-gobierno'];
    const disponibles = b.filter(url=>!fotosUsadasReciente.has(url));
    const lista = disponibles.length ? disponibles : b;
    const url = lista[Math.floor(Math.random()*lista.length)];
    fotosUsadasReciente.add(url); return url;
}

async function buscarEnGoogle(titulo, categoria) {
    const KEY = process.env.GOOGLE_CSE_KEY||null; const ID = process.env.GOOGLE_CSE_ID||null;
    if (KEY&&ID) {
        try {
            const q=`${titulo} press photo news`;
            const url=`https://www.googleapis.com/customsearch/v1?key=${KEY}&cx=${ID}&q=${encodeURIComponent(q)}&searchType=image&imgSize=large&imgType=photo&safe=active&num=5&fileType=jpg`;
            const ctrl=new AbortController(); const tm=setTimeout(()=>ctrl.abort(),8000);
            const res=await fetch(url,{signal:ctrl.signal}).finally(()=>clearTimeout(tm));
            if (res.ok) { const data=await res.json(); const bloq=['logo','icon','cartoon','illustration','vector','clipart']; for (const item of (data.items||[])) { const src=item.link||''; const t=(item.title||'').toLowerCase(); if (bloq.some(b=>t.includes(b)||src.includes(b))) continue; if (!src.match(/\.(jpg|jpeg|png|webp)/i)) continue; console.log(`   [Google-CSE] ${src.substring(0,70)}`); return src; } }
        } catch (_) {}
    }
    return null;
}

async function obtenerImagenInteligente(titulo, categoria, subtema, queryIA) {
    if (process.env.GOOGLE_CSE_KEY&&process.env.GOOGLE_CSE_ID&&titulo?.length>10) { const u=await buscarEnGoogle(titulo,categoria); if (u) return u; }
    console.log(`   [Imagen] Banco local → "${subtema||categoria}"`);
    return imgLocal(subtema, categoria);
}

const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function analizarSEOTitulo(titulo) {
    if (!titulo) return { score:0, problemas:['Sin titulo'], sugerencias:[] };
    const len=titulo.length; const problemas=[]; const sugerencias=[];
    if (len<40) { problemas.push(`Titulo corto (${len})`); sugerencias.push('Alargar a 55-65 chars'); }
    if (len>70) { problemas.push(`Titulo largo (${len})`); sugerencias.push('Acortar a 55-65 chars'); }
    const palabrasCTR=['anuncia','aprueba','aumenta','baja','alerta','muere','gana','pierde','sube','confirma','ordena','revela','impone'];
    const tieneVerbo=palabrasCTR.some(p=>titulo.toLowerCase().includes(p));
    if (!tieneVerbo) sugerencias.push('Agregar verbo activo');
    const tieneNumero=/\d/.test(titulo); if (!tieneNumero) sugerencias.push('Incluir cifra');
    const score=Math.max(0,100-(len<40?20:0)-(len>70?15:0)-(!tieneVerbo?15:0)-(!tieneNumero?10:0));
    return { score, problemas, sugerencias, len };
}

function analizarSEOContenido(contenido) {
    if (!contenido) return { score:0, problemas:['Sin contenido'] };
    const palabras=contenido.split(/\s+/).filter(Boolean).length;
    const parrafos=contenido.split('\n\n').filter(p=>p.trim()).length;
    const problemas=[];
    if (palabras<300) problemas.push(`Contenido corto (${palabras} palabras)`);
    if (parrafos<4) problemas.push(`Pocos parrafos (${parrafos})`);
    const score=Math.max(0,100-(palabras<300?20:0)-(parrafos<4?15:0));
    return { score, problemas, palabras, parrafos };
}

function metaTagsCompletos(n, url) {
    const t=esc(n.titulo), d=esc(n.seo_description||''), k=esc(n.seo_keywords||''), img=esc(n.imagen);
    const fi=new Date(n.fecha).toISOString(), ue=esc(url);
    const wc=(n.contenido||'').split(/\s+/).filter(Boolean).length;
    const kw=[n.seo_keywords||'','ultimo minuto republica dominicana','santo domingo este noticias','el farol al dia'].filter(Boolean).join(', ');
    const schema={'@context':'https://schema.org','@type':'NewsArticle',mainEntityOfPage:{'@type':'WebPage','@id':url},headline:n.titulo,description:n.seo_description||'',image:{'@type':'ImageObject',url:n.imagen,caption:n.imagen_caption||n.titulo,width:1200,height:630},datePublished:fi,dateModified:fi,author:{'@type':'Person',name:'Jose Gregorio Manan Santana',url:`${BASE_URL}/nosotros`,jobTitle:'Director General',worksFor:{'@type':'Organization',name:'El Farol al Dia'}},publisher:{'@type':'NewsMediaOrganization',name:'El Farol al Dia',url:BASE_URL,logo:{'@type':'ImageObject',url:`${BASE_URL}/static/favicon.png`,width:512,height:512},address:{'@type':'PostalAddress',addressLocality:'Santo Domingo Este',addressRegion:'Distrito Nacional',addressCountry:'DO'}},articleSection:n.seccion,wordCount:wc,inLanguage:'es-DO',isAccessibleForFree:true,locationCreated:{'@type':'Place',name:'Santo Domingo Este, Republica Dominicana'}};
    const bread={'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'Inicio',item:BASE_URL},{'@type':'ListItem',position:2,name:'Ultimo Minuto RD',item:`${BASE_URL}/`},{'@type':'ListItem',position:3,name:n.seccion,item:`${BASE_URL}/#${(n.seccion||'').toLowerCase()}`},{'@type':'ListItem',position:4,name:n.titulo,item:url}]};
    const tituloSEO=(n.titulo.toLowerCase().includes('santo domingo')||n.titulo.toLowerCase().includes('sde'))?`${t} | El Farol al Dia`:`${t} | Ultimo Minuto RD - El Farol al Dia`;
    return `<title>${tituloSEO}</title>\n<meta name="description" content="${d}"><meta name="keywords" content="${esc(kw)}">\n<meta name="author" content="Jose Gregorio Manan Santana - El Farol al Dia">\n<meta name="news_keywords" content="ultimo minuto, santo domingo este, tendencias dominicanas, ${esc(k)}">\n<meta name="geo.region" content="DO-01"><meta name="geo.placename" content="Santo Domingo Este, Republica Dominicana">\n<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">\n<link rel="canonical" href="${ue}"><link rel="alternate" hreflang="es-DO" href="${ue}"><link rel="alternate" hreflang="es" href="${ue}">\n<meta property="og:type" content="article"><meta property="og:title" content="${t}"><meta property="og:description" content="${d}">\n<meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">\n<meta property="og:url" content="${ue}"><meta property="og:site_name" content="El Farol al Dia - Ultimo Minuto RD"><meta property="og:locale" content="es_DO">\n<meta property="article:published_time" content="${fi}"><meta property="article:author" content="Jose Gregorio Manan Santana">\n<meta property="article:section" content="${esc(n.seccion)}"><meta property="article:tag" content="${esc(kw)}">\n<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${t}">\n<meta name="twitter:description" content="${d}"><meta name="twitter:image" content="${img}"><meta name="twitter:site" content="@elfarolaldia">\n<script type="application/ld+json">${JSON.stringify(schema)}</script>\n<script type="application/ld+json">${JSON.stringify(bread)}</script>`;
}

function slugify(t) { return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').substring(0,80); }

const PERIODISTAS = {
    'Carlos Mendez':      { esp:'Nacionales',      estilo:'Cronista politico. Frio, directo, datos duros. Cita instituciones oficiales.', fuentes:'Presidencia, Congreso, Procuraduria, Policia Nacional, JCE.', tono:'Formal. Titulares: "Abinader ordena...", "Congreso aprueba..."' },
    'Laura Santana':      { esp:'Deportes',         estilo:'Fanatica del beisbol y futbol dominicano. Conecta deporte con orgullo nacional.', fuentes:'MLB.com, Liga Dominicana Beisbol, Federacion Dominicana Futbol, ESPN Caribe.', tono:'Energetico. Titulares: "Guerrero Jr. rompe record...", "Tigres campeones..."' },
    'Roberto Pena':       { esp:'Internacionales',  estilo:'Corresponsal internacional. Conecta hechos globales con impacto en RD.', fuentes:'Reuters, AP, BBC Mundo, Bloomberg, ONU, OEA.', tono:'Analitico. Titulares: "Trump anuncia aranceles que afectan RD..."' },
    'Ana Maria Castillo': { esp:'Economia',         estilo:'Economista de campo. Habla de dinero en terminos que entiende el ciudadano.', fuentes:'BCRD, MEPyD, DGII, Bolsa RD, Ministerio Hacienda.', tono:'Preciso. Titulares: "Combustibles suben RD$15...", "Inflacion baja a 3.2%..."' },
    'Jose Miguel Fernandez':{ esp:'Tecnologia',     estilo:'Geek dominicano. Explica tecnologia para el empresario de SDE, estudiante INFOTEP.', fuentes:'INDOTEL, MICM, INFOTEP, startups RD, ITLA.', tono:'Cercano. Titulares: "INFOTEP abre becas IA para SDE..."' },
    'Patricia Jimenez':   { esp:'Espectaculos',     estilo:'Conocedora cultura dominicana: merengue, bachata, cine nacional, farandula Caribe.', fuentes:'Ministerio Cultura, Billboard Tropical, Premios Soberano, EGEDA RD.', tono:'Calido. Titulares: "Romeo Santos llena el Estadio Olimpico..."' },
};

function elegirRedactor(cat) { const m=Object.entries(PERIODISTAS).find(([_,p])=>p.esp===cat); return m?m[0]:'Redaccion EFD'; }
function obtenerPerfilPeriodista(n) { return PERIODISTAS[n]||{estilo:'Periodista generalista.',fuentes:'Fuentes oficiales.',tono:'Neutro y profesional.'}; }

let _cacheNoticias=null, _cacheFecha=0;
const CACHE_TTL=600000;
function invalidarCache() { _cacheNoticias=null; _cacheFecha=0; }

async function registrarError(tipo, descripcion, categoria) {
    try { const desc=String(descripcion||'').substring(0,200); await pool.query("INSERT INTO memoria_ia(tipo,valor,categoria,fallos) VALUES('error',$1,$2,1) ON CONFLICT DO NOTHING",[desc,categoria]); await pool.query("UPDATE memoria_ia SET fallos=fallos+1,ultima_vez=NOW() WHERE tipo='error' AND valor=$1",[desc]); } catch (_) {}
}

async function registrarAprendizaje(tipo, valor, categoria, exito=true) {
    try { const v=String(valor).substring(0,200); await pool.query(`INSERT INTO memoria_ia(tipo,valor,categoria,exitos,fallos) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[tipo,v,categoria,exito?1:0,exito?0:1]); await pool.query(`UPDATE memoria_ia SET exitos=exitos+$1,fallos=fallos+$2,ultima_vez=NOW() WHERE tipo=$3 AND valor=$4`,[exito?1:0,exito?0:1,tipo,v]); } catch (_) {}
}

async function registrarSEONoticia(titulo, contenido, categoria) {
    try { const sT=analizarSEOTitulo(titulo); const sC=analizarSEOContenido(contenido); const score=Math.round((sT.score+sC.score)/2); await registrarAprendizaje('seo_score',`${score}`,categoria,score>70); if (sT.problemas.length) console.log(`   [SEO] ${sT.problemas.join(', ')}`); console.log(`   [SEO] Score: ${score}/100`); return score; } catch (_) { return 0; }
}

async function aprenderDeVistas() {
    try {
        const top=await pool.query(`SELECT titulo,seccion,vistas FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '48 hours' AND vistas>0 ORDER BY vistas DESC LIMIT 20`);
        if (!top.rows.length) return;
        const vXC={},cXC={};
        for (const n of top.rows) { vXC[n.seccion]=(vXC[n.seccion]||0)+n.vistas; cXC[n.seccion]=(cXC[n.seccion]||0)+1; }
        for (const [cat,total] of Object.entries(vXC)) { const prom=Math.round(total/cXC[cat]); await registrarAprendizaje('rendimiento_categoria',cat,cat,prom>5); }
        const pV={};
        for (const n of top.rows) { const palabras=n.titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/\s+/).filter(w=>w.length>5&&!['republica','dominicana','santo','domingo'].includes(w)); for (const p of palabras) pV[p]=(pV[p]||0)+n.vistas; }
        const topP=Object.entries(pV).sort((a,b)=>b[1]-a[1]).slice(0,10);
        for (const [p] of topP) await registrarAprendizaje('palabra_trending',p,'global',true);
        console.log(`[Aprende] ${top.rows.length} noticias analizadas`);
    } catch(e) { console.warn('[Aprende] '+e.message); }
}

async function obtenerPalabrasAprendidas() {
    try { const r=await pool.query(`SELECT valor FROM memoria_ia WHERE tipo='palabra_trending' AND exitos>2 AND ultima_vez>NOW()-INTERVAL '7 days' ORDER BY exitos DESC LIMIT 20`); return r.rows.map(r=>r.valor); } catch (_) { return []; }
}

async function obtenerCategoriaOptima() {
    try { const r=await pool.query(`SELECT categoria,exitos,fallos,ROUND(exitos::float/GREATEST(exitos+fallos,1)*100) AS pct FROM memoria_ia WHERE tipo='rendimiento_categoria' ORDER BY exitos DESC LIMIT 1`); if (r.rows.length&&r.rows[0].pct>50) { console.log(`[Aprende] Categoria optima: ${r.rows[0].categoria}`); return r.rows[0].categoria; } } catch (_) {}
    return CATS[Math.floor(Math.random()*CATS.length)];
}

let PALABRAS_APRENDIDAS=[];
async function refrescarPalabrasAprendidas() { PALABRAS_APRENDIDAS=await obtenerPalabrasAprendidas(); if (PALABRAS_APRENDIDAS.length) console.log(`[Aprende] ${PALABRAS_APRENDIDAS.length} palabras activas`); }

async function construirMemoria() {
    try {
        const r=await pool.query("SELECT titulo,seccion,vistas FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 20");
        let mem='';
        if (r.rows.length) { r.rows.forEach(x=>{ const pc=x.titulo.toLowerCase().split(' ').filter(w=>w.length>5).slice(0,3).join('-'); temasPublicadosHoy.add(pc); }); mem+='\nYA PUBLICADAS — NO repetir:\n'+r.rows.map((x,i)=>`${i+1}. ${x.titulo}`).join('\n')+'\n'; }
        if (PALABRAS_APRENDIDAS.length) mem+=`\nPALABRAS CON TRAFICO REAL: ${PALABRAS_APRENDIDAS.slice(0,10).join(', ')}\n`;
        const top=await pool.query(`SELECT titulo,seccion,vistas FROM noticias WHERE estado='publicada' AND vistas>3 ORDER BY vistas DESC LIMIT 5`);
        if (top.rows.length) { mem+='\nTITULARES CON MAS TRAFICO (aprender estilo):\n'; top.rows.forEach(n=>{ const seo=analizarSEOTitulo(n.titulo); mem+=`- "${n.titulo}" → ${n.vistas} vistas (SEO: ${seo.score}/100)\n`; }); mem+='\n'; }
        return mem;
    } catch (_) { return ''; }
}

const temasPublicadosHoy=new Set();
setInterval(()=>temasPublicadosHoy.clear(), 12*60*60*1000);

const ADSENSE_CPC = {
    Nacionales:     'prestamos personales RD, credito hipotecario BHD Leon, plan vivienda gobierno dominicano, tasas interes bancos dominicanos, seguro de vida RD',
    Economia:       'inversion inmobiliaria santo domingo este, certificados financieros banco popular, bolsa de valores RD, prestamo pyme dominicana, tipo de cambio dolar peso dominicano',
    Tecnologia:     'software empresarial RD, banca en linea banco popular, seguridad informatica empresas RD, internet fibra optica santo domingo, INFOTEP cursos tecnologia',
    Deportes:       'seguro medico familiar RD, clinica deportiva santo domingo, academia beisbol RD, seguro accidente personal dominicano, viaje beisbol MLB desde RD',
    Internacionales:'envio remesas republica dominicana, western union RD, visa americana dominicanos, vuelos baratos santo domingo, seguro viaje internacional dominicano',
    Espectaculos:   'hoteles punta cana todo incluido, conciertos santo domingo 2025, turismo RD paquetes, agencia viajes RD, entretenimiento familiar santo domingo este',
};

async function inicializarBase() {
    const client=await pool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS noticias(id SERIAL PRIMARY KEY,titulo VARCHAR(255) NOT NULL,slug VARCHAR(255) UNIQUE,seccion VARCHAR(100),contenido TEXT,seo_description VARCHAR(160),seo_keywords VARCHAR(255),redactor VARCHAR(100),imagen TEXT,imagen_alt VARCHAR(255),imagen_caption TEXT,imagen_nombre VARCHAR(100),imagen_fuente VARCHAR(50),vistas INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,estado VARCHAR(50) DEFAULT 'publicada')`);
        for (const col of ['imagen_alt','imagen_caption','imagen_nombre','imagen_fuente','imagen_original']) { await client.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='noticias' AND column_name='${col}') THEN ALTER TABLE noticias ADD COLUMN ${col} TEXT;END IF;END $$;`).catch(()=>{}); }
        await client.query(`CREATE TABLE IF NOT EXISTS rss_procesados(id SERIAL PRIMARY KEY,item_guid VARCHAR(500) UNIQUE,fuente VARCHAR(100),fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE TABLE IF NOT EXISTS memoria_ia(id SERIAL PRIMARY KEY,tipo VARCHAR(50) NOT NULL,valor TEXT NOT NULL,categoria VARCHAR(100),exitos INTEGER DEFAULT 0,fallos INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,ultima_vez TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memoria_tipo ON memoria_ia(tipo,categoria)`).catch(()=>{});
        await client.query(`CREATE TABLE IF NOT EXISTS comentarios(id SERIAL PRIMARY KEY,noticia_id INTEGER NOT NULL REFERENCES noticias(id) ON DELETE CASCADE,nombre VARCHAR(80) NOT NULL,texto TEXT NOT NULL,aprobado BOOLEAN DEFAULT true,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_comentarios_noticia ON comentarios(noticia_id,aprobado,fecha DESC)`).catch(()=>{});
        const fix=await client.query(`UPDATE noticias SET imagen='${PB}/3182812/pexels-photo-3182812.jpeg?auto=compress&cs=tinysrgb&w=900&fit=crop',imagen_fuente='banco-local' WHERE imagen LIKE '%/images/cache/%' OR imagen LIKE '%fallback%' OR imagen IS NULL OR imagen=''`);
        if (fix.rowCount>0) console.log('[BD] Imagenes reparadas: '+fix.rowCount);
        console.log('[BD] Lista');
    } catch(e) { console.error('[BD] Error: '+e.message); } finally { client.release(); }
    await cargarConfigIA();
}

async function generarNoticia(categoria, comunicadoExterno=null, imagenRSSOverride=null) {
    if (!CONFIG_IA.enabled) return { success:false, error:'IA desactivada' };
    try {
        const memoria=await construirMemoria();
        const temaWiki=comunicadoExterno?(comunicadoExterno.split('\n')[0]||'').replace(/^TITULO:\s*/i,'').trim()||categoria:categoria;
        const contextoWiki=await buscarContextoWikipedia(temaWiki,categoria);
        const fuenteContenido=comunicadoExterno?`\nCOMUNICADO OFICIAL:\n"""\n${comunicadoExterno}\n"""\nRedacta noticia profesional. No copies textualmente.`:`\nEscribe noticia NUEVA sobre "${categoria}" para Republica Dominicana.`;
        const termCPC=ADSENSE_CPC[categoria]||'prestamos, inversion inmobiliaria, seguros, banca digital';
        const redactor=elegirRedactor(categoria);
        const perfil=obtenerPerfilPeriodista(redactor);

        const prompt=`Eres ${redactor}, periodista de El Farol al Dia — periodico digital dominicano lider en Santo Domingo Este.

TU PERFIL: ${perfil.estilo}
TUS FUENTES: ${perfil.fuentes}
TU VOZ: ${perfil.tono}

REGLAS: Datos reales. Impacto ciudadano. Titular imposible de ignorar. Sin relleno.
${memoria}
${fuenteContenido}

CATEGORIA: ${categoria}
ENFASIS: ${CONFIG_IA.enfasis}
EVITAR: ${CONFIG_IA.evitar}

ESTRUCTURA (piramide invertida):
1. LEAD: Que+Quien+Cuando+Donde+Por que en 2-3 lineas
2. DESARROLLO: Cifras concretas, contexto, comparacion
3. FUENTE OFICIAL: Cita institucion real dominicana
4. IMPACTO: Que cambia para el dominicano. Incluir NATURALMENTE 2-3 de: ${termCPC}
5. PROYECCION: Proximos pasos o fecha clave

SEO GOOGLE NEWS:
- TITULO: 55-65 chars. Verbo activo inicio. Cifra si existe. Termino geografico.
- DESCRIPCION: 150-158 chars. Dato nuevo + impacto + gancho.
- PALABRAS: 8 keywords. Primera: keyword long-tail principal.
- ALT_IMAGEN: 15-20 palabras describiendo foto + contexto RD.

FORMATO EXACTO SIN MARKDOWN:
TITULO: [55-65 chars]
DESCRIPCION: [150-158 chars]
PALABRAS: [8 keywords]
ALT_IMAGEN: [15-20 palabras]
SUBTEMA_LOCAL: [uno de: politica-gobierno, seguridad-policia, relaciones-internacionales, economia-mercado, infraestructura, salud-medicina, deporte-beisbol, deporte-futbol, deporte-general, tecnologia, educacion, cultura-musica, medio-ambiente, turismo, emergencia, vivienda-social, transporte-vial]
CONTENIDO:
[450-520 palabras. 5 parrafos. Linea en blanco entre cada uno.]`;

        console.log(`\n[Gen] ${categoria}${comunicadoExterno?' (RSS)':' (auto)'}`);
        const texto=await llamarGemini(prompt);
        const textoLimpio=texto.replace(/^\s*[*#]+\s*/gm,'');

        let titulo='',desc='',pals='',ai='',sub='',enC=false; const bl=[];
        for (const l of textoLimpio.split('\n')) {
            const t=l.trim();
            if (t.startsWith('TITULO:')) titulo=t.replace('TITULO:','').trim();
            else if (t.startsWith('DESCRIPCION:')) desc=t.replace('DESCRIPCION:','').trim();
            else if (t.startsWith('PALABRAS:')) pals=t.replace('PALABRAS:','').trim();
            else if (t.startsWith('ALT_IMAGEN:')) ai=t.replace('ALT_IMAGEN:','').trim();
            else if (t.startsWith('SUBTEMA_LOCAL:')) sub=t.replace('SUBTEMA_LOCAL:','').trim();
            else if (t.startsWith('CONTENIDO:')) enC=true;
            else if (enC&&t.length>0) bl.push(t);
        }

        const contenido=bl.join('\n\n');
        titulo=titulo.replace(/[*_#`"]/g,'').trim();
        desc=desc.replace(/[*_#`]/g,'').trim();

        if (!titulo) throw new Error('Sin TITULO');
        if (!contenido||contenido.length<250) throw new Error(`Contenido insuficiente (${contenido.length})`);
        console.log('[Gen] '+titulo);

        let urlOrig;
        if (imagenRSSOverride) {
            try { const cal=await verificarCalidadImagen(imagenRSSOverride); console.log(`   [IMG-CHECK] ${cal.razon}`); if (cal.ok) { urlOrig=imagenRSSOverride; } else { const urlHD=await buscarEnGoogle(titulo,categoria); urlOrig=urlHD||imgLocal(sub||FALLBACK_CAT[categoria]||'politica-gobierno',categoria); } } catch(e) { urlOrig=imgLocal(sub||FALLBACK_CAT[categoria]||'politica-gobierno',categoria); }
        } else { urlOrig=await obtenerImagenInteligente(titulo,categoria,sub,null); }

        const imgResult=await aplicarMarcaDeAgua(urlOrig);
        const urlFinal=imgResult.procesada?`${BASE_URL}/img/${imgResult.nombre}`:urlOrig;

        const altFinal=(ai&&ai.length>15)?(ai.toLowerCase().includes('dominicana')||ai.toLowerCase().includes('republic')?`${ai} - El Farol al Dia`:`${ai}, noticias Republica Dominicana - El Farol al Dia`):`${titulo.substring(0,50)} - noticias Santo Domingo Este Republica Dominicana`;
        const sl=slugify(titulo);
        const existe=await pool.query('SELECT id FROM noticias WHERE slug=$1',[sl]);
        const slFin=existe.rows.length?`${sl}-${Date.now()}`:sl;

        await pool.query(`INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [titulo.substring(0,255),slFin,categoria,contenido.substring(0,10000),desc.substring(0,160),(pals||categoria).substring(0,255),redactor,urlFinal,altFinal.substring(0,255),`Fotografia: ${titulo}`,imgResult.nombre||'efd.jpg','el-farol',urlOrig,'publicada']);

        console.log('[Gen] Publicada: /noticia/'+slFin);
        if (urlFinal) fotosUsadasReciente.add(urlFinal);
        if (urlOrig) fotosUsadasReciente.add(urlOrig);
        invalidarCache();

        await registrarSEONoticia(titulo,contenido,categoria);
        await registrarAprendizaje('fuente_exitosa',categoria,categoria,true);
        const palabrasExito=titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/\s+/).filter(w=>w.length>4).slice(0,6);
        for (const p of palabrasExito) await registrarAprendizaje('palabra_publicada',p,categoria,true);
        const hora=new Date().getHours(); await registrarAprendizaje('horario_publicacion',`hora_${hora}`,categoria,true);

        return { success:true, slug:slFin, titulo, mensaje:'Publicada en web' };
    } catch(error) { console.error('[Gen] ERROR: '+error.message); await registrarError('generacion',error.message,categoria); return { success:false, error:error.message }; }
}

const FUENTES_RSS = [
    { url:'https://listindiario.com/feed',                              categoria:'Nacionales',      nombre:'Listin Diario' },
    { url:'https://listindiario.com/la-republica/feed',                 categoria:'Nacionales',      nombre:'Listin Republica' },
    { url:'https://listindiario.com/economia-and-negocios/feed',        categoria:'Economia',        nombre:'Listin Economia' },
    { url:'https://listindiario.com/deportes/feed',                     categoria:'Deportes',        nombre:'Listin Deportes' },
    { url:'https://listindiario.com/la-vida/feed',                      categoria:'Espectaculos',    nombre:'Listin Vida' },
    { url:'https://listindiario.com/tecnologia/feed',                   categoria:'Tecnologia',      nombre:'Listin Tecnologia' },
    { url:'https://listindiario.com/el-mundo/feed',                     categoria:'Internacionales', nombre:'Listin Mundo' },
    { url:'https://www.diariolibre.com/feed',                           categoria:'Nacionales',      nombre:'Diario Libre' },
    { url:'https://www.diariolibre.com/economia/feed',                  categoria:'Economia',        nombre:'DL Economia' },
    { url:'https://www.diariolibre.com/deportes/feed',                  categoria:'Deportes',        nombre:'DL Deportes' },
    { url:'https://www.diariolibre.com/tecnologia/feed',                categoria:'Tecnologia',      nombre:'DL Tecnologia' },
    { url:'https://www.diariolibre.com/mundo/feed',                     categoria:'Internacionales', nombre:'DL Mundo' },
    { url:'https://www.diariolibre.com/entretenimiento/feed',           categoria:'Espectaculos',    nombre:'DL Entretenimiento' },
    { url:'https://n.com.do/feed/',                                     categoria:'Nacionales',      nombre:'N Digital' },
    { url:'https://n.com.do/economia/feed/',                            categoria:'Economia',        nombre:'N Digital Economia' },
    { url:'https://n.com.do/deportes/feed/',                            categoria:'Deportes',        nombre:'N Digital Deportes' },
    { url:'https://n.com.do/internacionales/feed/',                     categoria:'Internacionales', nombre:'N Digital Mundo' },
    { url:'https://n.com.do/entretenimiento/feed/',                     categoria:'Espectaculos',    nombre:'N Digital Entretenimiento' },
    { url:'https://feeds.bbci.co.uk/mundo/rss.xml',                     categoria:'Internacionales', nombre:'BBC Mundo' },
    { url:'https://www.reuters.com/arc/outboundfeeds/rss/category/latam/?outputType=xml', categoria:'Internacionales', nombre:'Reuters LatAm' },
    { url:'https://feeds.bloomberg.com/markets/news.rss',               categoria:'Economia',        nombre:'Bloomberg' },
    { url:'https://www.wired.com/feed/rss',                             categoria:'Tecnologia',      nombre:'Wired' },
];

let rssEnProceso=false;

const PATRON_IMAGEN_PERIODICO = {
    'diariolibre.com':(html)=>{ const og=html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)||html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i); if (og?.[1]?.startsWith('http')) return og[1]; const dl=html.match(/resources\.diariolibre\.com\/images\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i); if (dl) return 'https://'+dl[0].replace(/^https?:\/\//,''); return null; },
    'listindiario.com':(html)=>{ const og=html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)||html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i); if (og?.[1]?.startsWith('http')) return og[1]; const ld=html.match(/cdn\.listindiario\.com\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i); if (ld) return 'https://'+ld[0].replace(/^https?:\/\//,''); return null; },
    'n.com.do':(html)=>{ const og=html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)||html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i); if (og?.[1]?.startsWith('http')) return og[1]; const nd=html.match(/https:\/\/[^"'\s]*n\.com\.do[^"'\s]+\.(?:jpg|jpeg|png|webp)/i); if (nd) return nd[0]; return null; },
    'reuters.com':(html)=>{ const og=html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)||html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i); return og?.[1]?.startsWith('http')?og[1]:null; },
    'bbc.com':(html)=>{ const og=html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)||html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i); return og?.[1]?.startsWith('http')?og[1]:null; },
};

async function scrapearImagenArticulo(url) {
    if (!url) return null;
    try {
        const ctrl=new AbortController(); const tm=setTimeout(()=>ctrl.abort(),8000);
        const res=await fetch(url,{headers:{...BROWSER_HEADERS,Accept:'text/html,application/xhtml+xml'},signal:ctrl.signal}).finally(()=>clearTimeout(tm));
        if (!res.ok) return null; const html=await res.text();
        for (const [dominio,extractor] of Object.entries(PATRON_IMAGEN_PERIODICO)) { if (url.includes(dominio)) { const img=extractor(html); if (img) { console.log(`   [Scraper] ${img.substring(0,70)}`); return img; } break; } }
        const og=html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)||html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        if (og?.[1]?.startsWith('http')&&/\.(jpg|jpeg|png|webp)/i.test(og[1])) return og[1];
        const tw=html.match(/name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)||html.match(/content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
        if (tw?.[1]?.startsWith('http')&&/\.(jpg|jpeg|png|webp)/i.test(tw[1])) return tw[1];
    } catch (_) {}
    return null;
}

function extraerImagenRSS(item) {
    try {
        if (item.enclosure?.url&&/\.(jpg|jpeg|png|webp)/i.test(item.enclosure.url)) return item.enclosure.url;
        const media=item['media:content']||item['media:thumbnail'];
        if (media?.$?.url&&/\.(jpg|jpeg|png|webp)/i.test(media.$.url)) return media.$.url;
        if (Array.isArray(media)) { for (const m of media) { if (m.$?.url&&/\.(jpg|jpeg|png|webp)/i.test(m.$.url)) return m.$.url; } }
        const html=item.content||item['content:encoded']||'';
        if (html) { const m=html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp))[^"']*["']/i); if (m?.[1]?.startsWith('http')) return m[1]; }
    } catch (_) {}
    return null;
}

const PALABRAS_TRENDING=['abinader','leonel','presidente','gobierno','congreso','senado','precio','gasolina','combustible','dolar','inflacion','salario','luz','agua','vivienda','banco','muerto','matan','policia','arresto','crimen','beisbol','pelotero','liga','campeón','gana','trump','remesas','deportacion','migrante','haiti','accidente','incendio','huracan','hospital','ia','chatgpt'];

function puntuarRelevancia(titulo, contenido='') {
    if (!titulo) return 0; const texto=(titulo+' '+contenido).toLowerCase(); let score=0;
    for (const p of PALABRAS_TRENDING) { if (texto.includes(p)) score+=3; }
    for (const p of PALABRAS_APRENDIDAS) { if (texto.includes(p)) score+=5; }
    if (/\d+%|\$\d+|rd\$|millones|miles de|\d+ (personas|muertos|heridos)/.test(texto)) score+=5;
    if (/santo domingo|santiago|la romana|san pedro|sde|los mina/.test(texto)) score+=3;
    const pc=titulo.toLowerCase().split(' ').filter(w=>w.length>5).slice(0,3).join('-');
    if (temasPublicadosHoy.has(pc)) score-=10;
    return score;
}

async function procesarRSS() {
    if (!CONFIG_IA.enabled) return;
    if (rssEnProceso) { console.log('[RSS] En proceso'); return; }
    rssEnProceso=true;
    console.log('\n[RSS] Ciclo iniciado...');
    let procesadas=0, omitidas=0;
    const candidatos=[];
    for (const fuente of FUENTES_RSS) {
        try { const feed=await rssParser.parseURL(fuente.url).catch(()=>null); if (!feed?.items?.length) continue; for (const item of feed.items.slice(0,5)) { const guid=item.guid||item.link||item.title; if (!guid) continue; const ya=await pool.query('SELECT id FROM rss_procesados WHERE item_guid=$1',[guid.substring(0,500)]); if (ya.rows.length) continue; const score=puntuarRelevancia(item.title,item.contentSnippet); candidatos.push({item,fuente,guid,score}); } } catch (_) {}
        await new Promise(r=>setTimeout(r,500));
    }
    if (!candidatos.length) { console.log('[RSS] Sin noticias nuevas'); SALUD.rssVaciosCiclos++; rssEnProceso=false; return; }
    candidatos.sort((a,b)=>b.score-a.score);
    console.log(`[RSS] ${candidatos.length} candidatas`);
    const SCORE_MIN=3, MAX_CICLO=2;
    for (const {item,fuente,guid,score} of candidatos.slice(0,MAX_CICLO)) {
        if (score<SCORE_MIN) { omitidas++; await pool.query('INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING',[guid.substring(0,500),fuente.nombre+'-omitida']); continue; }
        console.log(`[RSS] Publicando (score ${score}): "${(item.title||'').substring(0,50)}"`);
        let imagenRSS=extraerImagenRSS(item);
        if (!imagenRSS&&item.link) imagenRSS=await scrapearImagenArticulo(item.link);
        const com=[item.title?`TITULO ORIGINAL: ${item.title}`:'',item.contentSnippet?`RESUMEN: ${item.contentSnippet}`:'',item.content?`CONTENIDO: ${item.content.substring(0,2000)}`:'',item['content:encoded']?`TEXTO: ${item['content:encoded'].replace(/<[^>]+>/g,'').substring(0,1000)}`:'',`FUENTE: ${fuente.nombre}`,`SCORE: ${score}`,`INSTRUCCION: Reescribe con voz propia. SEO maximo. NO copies.`].filter(Boolean).join('\n');
        const res=await generarNoticia(fuente.categoria,com,imagenRSS);
        if (res.success) { await pool.query('INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING',[guid.substring(0,500),fuente.nombre]); const pc=(item.title||'').toLowerCase().split(' ').filter(w=>w.length>5).slice(0,3).join('-'); temasPublicadosHoy.add(pc); procesadas++; await new Promise(r=>setTimeout(r,25000)); }
    }
    console.log(`[RSS] Publicadas: ${procesadas} | Omitidas: ${omitidas}`);
    if (procesadas>0) { SALUD.rssVaciosCiclos=0; SALUD.ultimaPublicacion=Date.now(); }
    rssEnProceso=false;
}

let wmRegenEnProceso=false;

async function verificarCalidadImagen(urlImagen, minAncho=400) {
    try {
        const ctrl=new AbortController(); const tm=setTimeout(()=>ctrl.abort(),8000);
        const resp=await fetch(urlImagen,{headers:BROWSER_HEADERS,signal:ctrl.signal}).finally(()=>clearTimeout(tm));
        if (!resp.ok) return { ok:false, razon:`HTTP ${resp.status}` };
        const buf=Buffer.from(await resp.arrayBuffer()); const meta=await sharp(buf).metadata().catch(()=>null);
        const ancho=meta?.width||0; const alto=meta?.height||0;
        if (ancho<minAncho) return { ok:false, ancho, alto, razon:`pixelada (${ancho}px < ${minAncho}px)` };
        try {
            const fH=Math.round(alto*0.15); const fW=Math.round(ancho*0.50); const fX=ancho-fW; const fY=alto-fH;
            const franja=await sharp(buf).extract({left:fX,top:fY,width:fW,height:fH}).grayscale().raw().toBuffer({resolveWithObject:true});
            const pixels=franja.data; let suma=0,sumaCuadrados=0;
            for (const p of pixels) { suma+=p; sumaCuadrados+=p*p; }
            const media=suma/pixels.length; const varianza=(sumaCuadrados/pixels.length)-(media*media); const stdDev=Math.sqrt(varianza);
            if (stdDev>55) return { ok:false, ancho, alto, razon:`marca ajena (stdDev ${stdDev.toFixed(1)})` };
        } catch (_) {}
        return { ok:true, ancho, alto, razon:`OK (${ancho}x${alto}px)` };
    } catch(e) { return { ok:false, razon:e.message }; }
}

function esFotoFea(imagen) {
    if (!imagen) return true;
    if (imagen.includes('/img/efd-')) return false;
    if (imagen.includes('pexels.com')||imagen.includes('wikimedia.org')||imagen.includes('pixabay.com')||imagen.includes('unsplash.com')) return true;
    return false;
}

function fotoRotaEnDisco(imagen) {
    if (!imagen||!imagen.includes('/img/efd-')) return false;
    const nombre=imagen.split('/img/')[1]; if (!nombre) return false;
    return !fs.existsSync(path.join('/tmp',nombre));
}

async function regenerarWatermarksLostidos() {
    if (!WATERMARK_PATH||wmRegenEnProceso) return;
    wmRegenEnProceso=true;
    try {
        const r=await pool.query(`SELECT id,titulo,seccion,imagen,imagen_nombre,imagen_original FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 30`);
        if (!r.rows.length) { wmRegenEnProceso=false; return; }
        const necesitan=r.rows.filter(n=>esFotoFea(n.imagen)||fotoRotaEnDisco(n.imagen));
        if (!necesitan.length) { console.log('[WM-Regen] Todas las fotos OK'); wmRegenEnProceso=false; return; }
        const aTratar=necesitan.slice(0,2); console.log(`[WM-Regen] ${necesitan.length} feas → procesando ${aTratar.length}`);
        let regenerados=0;
        for (const n of aTratar) {
            try {
                let urlFuente=null, metodo=null;
                if (n.imagen_original&&!esFotoFea(n.imagen_original)&&n.imagen_original.match(/\.(jpg|jpeg|png|webp)/i)) { const cal=await verificarCalidadImagen(n.imagen_original); if (cal.ok) { urlFuente=n.imagen_original; metodo='imagen_original'; } }
                if (!urlFuente&&n.imagen_original?.startsWith('http')&&!n.imagen_original.match(/\.(jpg|jpeg|png|webp)/i)) { const img=await scrapearImagenArticulo(n.imagen_original); if (img) { const cal=await verificarCalidadImagen(img); if (cal.ok) { urlFuente=img; metodo='scraping'; } } }
                if (!urlFuente&&process.env.GOOGLE_CSE_KEY&&process.env.GOOGLE_CSE_ID) { const u=await buscarEnGoogle(n.titulo,n.seccion); if (u) { const cal=await verificarCalidadImagen(u); if (cal.ok) { urlFuente=u; metodo='Google CSE'; } } }
                if (!urlFuente) { urlFuente=imgLocal(FALLBACK_CAT[n.seccion]||'politica-gobierno',n.seccion); metodo='banco local'; }
                const res=await aplicarMarcaDeAgua(urlFuente);
                if (res.procesada&&res.nombre) { await pool.query('UPDATE noticias SET imagen=$1,imagen_nombre=$2,imagen_original=$3 WHERE id=$4',[`${BASE_URL}/img/${res.nombre}`,res.nombre,urlFuente,n.id]); console.log(`   [WM-Regen] ID ${n.id} ${metodo}`); regenerados++; }
            } catch(e) { console.warn(`   [WM-Regen] ID ${n.id}: ${e.message}`); }
            await new Promise(r=>setTimeout(r,8000));
        }
        if (regenerados>0) { console.log(`[WM-Regen] ${regenerados} regeneradas`); invalidarCache(); }
    } catch(e) { console.error('[WM-Regen] '+e.message); }
    wmRegenEnProceso=false;
}

const CATS=['Nacionales','Deportes','Internacionales','Economia','Tecnologia','Espectaculos'];

async function analizarRendimiento(dias=7) {
    try {
        const r=await pool.query(`SELECT id,titulo,seccion,vistas,fecha FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '${parseInt(dias)} days' ORDER BY vistas DESC`);
        if (!r.rows.length) return { success:true, mensaje:'Sin noticias', noticias:[] };
        const total=r.rows.reduce((s,n)=>s+(n.vistas||0),0); const prom=Math.round(total/r.rows.length);
        const categorias={};
        for (const cat of CATS) { const rows=r.rows.filter(n=>n.seccion===cat); const vistas=rows.reduce((s,n)=>s+(n.vistas||0),0); const p=rows.length?Math.round(vistas/rows.length):0; categorias[cat]={total:rows.length,vistas_totales:vistas,vistas_promedio:p,rendimiento:prom?Math.round((p/prom)*100):0,mejor:rows[0]?{titulo:rows[0].titulo,vistas:rows[0].vistas}:null}; }
        const errores=await pool.query(`SELECT valor,fallos,categoria FROM memoria_ia WHERE tipo='error' AND ultima_vez>NOW()-INTERVAL '7 days' ORDER BY fallos DESC LIMIT 5`);
        return { success:true, periodo:`${dias} dias`, total_noticias:r.rows.length, total_vistas:total, promedio_general:prom, categorias, errores:errores.rows };
    } catch(e) { return { success:false, error:e.message }; }
}

const SALUD = { erroresGemini:0, timeoutsGemini:0, erroresImagen:0, rssVaciosCiclos:0, ultimaPublicacion:Date.now(), arranque:Date.now() };

async function autoDiagnostico() {
    const ahora=Date.now(); const problemas=[]; const resueltos=[];
    if (SALUD.erroresGemini>=3) { problemas.push(`Gemini: ${SALUD.erroresGemini} errores`); for (let i=0;i<GEMINI_KEYS.length;i++) GEMINI_KEY_RESET[i]=0; GEMINI_KEY_INDEX=0; SALUD.erroresGemini=0; resueltos.push('Keys Gemini reseteadas'); }
    if (SALUD.timeoutsGemini>=5) { problemas.push(`Gemini: ${SALUD.timeoutsGemini} timeouts`); GS.lastRequest=Date.now()+30000; SALUD.timeoutsGemini=0; resueltos.push('Pausa Gemini extendida'); }
    const minSin=(ahora-SALUD.ultimaPublicacion)/60000;
    if (minSin>120&&CONFIG_IA.enabled) { problemas.push(`Sin publicar ${Math.round(minSin)} min`); if (!rssEnProceso) { procesarRSS(); resueltos.push('RSS forzado'); } }
    if (SALUD.rssVaciosCiclos>=5) { problemas.push('RSS vacio 5 ciclos'); try { const r=await pool.query(`DELETE FROM rss_procesados WHERE fecha<NOW()-INTERVAL '6 hours'`); SALUD.rssVaciosCiclos=0; resueltos.push(`${r.rowCount} RSS limpiados`); } catch (_) {} }
    try { const cnt=await pool.query(`SELECT COUNT(*) AS c FROM noticias WHERE estado='publicada'`); const total=parseInt(cnt.rows[0].c); if (total<5&&CONFIG_IA.enabled&&!rssEnProceso) { problemas.push(`Solo ${total} noticias`); for (const cat of ['Nacionales','Deportes','Economia']) setTimeout(()=>generarNoticia(cat),(CATS.indexOf(cat)+1)*90000); resueltos.push('Generando noticias de emergencia'); } } catch (_) {}
    try { const fm=await pool.query(`SELECT COUNT(*) AS c FROM noticias WHERE estado='publicada' AND (imagen LIKE '%pexels.com%' OR imagen LIKE '%pixabay.com%') AND imagen NOT LIKE '%/img/efd-%'`); const nF=parseInt(fm.rows[0].c); if (nF>0) { problemas.push(`${nF} fotos genericas`); if (!wmRegenEnProceso) { regenerarWatermarksLostidos(); resueltos.push('Regenerador iniciado'); } } } catch (_) {}
    try { await pool.query('SELECT 1'); } catch(e) { problemas.push(`BD: ${e.message}`); }
    try { const dupes=await pool.query(`SELECT titulo,COUNT(*) AS c FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '24 hours' GROUP BY titulo HAVING COUNT(*)>1`); if (dupes.rows.length) { problemas.push(`${dupes.rows.length} duplicados`); for (const d of dupes.rows) await pool.query(`DELETE FROM noticias WHERE titulo=$1 AND id NOT IN (SELECT id FROM noticias WHERE titulo=$1 ORDER BY fecha DESC LIMIT 1)`,[d.titulo]).catch(()=>{}); invalidarCache(); resueltos.push('Duplicados eliminados'); } } catch (_) {}
    try { const viejas=await pool.query(`SELECT COUNT(*) AS c FROM noticias WHERE fecha<NOW()-INTERVAL '8 days'`); if (parseInt(viejas.rows[0].c)>0) { await pool.query(`DELETE FROM noticias WHERE fecha<NOW()-INTERVAL '8 days'`); invalidarCache(); } } catch (_) {}
    if (_cacheNoticias&&(ahora-_cacheFecha)/60000>10) invalidarCache();
    await refrescarPalabrasAprendidas().catch(()=>{});
    const uptime=Math.round((ahora-SALUD.arranque)/3600000);
    const hora=new Date().toLocaleTimeString('es-DO',{hour:'2-digit',minute:'2-digit',timeZone:'America/Santo_Domingo'});
    if (problemas.length||resueltos.length) { console.log(`[Ingeniero] ${hora} uptime:${uptime}h`); problemas.forEach(p=>console.log(`   ${p}`)); resueltos.forEach(r=>console.log(`   OK: ${r}`)); for (const p of problemas) await registrarError('autodiagnostico',p,'sistema').catch(()=>{}); }
    else console.log(`[Ingeniero] ${hora} — OK (uptime: ${uptime}h)`);
}

const MODO_ESPEJO=process.env.MODO_ESPEJO==='true';

cron.schedule('*/14 * * * *',async()=>{ try { await fetch(`http://localhost:${PORT}/health`); } catch (_) {} });
cron.schedule('0 * * * *',()=>{ if (global.gc) global.gc(); if (fotosUsadasReciente.size>500) fotosUsadasReciente.clear(); if (temasPublicadosHoy.size>500) temasPublicadosHoy.clear(); });

if (!MODO_ESPEJO) {
    cron.schedule('0 6-19 * * *', async()=>{ if (!rssEnProceso) procesarRSS(); });
    cron.schedule('10 6-19 * * *',async()=>{ if (!rssEnProceso) procesarRSS(); });
    cron.schedule('20 6-19 * * *',async()=>{ if (!rssEnProceso) procesarRSS(); });
    cron.schedule('40 6-19 * * *',async()=>{ if (!CONFIG_IA.enabled||rssEnProceso) return; const cat=await obtenerCategoriaOptima(); await generarNoticia(cat); });
    cron.schedule('0 20-23 * * *', async()=>{ if (!rssEnProceso) procesarRSS(); });
    cron.schedule('30 20-23 * * *',async()=>{ if (!rssEnProceso) procesarRSS(); });
    cron.schedule('0 0-5 * * *',  async()=>{ if (!rssEnProceso) procesarRSS(); });
}

cron.schedule('*/30 * * * *',async()=>{ await autoDiagnostico(); });

if (!MODO_ESPEJO) {
    cron.schedule('0 3 * * *',async()=>{
        try { const r1=await pool.query(`DELETE FROM noticias WHERE fecha<NOW()-INTERVAL '7 days' RETURNING id`); console.log(`[Limpieza] Noticias: ${r1.rowCount}`); const r2=await pool.query(`DELETE FROM rss_procesados WHERE fecha<NOW()-INTERVAL '3 days'`); console.log(`[Limpieza] RSS: ${r2.rowCount}`); const archivos=fs.readdirSync('/tmp').filter(f=>f.startsWith('efd-')&&f.endsWith('.jpg')); let b=0; const ahora=Date.now(); for (const a of archivos) { try { const s=fs.statSync(path.join('/tmp',a)); if ((ahora-s.mtimeMs)/(1000*60*60*24)>7) { fs.unlinkSync(path.join('/tmp',a)); b++; } } catch (_) {} } console.log(`[Limpieza] Imgs: ${b}`); invalidarCache(); } catch(e) { console.error('[Limpieza] '+e.message); }
    });
    cron.schedule('0 */2 * * *',async()=>{ regenerarWatermarksLostidos(); });
    cron.schedule('0 */4 * * *',async()=>{ await aprenderDeVistas(); await refrescarPalabrasAprendidas(); });
}

app.get('/health',(_, res)=>res.json({status:'OK',version:'34.51',modelo:GEMINI_MODEL}));
app.get('/',         (_,res)=>res.sendFile(path.join(__dirname,'client','index.html')));
app.get('/redaccion', authMiddleware,(_,res)=>res.sendFile(path.join(__dirname,'client','redaccion.html')));
app.get('/monitor',   authMiddleware,(_,res)=>res.sendFile(path.join(__dirname,'client','monitor.html')));
app.get('/ingeniero', (req,res)=>{ if (req.query.pin!=='311') return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ingenieria</title><style>body{background:#0a0a0f;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Arial}.b{background:#111118;border:1px solid #FF5500;border-radius:12px;padding:30px;text-align:center}h2{color:#FF5500;margin-bottom:16px}input{padding:10px;border-radius:6px;border:1px solid #333;background:#0a0a0f;color:#fff;font-size:20px;text-align:center;width:120px}button{display:block;margin:12px auto 0;padding:10px 24px;background:#FF5500;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold}</style></head><body><div class="b"><h2>INGENIERIA</h2><form action="/ingeniero" method="get"><input type="password" name="pin" placeholder="PIN" maxlength="6" autofocus><button type="submit">ENTRAR</button></form></div></body></html>`); res.sendFile(path.join(__dirname,'client','ingeniero.html')); });
app.get('/contacto', (_,res)=>res.sendFile(path.join(__dirname,'client','contacto.html')));
app.get('/nosotros', (_,res)=>res.sendFile(path.join(__dirname,'client','nosotros.html')));
app.get('/privacidad',(_,res)=>res.sendFile(path.join(__dirname,'client','privacidad.html')));
app.get('/terminos', (_,res)=>res.sendFile(path.join(__dirname,'client','terminos.html')));
app.get('/cookies',  (_,res)=>res.sendFile(path.join(__dirname,'client','cookies.html')));

app.options('/api/noticias',(req,res)=>{ res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type'); res.sendStatus(200); });

app.get('/api/noticias',async(req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Cache-Control','public,max-age=300,stale-while-revalidate=600'); res.setHeader('Content-Type','application/json');
    try {
        if (_cacheNoticias&&(Date.now()-_cacheFecha)<CACHE_TTL) return res.json({success:true,noticias:_cacheNoticias,cached:true});
        const r=await pool.query(`SELECT id,titulo,slug,seccion,imagen,imagen_alt,fecha,vistas,redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 20`,['publicada']);
        _cacheNoticias=r.rows; _cacheFecha=Date.now(); res.json({success:true,noticias:r.rows});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/estadisticas',async(req,res)=>{ try { const r=await pool.query("SELECT COUNT(*) AS c,COALESCE(SUM(vistas),0) AS v FROM noticias WHERE estado=$1",['publicada']); res.json({success:true,totalNoticias:parseInt(r.rows[0].c),totalVistas:parseInt(r.rows[0].v)}); } catch(e) { res.status(500).json({success:false,error:e.message}); } });
app.get('/api/coach',async(req,res)=>{ const dias=Math.max(1,Math.min(90,parseInt(req.query.dias)||7)); const a=await analizarRendimiento(dias); res.status(a.success?200:500).json(a); });
app.get('/api/memoria',authMiddleware,async(req,res)=>{ if (req.query.pin!=='311') return res.status(403).json({error:'PIN requerido'}); try { const r=await pool.query(`SELECT tipo,valor,categoria,exitos,fallos,ROUND((exitos::float/GREATEST(exitos+fallos,1))*100) AS pct_exito,ultima_vez FROM memoria_ia ORDER BY ultima_vez DESC LIMIT 50`); res.json({success:true,registros:r.rows}); } catch(e) { res.status(500).json({success:false,error:e.message}); } });

app.post('/api/resetear-todo',authMiddleware,async(req,res)=>{ if (req.body.pin!=='311') return res.status(403).json({error:'PIN'}); try { await pool.query('DELETE FROM noticias'); await pool.query('DELETE FROM rss_procesados'); await pool.query('DELETE FROM comentarios'); invalidarCache(); res.json({success:true,mensaje:'Todo borrado.'}); } catch(e) { res.status(500).json({success:false,error:e.message}); } });

app.post('/api/generar-noticia',authMiddleware,async(req,res)=>{ const{categoria,tema_cpc}=req.body; if (!categoria) return res.status(400).json({error:'Falta categoria'}); const r=await generarNoticia(categoria,tema_cpc||null); res.status(r.success?200:500).json(r); });
app.post('/api/regenerar-fotos',authMiddleware,async(req,res)=>{ if (req.body.pin!=='311') return res.status(403).json({error:'PIN'}); if (wmRegenEnProceso) return res.json({success:false,mensaje:'En proceso'}); regenerarWatermarksLostidos(); res.json({success:true,mensaje:'Iniciado'}); });
app.post('/api/procesar-rss',authMiddleware,async(req,res)=>{ if (req.body.pin!=='311') return res.status(403).json({error:'PIN'}); procesarRSS(); res.json({success:true,mensaje:'RSS iniciado'}); });
app.post('/api/actualizar-imagen/:id',authMiddleware,async(req,res)=>{ const{pin,imagen}=req.body; if (pin!=='311') return res.status(403).json({success:false,error:'PIN'}); const id=parseInt(req.params.id); if (!id||!imagen) return res.status(400).json({success:false,error:'Faltan datos'}); try { await pool.query('UPDATE noticias SET imagen=$1 WHERE id=$2',[imagen,id]); invalidarCache(); res.json({success:true}); } catch(e) { res.status(500).json({success:false,error:e.message}); } });
app.post('/api/eliminar/:id',authMiddleware,async(req,res)=>{ if (req.body.pin!=='311') return res.status(403).json({success:false,error:'PIN'}); const id=parseInt(req.params.id); if (!id) return res.status(400).json({success:false,error:'ID invalido'}); try { await pool.query('DELETE FROM noticias WHERE id=$1',[id]); invalidarCache(); res.json({success:true}); } catch(e) { res.status(500).json({success:false,error:e.message}); } });

app.get('/api/admin/comentarios',authMiddleware,async(req,res)=>{ if (req.query.pin!=='311') return res.status(403).json({error:'PIN'}); try { const r=await pool.query(`SELECT c.id,c.nombre,c.texto,c.fecha,n.titulo AS noticia_titulo,n.slug AS noticia_slug FROM comentarios c JOIN noticias n ON n.id=c.noticia_id ORDER BY c.fecha DESC LIMIT 50`); res.json({success:true,comentarios:r.rows}); } catch(e) { res.status(500).json({success:false,error:e.message}); } });
app.post('/api/comentarios/eliminar/:id',authMiddleware,async(req,res)=>{ if (req.body.pin!=='311') return res.status(403).json({error:'PIN'}); try { await pool.query('DELETE FROM comentarios WHERE id=$1',[parseInt(req.params.id)]); res.json({success:true}); } catch(e) { res.status(500).json({success:false,error:e.message}); } });
app.get('/api/comentarios/:noticia_id',async(req,res)=>{ try { const r=await pool.query('SELECT id,nombre,texto,fecha FROM comentarios WHERE noticia_id=$1 AND aprobado=true ORDER BY fecha ASC',[req.params.noticia_id]); res.json({success:true,comentarios:r.rows}); } catch(e) { res.status(500).json({success:false,error:e.message}); } });
app.post('/api/comentarios/:noticia_id',async(req,res)=>{ const{nombre,texto}=req.body; const nid=parseInt(req.params.noticia_id); if (isNaN(nid)||nid<=0) return res.status(400).json({success:false,error:'ID invalido'}); if (!nombre?.trim()||!texto?.trim()) return res.status(400).json({success:false,error:'Faltan datos'}); if (texto.trim().length>1000) return res.status(400).json({success:false,error:'Muy largo'}); try { const r=await pool.query('INSERT INTO comentarios(noticia_id,nombre,texto) VALUES($1,$2,$3) RETURNING id,nombre,texto,fecha',[nid,nombre.trim().substring(0,80),texto.trim().substring(0,1000)]); res.json({success:true,comentario:r.rows[0]}); } catch(e) { res.status(500).json({success:false,error:e.message}); } });

app.get('/api/configuracion',(req,res)=>{ try { const p=path.join(__dirname,'config.json'); const c=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{googleAnalytics:''}; res.json({success:true,config:c}); } catch (_) { res.json({success:true,config:{googleAnalytics:''}}); } });
app.post('/api/configuracion',express.json(),(req,res)=>{ if (req.body.pin!=='311') return res.status(403).json({success:false,error:'PIN'}); try { fs.writeFileSync(path.join(__dirname,'config.json'),JSON.stringify({googleAnalytics:req.body.googleAnalytics||''},null,2)); res.json({success:true}); } catch(e) { res.status(500).json({success:false,error:e.message}); } });
app.post('/api/publicar',express.json(),async(req,res)=>{ const{pin,titulo,seccion,contenido,redactor:red}=req.body; if (pin!=='311') return res.status(403).json({success:false,error:'PIN'}); if (!titulo||!seccion||!contenido) return res.status(400).json({success:false,error:'Faltan campos'}); try { const sl=slugify(titulo); const ex=await pool.query('SELECT id FROM noticias WHERE slug=$1',[sl]); const slF=ex.rows.length?`${sl}-${Date.now()}`:sl; await pool.query(`INSERT INTO noticias(titulo,slug,seccion,contenido,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[titulo,slF,seccion,contenido,red||'Manual',`${PB}/3182812/pexels-photo-3182812.jpeg?auto=compress&cs=tinysrgb&w=900&fit=crop`,`${titulo} - noticias RD El Farol al Dia`,`Fotografia: ${titulo}`,'efd.jpg','el-farol','publicada']); res.json({success:true,slug:slF}); } catch(e) { res.status(500).json({success:false,error:e.message}); } });

app.get('/api/admin/config',authMiddleware,(req,res)=>{ if (req.query.pin!=='311') return res.status(403).json({error:'Acceso denegado'}); res.json(CONFIG_IA); });
app.post('/api/admin/config',authMiddleware,express.json(),async(req,res)=>{ const{pin,enabled,instruccion_principal,tono,extension,evitar,enfasis}=req.body; if (pin!=='311') return res.status(403).json({error:'Acceso denegado'}); if (enabled!==undefined) CONFIG_IA.enabled=enabled; if (instruccion_principal) CONFIG_IA.instruccion_principal=instruccion_principal; if (tono) CONFIG_IA.tono=tono; if (extension) CONFIG_IA.extension=extension; if (evitar) CONFIG_IA.evitar=evitar; if (enfasis) CONFIG_IA.enfasis=enfasis; const ok=await guardarConfigIA(CONFIG_IA); res.json({success:ok}); });

app.get('/api/wikipedia',async(req,res)=>{ const{tema,categoria}=req.query; if (!tema) return res.status(400).json({error:'Falta tema'}); const ctx=await buscarContextoWikipedia(tema,categoria||'Nacionales'); res.json({success:true,longitud:ctx.length,contexto:ctx}); });

app.get('/api/seo',authMiddleware,async(req,res)=>{ if (req.query.pin!=='311') return res.status(403).json({error:'PIN'}); try { const r=await pool.query(`SELECT id,titulo,seccion,vistas,contenido FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 20`); const analisis=r.rows.map(n=>{ const sT=analizarSEOTitulo(n.titulo); const sC=analizarSEOContenido(n.contenido); return{id:n.id,titulo:n.titulo,seccion:n.seccion,vistas:n.vistas,seo_titulo:sT,seo_contenido:{score:sC.score,palabras:sC.palabras},score_total:Math.round((sT.score+sC.score)/2)}; }); const promedio=analisis.length?Math.round(analisis.reduce((s,a)=>s+a.score_total,0)/analisis.length):0; res.json({success:true,promedio_seo:promedio,analisis}); } catch(e) { res.status(500).json({success:false,error:e.message}); } });

app.get('/noticia/:slug',async(req,res)=>{
    try {
        const r=await pool.query('SELECT * FROM noticias WHERE slug=$1 AND estado=$2',[req.params.slug,'publicada']);
        if (!r.rows.length) return res.status(404).send('Noticia no encontrada');
        const n=r.rows[0]; await pool.query('UPDATE noticias SET vistas=vistas+1 WHERE id=$1',[n.id]);
        try {
            let html=fs.readFileSync(path.join(__dirname,'client','noticia.html'),'utf8');
            const urlN=`${BASE_URL}/noticia/${n.slug}`;
            const cHTML=n.contenido.split('\n').filter(p=>p.trim()).map(p=>`<p>${p.trim()}</p>`).join('');
            html=html.replace('<!-- META_TAGS -->',metaTagsCompletos(n,urlN)).replace(/{{TITULO}}/g,esc(n.titulo)).replace(/{{CONTENIDO}}/g,cHTML).replace(/{{FECHA}}/g,new Date(n.fecha).toLocaleDateString('es-DO',{year:'numeric',month:'long',day:'numeric'})).replace(/{{IMAGEN}}/g,n.imagen).replace(/{{ALT}}/g,esc(n.imagen_alt||n.titulo)).replace(/{{VISTAS}}/g,n.vistas).replace(/{{REDACTOR}}/g,esc(n.redactor)).replace(/{{SECCION}}/g,esc(n.seccion)).replace(/{{URL}}/g,encodeURIComponent(urlN));
            res.setHeader('Content-Type','text/html;charset=utf-8'); res.setHeader('Cache-Control','public,max-age=1800,stale-while-revalidate=3600'); res.send(html);
        } catch (_) { res.json({success:true,noticia:n}); }
    } catch(e) { res.status(500).send('Error interno'); }
});

app.get('/sitemap.xml',async(req,res)=>{ try { const r=await pool.query("SELECT slug,fecha FROM noticias WHERE estado='publicada' ORDER BY fecha DESC"); const now=Date.now(); let xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">\n'; xml+=`<url><loc>${BASE_URL}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>\n`; for (const n of r.rows) { const d=(now-new Date(n.fecha).getTime())/86400000; const freq=d<1?'hourly':d<7?'daily':'weekly'; const pri=d<1?'1.0':d<7?'0.9':d<30?'0.7':'0.5'; xml+=`<url><loc>${BASE_URL}/noticia/${n.slug}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><changefreq>${freq}</changefreq><priority>${pri}</priority></url>\n`; } xml+='</urlset>'; res.header('Content-Type','application/xml'); res.header('Cache-Control','public,max-age=7200'); res.send(xml); } catch(e) { res.status(500).send('Error'); } });
app.get('/robots.txt',(_,res)=>{ res.header('Content-Type','text/plain'); res.send(`User-agent: *\nAllow: /\nDisallow: /api/admin\nDisallow: /redaccion\n\nUser-agent: Googlebot\nAllow: /\nCrawl-delay: 1\n\nSitemap: ${BASE_URL}/sitemap.xml`); });
app.get('/ads.txt',(_,res)=>{ res.header('Content-Type','text/plain'); res.send('google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0\n'); });

app.get('/status',async(req,res)=>{ try { const r=await pool.query("SELECT COUNT(*) FROM noticias WHERE estado='publicada'"); const rss=await pool.query('SELECT COUNT(*) FROM rss_procesados'); res.json({status:'OK',version:'34.51',modelo_gemini:GEMINI_MODEL,timeout_gemini:`${GEMINI_TIMEOUT/1000}s`,noticias:parseInt(r.rows[0].count),rss_procesados:parseInt(rss.rows[0].count),marca_de_agua:WATERMARK_PATH?`Activa: ${path.basename(WATERMARK_PATH)}`:'No encontrada',gemini_keys:GEMINI_KEYS.length,google_cse:(process.env.GOOGLE_CSE_KEY&&process.env.GOOGLE_CSE_ID)?'Activo':'Sin configurar',adsense:'pub-5280872495839888',ia_activa:CONFIG_IA.enabled,modo_espejo:MODO_ESPEJO,rss_en_proceso:rssEnProceso,salud:{errores_gemini:SALUD.erroresGemini,errores_imagen:SALUD.erroresImagen,ciclos_rss_vacios:SALUD.rssVaciosCiclos,min_sin_publicar:Math.round((Date.now()-SALUD.ultimaPublicacion)/60000)}}); } catch(e) { res.status(500).json({error:e.message}); } });

app.use((req,res)=>res.sendFile(path.join(__dirname,'client','index.html')));

async function iniciar() {
    await inicializarBase();
    app.listen(PORT,'0.0.0.0',()=>{
        const wm=WATERMARK_PATH?path.basename(WATERMARK_PATH):'NO ENCONTRADO';
        console.log(`
╔═══════════════════════════════════════════════════════╗
║        🏮  EL FAROL AL DIA  —  V34.51               ║
╠═══════════════════════════════════════════════════════╣
║  Puerto         : ${String(PORT).padEnd(35)}║
║  Modelo Gemini  : ${GEMINI_MODEL.padEnd(35)}║
║  Gemini Keys    : ${String(GEMINI_KEYS.length+' key(s)').padEnd(35)}║
║  Timeout IA     : ${(GEMINI_TIMEOUT/1000+'s').padEnd(35)}║
║  Watermark      : ${wm.substring(0,35).padEnd(35)}║
╚═══════════════════════════════════════════════════════╝`);
    });
    setTimeout(refrescarPalabrasAprendidas,3000);
    setTimeout(async()=>{ console.log('[Arranque] Verificando fotos...'); await regenerarWatermarksLostidos(); },10000);
}

iniciar();
module.exports=app;
