/**
 * 🏮 EL FAROL AL DÍA - V29.0
 * Marca de agua + RSS Gobierno + Facebook Auto-Post 🚀
 */

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const cron      = require('node-cron');
const { Pool }  = require('pg');
const sharp     = require('sharp');
const RSSParser = require('rss-parser');
const axios     = require('axios'); // Para Facebook API

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
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ==================== FACEBOOK AUTO-POST ====================
async function publicarEnFacebook(titulo, slug) {
    if (!FB_PAGE_ID || !FB_PAGE_TOKEN) {
        console.warn('⚠️ Facebook no configurado (faltan variables)');
        return;
    }
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const fbUrl = `https://graph.facebook.com/v21.0/${FB_PAGE_ID}/feed`;
        
        await axios.post(fbUrl, {
            message: `🏮 NOTICIA DE ÚLTIMA HORA: ${titulo}\n\nLee más aquí 👇`,
            link: urlNoticia,
            access_token: FB_PAGE_TOKEN
        });
        console.log(`🚀 Publicado en Facebook: ${titulo}`);
    } catch (error) {
        console.error('❌ Error Facebook:', error.response?.data || error.message);
    }
}

// ==================== MARCA DE AGUA ====================
async function aplicarMarcaDeAgua(urlImagen) {
    try {
        const response = await fetch(urlImagen);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bufOrig = Buffer.from(await response.arrayBuffer());

        if (!fs.existsSync(WATERMARK_PATH)) return { url: urlImagen, procesada: false };

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

        const nombre  = `efd-${Date.now()}.jpg`;
        const rutaTmp = path.join('/tmp', nombre);
        fs.writeFileSync(rutaTmp, bufFinal);
        return { url: urlImagen, rutaTmp, nombre, procesada: true };
    } catch(err) { return { url: urlImagen, procesada: false }; }
}

app.get('/img/:nombre', (req, res) => {
    const ruta = path.join('/tmp', req.params.nombre);
    if (fs.existsSync(ruta)) {
        res.setHeader('Content-Type','image/jpeg');
        res.sendFile(ruta);
    } else res.status(404).send('No encontrada');
});

// ==================== CONFIG IA ====================
const CONFIG_IA_PATH = path.join(__dirname, 'config-ia.json');
function cargarConfigIA() {
    const def = { enabled: true, instruccion_principal: 'Eres un periodista profesional dominicano...', tono: 'profesional', extension: 'media', enfasis: 'Prioriza SDE y RD.', evitar: 'Sensacionalismo.' };
    try { if (fs.existsSync(CONFIG_IA_PATH)) return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_IA_PATH,'utf8')) }; } catch(e) {}
    return def;
}
let CONFIG_IA = cargarConfigIA();

// ==================== GEMINI ====================
async function llamarGemini(prompt) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})
    });
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
}

// ==================== IMÁGENES ====================
async function buscarEnPexels(query) {
    if (!PEXELS_API_KEY) return null;
    try {
        const res=await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`,{headers:{Authorization:PEXELS_API_KEY}});
        const data=await res.json();
        return data.photos?.[0]?.src?.large2x || null;
    } catch { return null; }
}

// ==================== GENERACIÓN Y PUBLICACIÓN ====================
async function generarNoticia(categoria, comunicadoExterno=null){
    try{
        if(!CONFIG_IA.enabled) return {success:false};
        const prompt = `Actúa como periodista dominicano. Escribe una noticia sobre ${categoria}. ${comunicadoExterno ? 'Usa este comunicado: ' + comunicadoExterno : ''} 
        Responde EXACTO:
        TITULO: [Título corto]
        DESCRIPCION: [Resumen SEO]
        CONTENIDO: [Cuerpo de la noticia]`;

        const texto = await llamarGemini(prompt);
        let titulo = texto.match(/TITULO:(.*)/)?.[1].trim();
        let contenido = texto.split('CONTENIDO:')[1]?.trim();
        if(!titulo || !contenido) return {success:false};

        const imgOrig = await buscarEnPexels(titulo) || "https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg";
        const imgProcesada = await aplicarMarcaDeAgua(imgOrig);
        const urlFinal = imgProcesada.procesada ? `${BASE_URL}/img/${imgProcesada.nombre}` : imgOrig;
        
        const sl = titulo.toLowerCase().replace(/ /g,'-').replace(/[^\w-]+/g,'');
        
        await pool.query(
            `INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,imagen,estado) VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [titulo, sl, categoria, contenido, titulo, urlFinal, 'publicada']
        );

        // 🔥 ESTO PUBLICA EN FACEBOOK AUTOMÁTICAMENTE
        await publicarEnFacebook(titulo, sl);

        return {success:true, slug:sl};
    } catch(e) { console.error(e); return {success:false}; }
}

// ==================== RSS GOBIERNO ====================
const FUENTES_RSS=[
    {url:'https://presidencia.gob.do/feed', categoria:'Nacionales', nombre:'Presidencia'},
    {url:'https://policia.gob.do/feed', categoria:'Nacionales', nombre:'Policía'}
];

async function procesarRSS(){
    for(const fuente of FUENTES_RSS){
        const feed = await rssParser.parseURL(fuente.url).catch(()=>null);
        if(feed?.items?.length){
            const item = feed.items[0];
            const guid = item.guid || item.link;
            const existe = await pool.query('SELECT id FROM rss_procesados WHERE item_guid=$1',[guid]);
            if(existe.rows.length === 0){
                const ok = await generarNoticia(fuente.categoria, item.contentSnippet || item.title);
                if(ok.success) await pool.query('INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2)',[guid, fuente.nombre]);
                break; 
            }
        }
    }
}

// ==================== CRONS ====================
cron.schedule('0 */4 * * *', () => generarNoticia('Nacionales')); // Cada 4 horas una noticia al azar
cron.schedule('0 1,7,13,19 * * *', () => procesarRSS()); // RSS en horarios clave

// ==================== RUTAS ====================
app.get('/', (req,res)=>res.send('🏮 El Farol al Día V29.0 - Búnker Online'));
app.get('/privacidad', (req,res)=>res.send('<h1>Privacidad</h1><p>No usamos tus datos.</p>'));
app.get('/terminos', (req,res)=>res.send('<h1>Términos</h1><p>Noticias para RD.</p>'));

app.get('/noticia/:slug', async(req,res)=>{
    const r = await pool.query('SELECT * FROM noticias WHERE slug=$1',[req.params.slug]);
    if(!r.rows.length) return res.status(404).send('No encontrada');
    res.send(`<h1>${r.rows[0].titulo}</h1><img src="${r.rows[0].imagen}"/><p>${r.rows[0].contenido}</p>`);
});

// Ruta manual para probar
app.post('/api/generar-noticia', async(req,res)=>{
    const r = await generarNoticia(req.body.categoria || 'Nacionales');
    res.json(r);
});

async function iniciar(){
    await pool.query(`CREATE TABLE IF NOT EXISTS noticias (id SERIAL PRIMARY KEY, titulo TEXT, slug TEXT UNIQUE, seccion TEXT, contenido TEXT, seo_description TEXT, imagen TEXT, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP, vistas INTEGER DEFAULT 0, estado TEXT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS rss_procesados (id SERIAL PRIMARY KEY, item_guid TEXT UNIQUE, fuente TEXT, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    app.listen(PORT, '0.0.0.0', () => console.log(`🏮 Búnker V29.0 activo en puerto ${PORT}`));
}
iniciar();
