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
const axios     = require('axios'); // <-- NUEVO: Axios para Facebook

const app      = express();
const PORT     = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// Validaciones de entorno
if (!process.env.DATABASE_URL)   { console.error('❌ DATABASE_URL requerido');  process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY requerido'); process.exit(1); }
// NUEVO: Validar credenciales de Facebook (pero no son fatales, solo advierte)
if (!process.env.FB_PAGE_ID || !process.env.FB_PAGE_TOKEN) {
    console.warn('⚠️  FB_PAGE_ID o FB_PAGE_TOKEN no configurados. La publicación en Facebook estará deshabilitada.');
}

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
        console.log(`   🏮 Marca de agua: ${nombre}`);
        return { url: urlImagen, rutaTmp, nombre, procesada: true };

    } catch(err) {
        console.warn(`   ⚠️ Watermark falló: ${err.message}`);
        return { url: urlImagen, procesada: false };
    }
}

// Servir imágenes con marca de agua desde /tmp
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

// ==================== CONFIG IA ====================
const CONFIG_IA_PATH = path.join(__dirname, 'config-ia.json');

function cargarConfigIA() {
    const def = {
        enabled: true,
        instruccion_principal: 'Eres un periodista profesional dominicano de alto nivel, con visión nacional e internacional. Escribes noticias verificadas, equilibradas y con impacto real. Cubres República Dominicana completa, el Caribe, Latinoamérica y el mundo. Cuando la noticia tiene conexión con Santo Domingo Este o RD, lo destacas con contexto local.',
        tono: 'profesional', extension: 'media',
        enfasis: 'Si la noticia es nacional: prioriza SDE, Los Mina, Invivienda, Ensanche Ozama. Si es internacional: conecta con el impacto en República Dominicana y el Caribe.',
        evitar: 'Limitar el tema solo a Santo Domingo Este. Especulación sin fuentes. Titulares sensacionalistas. Repetir noticias ya publicadas.'
    };
    try { if (fs.existsSync(CONFIG_IA_PATH)) return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_IA_PATH,'utf8')) }; }
    catch(e) {}
    fs.writeFileSync(CONFIG_IA_PATH, JSON.stringify(def,null,2));
    return def;
}
function guardarConfigIA(c) { try { fs.writeFileSync(CONFIG_IA_PATH,JSON.stringify(c,null,2)); return true; } catch(e){ return false; } }
let CONFIG_IA = cargarConfigIA();

// ==================== GEMINI ====================
const GS = { lastRequest:0, resetTime:0 };

async function llamarGemini(prompt, reintentos=3) {
    for (let i=0; i<reintentos; i++) {
        try {
            console.log(`   🤖 Gemini (intento ${i+1})`);
            const ahora=Date.now();
            if (ahora<GS.resetTime) await new Promise(r=>setTimeout(r,Math.min(GS.resetTime-ahora,10000)));
            const desde=Date.now()-GS.lastRequest;
            if (desde<3000) await new Promise(r=>setTimeout(r,3000-desde));
            GS.lastRequest=Date.now();
            const res=await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { method:'POST', headers:{'Content-Type':'application/json'},
                  body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.8,maxOutputTokens:2500}}) }
            );
            if (res.status===429){ GS.resetTime=Date.now()+Math.pow(2,i)*5000; await new Promise(r=>setTimeout(r,GS.resetTime-Date.now())); continue; }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data=await res.json();
            const texto=data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!texto) throw new Error('vacía');
            console.log(`   ✅ Gemini OK`);
            return texto;
        } catch(err){
            console.error(`   ❌ ${i+1}: ${err.message}`);
            if (i<reintentos-1) await new Promise(r=>setTimeout(r,Math.pow(2,i)*3000));
        }
    }
    throw new Error('Gemini no respondió');
}

