/**
 * 🏮 EL FAROL AL DÍA - V29.0
 * Marca de agua automática + RSS portales gobierno RD + Facebook Auto-Post
 */

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const cron      = require('node-cron');
const { Pool }  = require('pg');
const sharp     = require('sharp');
const RSSParser = require('rss-parser');
const axios     = require('axios'); // Para Facebook

const app      = express();
const PORT     = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// Variables de Facebook
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;

if (!process.env.DATABASE_URL)   { console.error('❌ DATABASE_URL requerido');  process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY requerido'); process.exit(1); }

const PEXELS_API_KEY = process.env.PEXELS_API_KEY || null;
const rssParser      = new RSSParser({ timeout: 10000 });
const WATERMARK_PATH = path.join(__dirname, 'static', 'watermark.png');

// ==================== BD ====================
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/static', express.static(path.join(__dirname, 'static'), {
    setHeaders: (res) => res.setHeader('Cache-Control','public,max-age=2592000,immutable')
}));
app.use(express.static(path.join(__dirname, 'client'), {
    setHeaders: (res, fp) => {
        if (/\.(jpg|jpeg|png|gif|webp|ico|svg)$/i.test(fp)) res.setHeader('Cache-Control','public,max-age=2592000,immutable');
        else if (/\.(css|js)$/i.test(fp))                   res.setHeader('Cache-Control','public,max-age=86400');
    }
}));
app.use(cors());

// ==================== FUNCIÓN FACEBOOK ====================
async function publicarEnFacebook(titulo, slug) {
    if (!FB_PAGE_ID || !FB_PAGE_TOKEN) {
        console.log('⚠️ Facebook no configurado');
        return;
    }
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        await axios.post(`https://graph.facebook.com/v21.0/${FB_PAGE_ID}/feed`, {
            message: `🏮 NOTICIA DE ÚLTIMA HORA: ${titulo}\n\nLee más aquí 👇`,
            link: urlNoticia,
            access_token: FB_PAGE_TOKEN
        });
        console.log('✅ Publicado en Facebook correctamente');
    } catch (err) {
        console.error('❌ Error en Facebook:', err.response?.data || err.message);
    }
}

// ==================== MARCA DE AGUA ====================
async function aplicarMarcaDeAgua(urlImagen) {
    try {
        const response = await fetch(urlImagen);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bufOrig = Buffer.from(await response.arrayBuffer());

        if (!fs.existsSync(WATERMARK_PATH)) {
            console.warn('   ⚠️ watermark.png no encontrado');
            return { url: urlImagen, procesada: false };
        }

        const meta   = await sharp(bufOrig).metadata();
        const w      = meta.width  || 800;
        const h      = meta.height || 500;
        const wmAncho = Math.min(Math.round(w * 0.28), 300);

        const wmResized = await sharp(WATERMARK_PATH)
            .resize(wmAncho, null, { fit:'inside' })
            .toBuffer();

        const wmMeta = await sharp(wmResized).metadata();
        const wmAlto = wmMeta.height || 60;
        const margen = Math.round(w * 0.02);

        const bufFinal = await sharp(bufOrig)
            .composite([{
                input: wmResized,
                left:  Math.max(0, w - wmAncho - margen),
                top:   Math.max(0, h - wmAlto  - margen),
                blend: 'over'
            }])
            .jpeg({ quality: 88 })
            .toBuffer();

        const nombre  = `efd-${Date.now()}-${Math.random().toString(36).substring(2,8)}.jpg`;
        const rutaTmp = path.join('/tmp', nombre);
        fs.writeFileSync(rutaTmp, bufFinal);
        return { url: urlImagen, rutaTmp, nombre, procesada: true };

    } catch(err) {
        console.warn(`   ⚠️ Watermark falló: ${err.message}`);
        return { url: urlImagen, procesada: false };
    }
}

app.get('/img/:nombre', (req, res) => {
    const ruta = path.join('/tmp', req.params.nombre);
    if (fs.existsSync(ruta)) {
        res.setHeader('Content-Type','image/jpeg');
        res.setHeader('Cache-Control','public,max-age=604800');
        res.sendFile(ruta);
    } else {
        res.status(404).send('No encontrada');
    }
});

// ==================== CONFIG IA / GEMINI / PEXELS ====================
const CONFIG_IA_PATH = path.join(__dirname, 'config-ia.json');

function cargarConfigIA() {
    const def = {
        enabled: true,
        instruccion_principal: 'Eres un periodista profesional dominicano de alto nivel, con visión nacional e internacional...',
        tono: 'profesional', extension: 'media',
        enfasis: 'Si la noticia es nacional: prioriza SDE, Los Mina, Invivienda, Ensanche Ozama...',
        evitar: 'Limitar el tema solo a Santo Domingo Este. Especulación sin fuentes.'
    };
    try { if (fs.existsSync(CONFIG_IA_PATH)) return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_IA_PATH,'utf8')) }; }
    catch(e) {}
    return def;
}
let CONFIG_IA = cargarConfigIA();

async function llamarGemini(prompt, reintentos=3) {
    for (let i=0; i<reintentos; i++) {
        try {
            const res=await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { method:'POST', headers:{'Content-Type':'application/json'},
                  body:JSON.stringify({contents:[{parts:[{text:prompt}]}]}) }
            );
            const data=await res.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text;
        } catch(err){ if (i===reintentos-1) throw err; }
    }
}

async function buscarEnPexels(query) {
    if (!PEXELS_API_KEY) return null;
    try {
        const res=await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5`,{headers:{Authorization:PEXELS_API_KEY}});
        const data=await res.json();
        return data.photos?.[0]?.src?.large2x ||
