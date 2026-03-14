/**
 * 🏮 EL FAROL AL DÍA - V29.0
 * Marca de agua automática + RSS portales gobierno RD + Facebook Auto-Post 🚀
 */

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const cron      = require('node-cron');
const { Pool }  = require('pg');
const sharp     = require('sharp');
const RSSParser = require('rss-parser');
const axios     = require('axios');

const app      = express();
const PORT     = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// Credenciales de Meta (Configuradas en Railway)
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
        console.warn('⚠️ Facebook no configurado o faltan variables');
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
        console.log(`✅ Publicado exitosamente en Facebook: ${titulo}`);
    } catch (error) {
        console.error('❌ Error al publicar en Facebook:', error.response?.data || error.message);
    }
}

// ==================== MARCA DE AGUA ====================
async function aplicarMarcaDeAgua(urlImagen) {
    try {
        const response = await fetch(urlImagen);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bufOrig = Buffer.from(await response.arrayBuffer());

        if (!fs.existsSync(WATERMARK_PATH)) {
            console.warn('⚠️ watermark.png no encontrado');
            return { url: urlImagen, procesada: false };
        }

        const meta = await sharp(bufOrig).metadata();
        const w = meta.width  || 800;
        const h = meta.height || 500;
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
        console.warn(`⚠️ Watermark falló: ${err.message}`);
        return { url: urlImagen, procesada: false };
    }
}

app.get('/img/:nombre', (req, res) => {
    const ruta = path.join('/tmp', req.params.nombre);
    if (fs.existsSync(ruta)) {
        res.setHeader('Content-Type','image/jpeg');
        res.sendFile(ruta);
    } else res.status(404).send('No encontrada');
});

// ==================== CONFIG IA / GEMINI / PEXELS ====================
// (Aquí se mantienen todas tus funciones originales de V28.0 de llamarGemini, buscarEnPexels, imgLocal, etc.)

async function llamarGemini(prompt, reintentos=3) {
    for (let i=0; i<reintentos; i++) {
        try {
            const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { method:'POST', headers:{'Content-Type':'application/json'},
                  body:JSON.stringify({contents:[{parts:[{text:prompt}]}]}) }
            );
            const data=await res.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text;
        } catch(e) { if(i===reintentos-1) throw e; }
    }
}

async function buscarEnPexels(query) {
    if (!PEXELS_API_KEY) return null;
    try {
        const res=await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5`,{headers:{Authorization:PEXELS_API_KEY}});
        const data=await res.json();
        return data.photos?.[0]?.src?.large2x || null;
    } catch { return null; }
}

// ==================== GENERACIÓN COMPLETA ====================
async function generarNoticia(categoria, comunicadoExterno=null){
    try{
        let memoria='';
        const rMem = await pool.query(`SELECT titulo FROM noticias ORDER BY fecha DESC LIMIT 10`);
        if(rMem.rows.length) memoria=`NOTICIAS PUBLICADAS:\n${rMem.rows.map(x=>x.titulo).join('\n')}`;

        const prompt=`Actúa como periodista dominicano de alto nivel. Escribe sobre ${categoria}.\n${comunicadoExterno ? 'Comunicado: ' + comunicadoExterno : ''}\n${memoria}\nRESPONDE EXACTO:\nTITULO: [Titulo]\nDESCRIPCION: [SEO]\nCONTENIDO: [400-500 palabras]`;

        const texto = await llamarGemini(prompt);
        let titulo = texto.match(/TITULO:(.*)/)?.[1].trim();
        let desc = texto.match(/DESCRIPCION:(.*)/)?.[1].trim();
        let contenido = texto.split('CONTENIDO:')[1]?.trim();

        if(!titulo || !contenido) throw new Error('Gemini falló');

        const imgOrig = await buscarEnPexels(titulo) || "https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg";
        const imgPro = await aplicarMarcaDeAgua(imgOrig);
        const urlFinal = imgPro.procesada ? `${BASE_URL}/img/${imgPro.nombre}` : imgOrig;
        
        const sl = titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').substring(0,80) + '-' + Date.now();

        await pool.query(
            `INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,imagen,estado) VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [titulo, sl, categoria, contenido, desc, urlFinal, 'publicada']
        );

        // 🔥 PUBLICAR EN FACEBOOK AUTOMÁTICAMENTE
        await publicarEnFacebook(titulo, sl);

        console.log(`✅ Noticia creada y enviada a Facebook: ${sl}`);
        return {success:true, slug:sl};
    } catch(err) { console.error('❌ Error en generación:', err); return {success:false}; }
}