// ==================== PEXELS ====================
async function buscarEnPexels(query) {
    if (!PEXELS_API_KEY) return null;
    try {
        const res=await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=10&orientation=landscape`,{headers:{Authorization:PEXELS_API_KEY}});
        if (!res.ok) return null;
        const data=await res.json();
        if (!data.photos?.length) return null;
        const foto=data.photos.slice(0,5)[Math.floor(Math.random()*Math.min(5,data.photos.length))];
        console.log(`   ✅ Pexels: "${query}"`);
        return foto.src.large2x||foto.src.large||foto.src.original;
    } catch { return null; }
}

// ==================== BANCO LOCAL ====================
const PB='https://images.pexels.com/photos', OPT='?auto=compress&cs=tinysrgb&w=800';
const BANCO_LOCAL={
    'politica-gobierno':          [`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`,`${PB}/290595/pexels-photo-290595.jpeg${OPT}`,`${PB}/3616480/pexels-photo-3616480.jpeg${OPT}`,`${PB}/3183150/pexels-photo-3183150.jpeg${OPT}`],
    'seguridad-policia':          [`${PB}/6261776/pexels-photo-6261776.jpeg${OPT}`,`${PB}/5699456/pexels-photo-5699456.jpeg${OPT}`,`${PB}/3807517/pexels-photo-3807517.jpeg${OPT}`,`${PB}/6980997/pexels-photo-6980997.jpeg${OPT}`],
    'relaciones-internacionales': [`${PB}/2860705/pexels-photo-2860705.jpeg${OPT}`,`${PB}/358319/pexels-photo-358319.jpeg${OPT}`,`${PB}/3407617/pexels-photo-3407617.jpeg${OPT}`,`${PB}/3997992/pexels-photo-3997992.jpeg${OPT}`],
    'economia-mercado':           [`${PB}/4386466/pexels-photo-4386466.jpeg${OPT}`,`${PB}/6772070/pexels-photo-6772070.jpeg${OPT}`,`${PB}/3532557/pexels-photo-3532557.jpeg${OPT}`,`${PB}/6801648/pexels-photo-6801648.jpeg${OPT}`],
    'infraestructura':            [`${PB}/1216589/pexels-photo-1216589.jpeg${OPT}`,`${PB}/323780/pexels-photo-323780.jpeg${OPT}`,`${PB}/2219024/pexels-photo-2219024.jpeg${OPT}`,`${PB}/3183197/pexels-photo-3183197.jpeg${OPT}`],
    'salud-medicina':             [`${PB}/3786157/pexels-photo-3786157.jpeg${OPT}`,`${PB}/40568/pexels-photo-40568.jpeg${OPT}`,`${PB}/4386467/pexels-photo-4386467.jpeg${OPT}`,`${PB}/1170979/pexels-photo-1170979.jpeg${OPT}`],
    'deporte-beisbol':            [`${PB}/1661950/pexels-photo-1661950.jpeg${OPT}`,`${PB}/209977/pexels-photo-209977.jpeg${OPT}`,`${PB}/248318/pexels-photo-248318.jpeg${OPT}`,`${PB}/1884574/pexels-photo-1884574.jpeg${OPT}`],
    'deporte-futbol':             [`${PB}/46798/pexels-photo-46798.jpeg${OPT}`,`${PB}/3621943/pexels-photo-3621943.jpeg${OPT}`,`${PB}/3873098/pexels-photo-3873098.jpeg${OPT}`,`${PB}/1884574/pexels-photo-1884574.jpeg${OPT}`],
    'deporte-general':            [`${PB}/863988/pexels-photo-863988.jpeg${OPT}`,`${PB}/936094/pexels-photo-936094.jpeg${OPT}`,`${PB}/2526878/pexels-photo-2526878.jpeg${OPT}`,`${PB}/3621943/pexels-photo-3621943.jpeg${OPT}`],
    'tecnologia':                 [`${PB}/3861958/pexels-photo-3861958.jpeg${OPT}`,`${PB}/2582937/pexels-photo-2582937.jpeg${OPT}`,`${PB}/5632399/pexels-photo-5632399.jpeg${OPT}`,`${PB}/3932499/pexels-photo-3932499.jpeg${OPT}`],
    'educacion':                  [`${PB}/256490/pexels-photo-256490.jpeg${OPT}`,`${PB}/289737/pexels-photo-289737.jpeg${OPT}`,`${PB}/1205651/pexels-photo-1205651.jpeg${OPT}`,`${PB}/4143791/pexels-photo-4143791.jpeg${OPT}`],
    'cultura-musica':             [`${PB}/1190297/pexels-photo-1190297.jpeg${OPT}`,`${PB}/1540406/pexels-photo-1540406.jpeg${OPT}`,`${PB}/3651308/pexels-photo-3651308.jpeg${OPT}`,`${PB}/2521317/pexels-photo-2521317.jpeg${OPT}`],
    'medio-ambiente':             [`${PB}/1108572/pexels-photo-1108572.jpeg${OPT}`,`${PB}/1366919/pexels-photo-1366919.jpeg${OPT}`,`${PB}/2559941/pexels-photo-2559941.jpeg${OPT}`,`${PB}/414612/pexels-photo-414612.jpeg${OPT}`],
    'turismo':                    [`${PB}/1450353/pexels-photo-1450353.jpeg${OPT}`,`${PB}/1174732/pexels-photo-1174732.jpeg${OPT}`,`${PB}/3601425/pexels-photo-3601425.jpeg${OPT}`,`${PB}/2104152/pexels-photo-2104152.jpeg${OPT}`],
    'emergencia':                 [`${PB}/1437862/pexels-photo-1437862.jpeg${OPT}`,`${PB}/263402/pexels-photo-263402.jpeg${OPT}`,`${PB}/3807517/pexels-photo-3807517.jpeg${OPT}`,`${PB}/3616480/pexels-photo-3616480.jpeg${OPT}`]
};
const FALLBACK_CAT={'Nacionales':'politica-gobierno','Deportes':'deporte-general','Internacionales':'relaciones-internacionales','Economía':'economia-mercado','Tecnología':'tecnologia','Espectáculos':'cultura-musica'};
function imgLocal(sub,cat){ const b=BANCO_LOCAL[sub]||BANCO_LOCAL[FALLBACK_CAT[cat]]||BANCO_LOCAL['politica-gobierno']; return b[Math.floor(Math.random()*b.length)]; }
async function obtenerImagen(titulo,cat,sub,query){ if(query){const u=await buscarEnPexels(query);if(u)return u;} const u2=await buscarEnPexels(`${cat} dominican republic`);if(u2)return u2; return imgLocal(sub,cat); }

// ==================== FACEBOOK AUTO-POST ====================
// NUEVA FUNCIÓN: Publica en la página de Facebook
async function publicarEnFacebook(titulo, descripcion, urlNoticia, imagenUrl) {
    // Si no hay credenciales, salir silenciosamente
    if (!process.env.FB_PAGE_ID || !process.env.FB_PAGE_TOKEN) {
        console.log('   📘 Facebook: Credenciales no configuradas, omitiendo publicación.');
        return false;
    }

    try {
        console.log(`   📘 Facebook: Publicando "${titulo.substring(0,50)}..."`);
        
        // Construir mensaje: Título + Descripción + Enlace
        // Facebook suele mostrar mejor el enlace si lo ponemos al final
        const mensaje = `${titulo}\n\n${descripcion.substring(0, 180)}...\n\n${urlNoticia}`;
        
        // Llamada a la API de Facebook (Graph API v22.0 - la última estable)
        const response = await axios.post(
            `https://graph.facebook.com/v22.0/${process.env.FB_PAGE_ID}/feed`,
            {
                message: mensaje,
                link: urlNoticia,
                access_token: process.env.FB_PAGE_TOKEN
                // Opcional: Si quieres forzar una imagen específica, puedes usar 'picture' y 'name', etc.
                // Pero con 'link' Facebook scrapea la página y saca la imagen automáticamente.
            },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000 // 10 segundos de timeout
            }
        );

        if (response.data && response.data.id) {
            console.log(`   ✅ Facebook: Publicado con éxito (ID: ${response.data.id})`);
            return true;
        } else {
            console.warn(`   ⚠️ Facebook: Respuesta inesperada:`, response.data);
            return false;
        }
    } catch (error) {
        // Manejo detallado de errores de Axios
        if (error.response) {
            // La API respondió con un error (ej. token inválido, permisos)
            console.error(`   ❌ Facebook Error ${error.response.status}:`, JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            // No hubo respuesta (problema de red)
            console.error(`   ❌ Facebook Error de red: No hubo respuesta de la API`);
        } else {
            // Error en la configuración de la petición
            console.error(`   ❌ Facebook Error:`, error.message);
        }
        return false;
    }
}

// ==================== SEO ====================
const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function metaTagsCompletos(n,url){
    const t=esc(n.titulo),d=esc(n.seo_description||''),k=esc(n.seo_keywords||'');
    const img=esc(n.imagen),red=esc(n.redactor),sec=esc(n.seccion);
    const fi=new Date(n.fecha).toISOString(),ue=esc(url);
    const wc=(n.contenido||'').split(/\s+/).filter(w=>w).length;
    const schema={"@context":"https://schema.org","@type":"NewsArticle","mainEntityOfPage":{"@type":"WebPage","@id":url},"headline":n.titulo,"description":n.seo_description||'',
        "image":{"@type":"ImageObject","url":n.imagen,"caption":n.imagen_caption||n.titulo,"width":1200,"height":630},
        "datePublished":fi,"dateModified":fi,"author":{"@type":"Person","name":n.redactor,"url":`${BASE_URL}/nosotros`},
        "publisher":{"@type":"Organization","name":"El Farol al Día","url":BASE_URL,"logo":{"@type":"ImageObject","url":`${BASE_URL}/static/favicon.png`}},
        "articleSection":n.seccion,"wordCount":wc,"inLanguage":"es-DO","isAccessibleForFree":true};
    const bread={"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
        {"@type":"ListItem","position":1,"name":"Inicio","item":BASE_URL},
        {"@type":"ListItem","position":2,"name":n.seccion,"item":`${BASE_URL}/#${(n.seccion||'').toLowerCase()}`},
        {"@type":"ListItem","position":3,"name":n.titulo,"item":url}]};
    return `<title>${t} | El Farol al Día</title>
<meta name="description" content="${d}"><meta name="keywords" content="${k}"><meta name="author" content="${red}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="${ue}"><link rel="alternate" hreflang="es-DO" href="${ue}"><link rel="alternate" hreflang="es" href="${ue}">
<meta property="og:type" content="article"><meta property="og:title" content="${t}"><meta property="og:description" content="${d}">
<meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(n.imagen_alt||n.titulo)}"><meta property="og:url" content="${ue}">
<meta property="og:site_name" content="El Farol al Día"><meta property="og:locale" content="es_DO">
<meta property="article:published_time" content="${fi}"><meta property="article:modified_time" content="${fi}">
<meta property="article:author" content="${red}"><meta property="article:section" content="${sec}"><meta property="article:tag" content="${k}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}"><meta name="twitter:image" content="${img}">
<meta name="twitter:image:alt" content="${esc(n.imagen_alt||n.titulo)}"><meta name="twitter:site" content="@elfarolaldia">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<script type="application/ld+json">${JSON.stringify(bread)}</script>`;
}