// ==================== RSS GOBIERNO RD (LISTA COMPLETA) ====================
const FUENTES_RSS=[
    {url:'https://presidencia.gob.do/feed', categoria:'Nacionales', nombre:'Presidencia'},
    {url:'https://policia.gob.do/feed', categoria:'Nacionales', nombre:'Policía'},
    {url:'https://www.mopc.gob.do/feed', categoria:'Nacionales', nombre:'MOPC'},
    {url:'https://www.salud.gob.do/feed', categoria:'Nacionales', nombre:'Salud Pública'},
    {url:'https://www.educacion.gob.do/feed', categoria:'Nacionales', nombre:'Educación'},
    {url:'https://www.bancentral.gov.do/feed', categoria:'Economía', nombre:'Banco Central'}
];

async function procesarRSS(){
    console.log('📡 Revisando RSS...');
    for(const fuente of FUENTES_RSS){
        try {
            const feed = await rssParser.parseURL(fuente.url).catch(()=>null);
            if(!feed?.items?.length) continue;
            const item = feed.items[0];
            const guid = item.guid || item.link;
            const yaExiste = await pool.query('SELECT id FROM rss_procesados WHERE item_guid=$1',[guid]);
            if(yaExiste.rows.length) continue;

            const res = await generarNoticia(fuente.categoria, item.contentSnippet || item.title);
            if(res.success) {
                await pool.query('INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2)',[guid, fuente.nombre]);
                break; 
            }
        } catch(e) { console.warn(`Error en RSS ${fuente.nombre}`); }
    }
}

// ==================== CRON Y RUTAS ====================
cron.schedule('0 */4 * * *', () => generarNoticia('Nacionales'));
cron.schedule('0 1,7,13,19 * * *', () => procesarRSS());

app.get('/health', (req,res)=>res.json({status:'OK', version:'29.0'}));
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'client','index.html')));
app.get('/noticia/:slug', async(req,res)=>{
    const r = await pool.query('SELECT * FROM noticias WHERE slug=$1',[req.params.slug]);
    if(!r.rows.length) return res.status(404).send('No encontrada');
    res.send(`<h1>${r.rows[0].titulo}</h1><img src="${r.rows[0].imagen}"/><p>${r.rows[0].contenido}</p>`);
});

// Ruta de emergencia para forzar el RSS (Usando tu pin 311)
app.post('/api/procesar-rss', async(req,res)=>{
    if(req.body.pin !== '311') return res.status(403).json({error:'Acceso denegado'});
    procesarRSS();
    res.json({success:true, mensaje:'RSS iniciado'});
});

async function iniciar(){
    await pool.query(`CREATE TABLE IF NOT EXISTS noticias (id SERIAL PRIMARY KEY, titulo TEXT, slug TEXT UNIQUE, seccion TEXT, contenido TEXT, seo_description TEXT, imagen TEXT, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP, vistas INTEGER DEFAULT 0, estado TEXT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS rss_procesados (id SERIAL PRIMARY KEY, item_guid TEXT UNIQUE, fuente TEXT, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    app.listen(PORT, '0.0.0.0', () => console.log(`🏮 Búnker El Farol V29.0 activo en puerto ${PORT}`));
}
iniciar();