// ==================== UTILS ====================
function slug(t){return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').substring(0,80);}
const REDS=[{nombre:'Carlos Méndez',esp:'Nacionales'},{nombre:'Laura Santana',esp:'Deportes'},{nombre:'Roberto Peña',esp:'Internacionales'},{nombre:'Ana María Castillo',esp:'Economía'},{nombre:'José Miguel Fernández',esp:'Tecnología'},{nombre:'Patricia Jiménez',esp:'Espectáculos'}];
function redactor(cat){const m=REDS.filter(r=>r.esp===cat);return m.length?m[Math.floor(Math.random()*m.length)].nombre:'Redacción EFD';}

// ==================== BD INIT ====================
async function inicializarBase(){
    const client=await pool.connect();
    try{
        await client.query(`CREATE TABLE IF NOT EXISTS noticias (id SERIAL PRIMARY KEY,titulo VARCHAR(255) NOT NULL,slug VARCHAR(255) UNIQUE,seccion VARCHAR(100),contenido TEXT,seo_description VARCHAR(160),seo_keywords VARCHAR(255),redactor VARCHAR(100),imagen TEXT,imagen_alt VARCHAR(255),imagen_caption TEXT,imagen_nombre VARCHAR(100),imagen_fuente VARCHAR(50),vistas INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,estado VARCHAR(50) DEFAULT 'publicada')`);
        for(const col of['imagen_alt','imagen_caption','imagen_nombre','imagen_fuente']){
            await client.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='noticias' AND column_name='${col}') THEN ALTER TABLE noticias ADD COLUMN ${col} TEXT;END IF;END $$;`).catch(()=>{});
        }
        await client.query(`CREATE TABLE IF NOT EXISTS rss_procesados(id SERIAL PRIMARY KEY,item_guid VARCHAR(500) UNIQUE,fuente VARCHAR(100),fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        const fix=await client.query(`UPDATE noticias SET imagen='${PB}/3052454/pexels-photo-3052454.jpeg${OPT}',imagen_fuente='pexels' WHERE imagen LIKE '%/images/cache/%' OR imagen LIKE '%fallback%' OR imagen IS NULL OR imagen=''`);
        if(fix.rowCount>0) console.log(`🔧 Reparadas ${fix.rowCount} imágenes`);
        console.log('✅ BD lista');
    }catch(e){console.error('❌ BD:',e.message);}finally{client.release();}
}

// ==================== GENERACIÓN ====================
async function generarNoticia(categoria, comunicadoExterno=null){
    try{
        if(!CONFIG_IA.enabled) return{success:false,error:'IA desactivada'};
        let memoria='';
        try{
            const r=await pool.query(`SELECT titulo FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 10`);
            if(r.rows.length) memoria=`\nNOTICIAS YA PUBLICADAS — NO repetir:\n${r.rows.map((x,i)=>`${i+1}. ${x.titulo}`).join('\n')}\n`;
        }catch(e){}

        const fuenteContenido=comunicadoExterno
            ?`\nCOMUNICADO OFICIAL:\n"""\n${comunicadoExterno}\n"""\nRedacta una noticia profesional basada en este comunicado. Reescribe con tu estilo, no copies textualmente.`
            :`\nEscribe una noticia NUEVA sobre "${categoria}" para República Dominicana.`;

        const prompt=`${CONFIG_IA.instruccion_principal}
${memoria}
${fuenteContenido}
CATEGORÍA: ${categoria} | TONO: ${CONFIG_IA.tono} | EXTENSIÓN: 400-500 palabras | EVITAR: ${CONFIG_IA.evitar}
ÉNFASIS: ${CONFIG_IA.enfasis}

INSTRUCCIÓN DE IMAGEN: Genera QUERY_IMAGEN en inglés (2-4 palabras) y ALT_IMAGEN SEO en español (15-20 palabras).
Subtemas: ${Object.keys(BANCO_LOCAL).join(', ')}

RESPONDE EXACTAMENTE:
TITULO: [50-60 caracteres, sin asteriscos]
DESCRIPCION: [150-160 caracteres SEO]
PALABRAS: [5 palabras clave]
QUERY_IMAGEN: [inglés 2-4 palabras]
ALT_IMAGEN: [español SEO 15-20 palabras]
SUBTEMA_LOCAL: [un subtema]
CONTENIDO:
[400-500 palabras]`;

        console.log(`\n📰 Generando: ${categoria}${comunicadoExterno?' (RSS)':''}`);
        const texto=await llamarGemini(prompt);

        let titulo='',desc='',pals='',qi='',ai='',sub='',contenido='';
        let enC=false;const bl=[];
        for(const l of texto.split('\n')){
            const t=l.trim();
            if(t.startsWith('TITULO:'))        titulo=t.replace('TITULO:','').trim();
            else if(t.startsWith('DESCRIPCION:'))   desc=t.replace('DESCRIPCION:','').trim();
            else if(t.startsWith('PALABRAS:'))      pals=t.replace('PALABRAS:','').trim();
            else if(t.startsWith('QUERY_IMAGEN:'))  qi=t.replace('QUERY_IMAGEN:','').trim();
            else if(t.startsWith('ALT_IMAGEN:'))    ai=t.replace('ALT_IMAGEN:','').trim();
            else if(t.startsWith('SUBTEMA_LOCAL:')) sub=t.replace('SUBTEMA_LOCAL:','').trim();
            else if(t.startsWith('CONTENIDO:'))     enC=true;
            else if(enC&&t.length>0)                bl.push(t);
        }
        contenido=bl.join('\n\n');
        titulo=titulo.replace(/[*_#`]/g,'').trim();
        desc=desc.replace(/[*_#`]/g,'').trim();
        if(!titulo||!contenido||contenido.length<200) throw new Error('Respuesta incompleta');

        console.log(`   📝 ${titulo}`);

        // Imagen + marca de agua
        const urlOrig=await obtenerImagen(titulo,categoria,sub,qi);
        const imgResult=await aplicarMarcaDeAgua(urlOrig);
        const urlFinal=imgResult.procesada?`${BASE_URL}/img/${imgResult.nombre}`:urlOrig;

        const sl=slug(titulo);
        const existe=await pool.query('SELECT id FROM noticias WHERE slug=$1',[sl]);
        const slFin=existe.rows.length?`${sl}-${Date.now()}`:sl;

        // Insertar en base de datos
        await pool.query(
            `INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [titulo.substring(0,255),slFin,categoria,contenido.substring(0,10000),desc.substring(0,160),(pals||categoria).substring(0,255),redactor(categoria),urlFinal,(ai||titulo).substring(0,255),`Fotografía: ${titulo}`,'efd.jpg','el-farol','publicada']
        );
        console.log(`\n✅ /noticia/${slFin}`);

        // ========== NUEVO: Publicar en Facebook ==========
        const urlCompletaNoticia = `${BASE_URL}/noticia/${slFin}`;
        await publicarEnFacebook(titulo, desc, urlCompletaNoticia, urlFinal);
        // =================================================

        return{success:true,slug:slFin,titulo,mensaje:'✅ Publicada y enviada a Facebook'};
    }catch(error){
        console.error('❌',error.message);
        return{success:false,error:error.message};
    }
}

// ==================== RSS GOBIERNO RD ====================
const FUENTES_RSS=[
    {url:'https://presidencia.gob.do/feed',       categoria:'Nacionales', nombre:'Presidencia RD'},
    {url:'https://policia.gob.do/feed',            categoria:'Nacionales', nombre:'Policía Nacional'},
    {url:'https://www.mopc.gob.do/feed',           categoria:'Nacionales', nombre:'MOPC'},
    {url:'https://www.salud.gob.do/feed',          categoria:'Nacionales', nombre:'Salud Pública'},
    {url:'https://www.educacion.gob.do/feed',      categoria:'Nacionales', nombre:'Educación'},
    {url:'https://www.bancentral.gov.do/feed',     categoria:'Economía',   nombre:'Banco Central'},
    {url:'https://mepyd.gob.do/feed',              categoria:'Economía',   nombre:'MEPyD'},
    {url:'https://www.invivienda.gob.do/feed',     categoria:'Nacionales', nombre:'Invivienda'},
    {url:'https://mitur.gob.do/feed',              categoria:'Nacionales', nombre:'Turismo'},
    {url:'https://pgr.gob.do/feed',                categoria:'Nacionales', nombre:'Procuraduría'}
];

async function procesarRSS(){
    if(!CONFIG_IA.enabled) return;
    console.log('\n📡 RSS portales gobierno...');
    let procesadas=0;

    for(const fuente of FUENTES_RSS){
        try{
            const feed=await rssParser.parseURL(fuente.url).catch(()=>null);
            if(!feed?.items?.length){console.log(`   ⚠️ Sin items: ${fuente.nombre}`);continue;}
            console.log(`   📰 ${fuente.nombre}: ${feed.items.length} items`);

            for(const item of feed.items.slice(0,3)){
                const guid=item.guid||item.link||item.title;
                if(!guid) continue;
                const yaExiste=await pool.query('SELECT id FROM rss_procesados WHERE item_guid=$1',[guid.substring(0,500)]);
                if(yaExiste.rows.length) continue;

                const comunicado=[
                    item.title?`TÍTULO: ${item.title}`:'',
                    item.contentSnippet?`RESUMEN: ${item.contentSnippet}`:'',
                    item.content?`CONTENIDO: ${item.content?.substring(0,2000)}`:'',
                    item.pubDate?`FECHA: ${item.pubDate}`:'',
                    `FUENTE OFICIAL: ${fuente.nombre}`
                ].filter(Boolean).join('\n');

                const resultado=await generarNoticia(fuente.categoria,comunicado);
                if(resultado.success){
                    await pool.query('INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING',[guid.substring(0,500),fuente.nombre]);
                    procesadas++;
                    console.log(`   ✅ ${resultado.titulo?.substring(0,50)}`);
                    await new Promise(r=>setTimeout(r,5000));
                }
                break;
            }
        }catch(err){console.warn(`   ⚠️ ${fuente.nombre}: ${err.message}`);}
    }
    console.log(`\n📡 RSS: ${procesadas} noticias nuevas`);
}

// ==================== CRON ====================
const CATS=['Nacionales','Deportes','Internacionales','Economía','Tecnología','Espectáculos'];
cron.schedule('0 */4 * * *', async()=>{
    if(!CONFIG_IA.enabled) return;
    await
