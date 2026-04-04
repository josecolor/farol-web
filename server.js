// ══════════════════════════════════════════════════════════
// EL FAROL AL DIA — SERVIDOR PRINCIPAL V35.5 MODULAR
// ══════════════════════════════════════════════════════════
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const cron    = require('node-cron');

const { ENV, getPromptBase, CATEGORIAS, PB, OPT, BANCO_LOCAL, CAT_FALLBACK, RUTAS } = require('./config-mxl');
const { llamarGemini } = require('./motores-ia');
const { aplicarMarcaDeAgua } = require('./watermark');
const db = require('./db');

const app      = express();
const BASE_URL = ENV.BASE_URL;
const PORT     = ENV.PORT || process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/static', express.static(path.join(__dirname, 'static'), {
    setHeaders: function(res) { res.setHeader('Cache-Control', 'public,max-age=2592000,immutable'); }
}));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors({ origin: '*' }));
app.options('*', cors());

function authMiddleware(req, res, next) {
    var auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Dia"');
        return res.status(401).send('Acceso restringido. Usuario: mxl / PIN: 1128');
    }
    try {
        var decoded = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
        var parts = decoded.split(':');
        var user = parts[0];
        var pass = parts.slice(1).join(':');
        if (user === ENV.ADMIN_USER && pass === String(ENV.ADMIN_PIN)) return next();
    } catch(e) {}
    res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Dia"');
    return res.status(401).send('Credenciales incorrectas');
}

app.get('/img/:nombre', function(req, res) {
    var tmpDir = (RUTAS && RUTAS.TMP_DIR) ? RUTAS.TMP_DIR : '/tmp';
    var ruta = path.join(tmpDir, req.params.nombre);
    if (fs.existsSync(ruta)) {
        res.setHeader('Cache-Control', 'public,max-age=604800');
        return res.sendFile(ruta);
    }
    res.status(404).send('Imagen no disponible');
});

function slugify(t) {
    return t.toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[ñ]/g, 'n')
        .replace(/[^a-z0-9\s-]/g, '').trim()
        .replace(/\s+/g, '-').replace(/-+/g, '-')
        .substring(0, 75);
}

function imgLocal(subtema, categoria) {
    if (BANCO_LOCAL[subtema] && BANCO_LOCAL[subtema][0]) return BANCO_LOCAL[subtema][0];
    var fb = CAT_FALLBACK[categoria];
    if (fb && BANCO_LOCAL[fb] && BANCO_LOCAL[fb][0]) return BANCO_LOCAL[fb][0];
    return PB + '/3052454/pexels-photo-3052454.jpeg' + OPT;
}

var esc = function(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
};

function metaTags(n, url) {
    var t  = esc(n.titulo);
    var d  = esc(n.seo_description || n.titulo);
    var fi = new Date(n.fecha).toISOString();
    var schema = JSON.stringify({
        "@context":"https://schema.org","@type":"NewsArticle",
        "headline":n.titulo,"description":n.seo_description||'',
        "image":n.imagen,"datePublished":fi,
        "author":{"@type":"Person","name":n.redactor||'Redaccion EFD'},
        "publisher":{"@type":"NewsMediaOrganization","name":"El Farol al Dia","url":BASE_URL}
    });
    return '<title>' + t + ' | El Farol al Dia</title>\n' +
        '<meta name="description" content="' + d + '">\n' +
        '<meta property="og:title" content="' + t + '">\n' +
        '<meta property="og:description" content="' + d + '">\n' +
        '<meta property="og:image" content="' + esc(n.imagen) + '">\n' +
        '<meta property="og:url" content="' + esc(url) + '">\n' +
        '<meta property="og:type" content="article">\n' +
        '<meta name="twitter:card" content="summary_large_image">\n' +
        '<link rel="canonical" href="' + esc(url) + '">\n' +
        '<script type="application/ld+json">' + schema + '</script>';
}

var BARRIOS_SDE = ['Los Mina','Invivienda','Charles de Gaulle','Ensanche Ozama','Sabana Perdida','Villa Mella','El Almirante'];

function validarContenido(contenido) {
    if (!contenido || contenido.trim().length < 400) {
        return { valido: false, razon: 'Muy corto (' + ((contenido||'').length) + ' chars, minimo 400)' };
    }
    var parrafos = contenido.split(/\n+/).filter(function(p) { return p.trim().length > 20; });
    if (parrafos.length < 4) {
        return { valido: false, razon: 'Solo ' + parrafos.length + ' parrafos (minimo 4)' };
    }
    return { valido: true, longitud: contenido.trim().length, parrafos: parrafos.length };
}

async function generarNoticia(categoria, comunicadoExterno, reintento) {
    if (!reintento) reintento = 1;
    var MAX = 3;
    console.log('\n[V35.5] Generando "' + categoria + '" intento ' + reintento + '/' + MAX);
    try {
        var memoria = '';
        try {
            var recientes = await db.getTitulosRecientes(20);
            if (recientes.length) {
                memoria = '\nNO REPETIR:\n' + recientes.map(function(r,i){ return (i+1)+'. '+r.titulo; }).join('\n') + '\n';
            }
        } catch(e) { console.warn('Sin memoria:', e.message); }

        var fuente = comunicadoExterno
            ? '\nCOMUNICADO:\n"""\n' + comunicadoExterno + '\n"""\nRedacta noticia basada en este comunicado.'
            : '\nEscribe noticia NUEVA sobre "' + categoria + '" enfocada en Santo Domingo Este 2026.';

        var prompt = getPromptBase() + '\n\n' +
            'ROL: Periodista El Farol al Dia. Voz barrio SDE. Abril 2026.\n\n' +
            'OBLIGATORIO:\n' +
            '1. Minimo 400 caracteres (5+ parrafos)\n' +
            '2. Menciona barrio: ' + BARRIOS_SDE.slice(0,4).join(', ') + '\n' +
            '3. Lenguaje: "se supo","fue confirmado","segun fuentes","gente del sector"\n' +
            '4. Parrafos cortos. Lector en celular.\n\n' +
            memoria + fuente + '\n\n' +
            'CATEGORIA: ' + categoria + '\n\n' +
            'FORMATO EXACTO:\n' +
            'TITULO: [60-70 chars impactante]\n' +
            'DESCRIPCION: [150-160 chars SEO]\n' +
            'PALABRAS: [5 keywords]\n' +
            'SUBTEMA_LOCAL: [barrio]\n' +
            'CONTENIDO:\n[5+ parrafos con linea en blanco entre cada uno]';

        var respuesta = await llamarGemini(prompt);
        var limpio = respuesta.replace(/^\s*[*#]+\s*/gm, '');

        var titulo='', desc='', palabras='', subtema='', enCont=false, bloques=[];
        var lineas = limpio.split('\n');
        for (var i=0; i<lineas.length; i++) {
            var t = lineas[i].trim();
            if      (t.startsWith('TITULO:'))       titulo   = t.replace('TITULO:','').trim();
            else if (t.startsWith('DESCRIPCION:'))  desc     = t.replace('DESCRIPCION:','').trim();
            else if (t.startsWith('PALABRAS:'))     palabras = t.replace('PALABRAS:','').trim();
            else if (t.startsWith('SUBTEMA_LOCAL:')) subtema = t.replace('SUBTEMA_LOCAL:','').trim();
            else if (t.startsWith('CONTENIDO:'))    enCont   = true;
            else if (enCont && t.length > 0)        bloques.push(t);
        }

        var contenido = bloques.join('\n\n');
        titulo = titulo.replace(/[*_#`"]/g,'').trim();
        desc   = desc.replace(/[*_#`]/g,'').trim();

        if (!titulo) throw new Error('Sin TITULO en respuesta');

        var val = validarContenido(contenido);
        if (!val.valido) {
            console.log('  Validacion: ' + val.razon);
            if (reintento < MAX) {
                await new Promise(function(r){ setTimeout(r,3000); });
                return generarNoticia(categoria, comunicadoExterno, reintento+1);
            }
            throw new Error('Validacion fallida: ' + val.razon);
        }

        var urlOrig = imgLocal(subtema, categoria);
        var imgResult = { procesada: false };
        try { imgResult = await aplicarMarcaDeAgua(urlOrig); } catch(e) {}
        var urlFinal = imgResult.procesada ? (BASE_URL+'/img/'+imgResult.nombre) : urlOrig;

        var slugBase = slugify(titulo);
        if (!slugBase || slugBase.length < 3) throw new Error('Slug invalido');
        var existe = await db.existeSlug(slugBase);
        var slFin  = existe ? (slugBase.substring(0,68)+'-'+Date.now().toString().slice(-6)) : slugBase;

        await db.crearNoticia({
            titulo: titulo.substring(0,255), slug: slFin, seccion: categoria,
            contenido: contenido.substring(0,10000),
            seo_description: desc.substring(0,160),
            seo_keywords: palabras.substring(0,255),
            redactor: 'Redaccion EFD', imagen: urlFinal,
            imagen_alt: titulo+' - El Farol al Dia',
            imagen_caption: 'Foto: '+titulo,
            imagen_nombre: imgResult.nombre||'efd.jpg',
            imagen_fuente: imgResult.procesada?'local-watermark':'local',
            imagen_original: urlOrig, estado: 'publicada'
        });

        console.log('  OK /noticia/'+slFin+' ['+val.longitud+' chars]');
        return { success:true, slug:slFin, titulo:titulo };

    } catch(err) {
        console.error('  Error intento '+reintento+':', err.message);
        if (reintento < 3) {
            await new Promise(function(r){ setTimeout(r,5000); });
            return generarNoticia(categoria, comunicadoExterno, reintento+1);
        }
        try { await db.registrarError(err.message, categoria); } catch(e) {}
        return { success:false, error:err.message };
    }
}

// RUTAS
app.get('/health', function(req,res){ res.json({status:'OK',version:'MXL-35.5'}); });

app.get('/api/noticias', async function(req,res){
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Cache-Control','public,max-age=60');
    try { var n=await db.getNoticias(30); res.json({success:true,noticias:n}); }
    catch(e){ res.status(500).json({success:false,noticias:[],error:e.message}); }
});

app.get('/api/estadisticas', async function(req,res){
    try { var r=await db.getEstadisticas(); res.json({success:true,totalNoticias:parseInt(r.c),totalVistas:parseInt(r.v)||0}); }
    catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/generar-noticia', authMiddleware, async function(req,res){
    var cat=req.body.categoria;
    if(!cat) return res.status(400).json({error:'Falta categoria'});
    var r=await generarNoticia(cat);
    res.status(r.success?200:500).json(r);
});

app.get('/api/generar', authMiddleware, async function(req,res){
    var cat=req.query.cat||CATEGORIAS[Math.floor(Math.random()*CATEGORIAS.length)];
    var r=await generarNoticia(cat);
    res.json(r);
});

app.post('/api/publicar', async function(req,res){
    var b=req.body;
    if(b.pin!==String(ENV.ADMIN_PIN)) return res.status(403).json({success:false,error:'PIN incorrecto'});
    if(!b.titulo||!b.seccion||!b.contenido) return res.status(400).json({success:false,error:'Faltan campos'});
    try {
        var sb=slugify(b.titulo), ex=await db.existeSlug(sb);
        var sl=ex?(sb.substring(0,68)+'-'+Date.now().toString().slice(-6)):sb;
        var img=b.imagen||(PB+'/3052454/pexels-photo-3052454.jpeg'+OPT);
        if(img.startsWith('http')){ var wm=await aplicarMarcaDeAgua(img).catch(function(){return{procesada:false};}); if(wm.procesada) img=BASE_URL+'/img/'+wm.nombre; }
        await db.crearNoticia({titulo:b.titulo,slug:sl,seccion:b.seccion,contenido:b.contenido,
            seo_description:b.seo_description||b.titulo.substring(0,155),seo_keywords:b.seo_keywords||b.seccion,
            redactor:'Manual',imagen:img,imagen_alt:b.imagen_alt||(b.titulo+' - El Farol al Dia'),
            imagen_caption:'',imagen_nombre:'manual.jpg',imagen_fuente:'manual',imagen_original:b.imagen||img,estado:'publicada'});
        res.json({success:true,slug:sl});
    } catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/eliminar/:id', authMiddleware, async function(req,res){
    if(req.body.pin!==String(ENV.ADMIN_PIN)) return res.status(403).json({error:'PIN incorrecto'});
    try{ await db.eliminarNoticia(parseInt(req.params.id)); res.json({success:true}); }
    catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/comentarios/:noticia_id', async function(req,res){
    try{ var r=await db.getComentarios(req.params.noticia_id); res.json({success:true,comentarios:r}); }
    catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/comentarios/:noticia_id', async function(req,res){
    var n=req.body.nombre, t=req.body.texto, nid=parseInt(req.params.noticia_id);
    if(!n||!n.trim()||!t||!t.trim()) return res.status(400).json({error:'Nombre y texto requeridos'});
    if(t.length>1000) return res.status(400).json({error:'Muy largo'});
    try{ var c=await db.crearComentario(nid,n,t); res.json({success:true,comentario:c}); }
    catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/publicidad/activos', async function(req,res){
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Cache-Control','public,max-age=300');
    try{ var a=await db.getPublicidadActiva(); res.json({success:true,anuncios:a}); }
    catch(e){ res.status(500).json({success:false,anuncios:[]}); }
});

app.get('/api/publicidad', authMiddleware, async function(req,res){
    try{ var a=await db.getPublicidad(); res.json({success:true,anuncios:a}); }
    catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/publicidad/actualizar', authMiddleware, async function(req,res){
    if(req.body.pin!==String(ENV.ADMIN_PIN)) return res.status(403).json({error:'PIN incorrecto'});
    var datos={nombre_espacio:req.body.nombre_espacio,url_afiliado:req.body.url_afiliado,
        imagen_url:req.body.imagen_url,ubicacion:req.body.ubicacion,activo:req.body.activo,
        ancho_px:req.body.ancho_px,alto_px:req.body.alto_px};
    try{ await db.actualizarPublicidad(parseInt(req.body.id),datos); res.json({success:true}); }
    catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/publicidad/crear', authMiddleware, async function(req,res){
    if(req.body.pin!==String(ENV.ADMIN_PIN)) return res.status(403).json({error:'PIN incorrecto'});
    var datos={nombre_espacio:req.body.nombre_espacio,url_afiliado:req.body.url_afiliado,
        imagen_url:req.body.imagen_url,ubicacion:req.body.ubicacion,ancho_px:req.body.ancho_px,alto_px:req.body.alto_px};
    try{ await db.crearPublicidad(datos); res.json({success:true}); }
    catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/publicidad/eliminar', authMiddleware, async function(req,res){
    if(req.body.pin!==String(ENV.ADMIN_PIN)) return res.status(403).json({error:'PIN incorrecto'});
    try{ await db.eliminarPublicidad(parseInt(req.body.id)); res.json({success:true}); }
    catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/memoria', authMiddleware, async function(req,res){
    try{ var r=await db.getMemoria(50); res.json({success:true,registros:r}); }
    catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/status', async function(req,res){
    try{
        var s=await db.getEstadisticas(), u=await db.getNoticias(1), p=await db.contarSuscriptoresPush().catch(function(){return 0;});
        res.json({status:'OK',version:'MXL-35.5-MODULAR',noticias:parseInt(s.c),total_vistas:parseInt(s.v)||0,
            ultima_noticia:(u[0]&&u[0].titulo)?u[0].titulo.substring(0,60):'—',
            gemini_keys:ENV.GEMINI_KEYS.length,deepseek:ENV.DEEPSEEK_API_KEY?'activo':'sin key',
            push_suscriptores:p,categorias:CATEGORIAS,base_url:BASE_URL});
    } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/sitemap.xml', async function(req,res){
    try{
        var slugs=await db.getSlugsParaSitemap(), now=Date.now();
        var xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml+='<url><loc>'+BASE_URL+'/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>\n';
        for(var i=0;i<slugs.length;i++){
            var n=slugs[i], d=(now-new Date(n.fecha).getTime())/86400000;
            xml+='<url><loc>'+BASE_URL+'/noticia/'+encodeURIComponent(n.slug)+'</loc>'+
                '<lastmod>'+new Date(n.fecha).toISOString().split('T')[0]+'</lastmod>'+
                '<changefreq>'+(d<1?'hourly':d<7?'daily':'weekly')+'</changefreq>'+
                '<priority>'+(d<1?'1.0':d<7?'0.9':'0.7')+'</priority></url>\n';
        }
        xml+='</urlset>';
        res.setHeader('Content-Type','application/xml; charset=utf-8');
        res.setHeader('Cache-Control','public,max-age=1800');
        res.send(xml);
    } catch(e){ res.status(500).send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'); }
});

app.get('/robots.txt', function(req,res){ res.setHeader('Content-Type','text/plain'); res.send('User-agent: *\nAllow: /\nDisallow: /redaccion\nSitemap: '+BASE_URL+'/sitemap.xml'); });
app.get('/ads.txt',    function(req,res){ res.setHeader('Content-Type','text/plain'); res.send('google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0\n'); });

app.get('/',           function(req,res){ res.sendFile(path.join(__dirname,'client','index.html')); });
app.get('/redaccion',  authMiddleware, function(req,res){ res.sendFile(path.join(__dirname,'client','redaccion.html')); });
app.get('/contacto',   function(req,res){ res.sendFile(path.join(__dirname,'client','contacto.html')); });
app.get('/nosotros',   function(req,res){ res.sendFile(path.join(__dirname,'client','nosotros.html')); });
app.get('/privacidad', function(req,res){ res.sendFile(path.join(__dirname,'client','privacidad.html')); });
app.get('/terminos',   function(req,res){ res.sendFile(path.join(__dirname,'client','terminos.html')); });
app.get('/cookies',    function(req,res){ res.sendFile(path.join(__dirname,'client','cookies.html')); });

app.get('/noticia/:slug', async function(req,res){
    try{
        var n=await db.getNoticiaBySlug(req.params.slug);
        if(!n) return res.status(404).send('<h1 style="color:#FF5500;font-family:sans-serif;text-align:center;padding:60px">404<br><a href="/">Volver</a></h1>');
        await db.incrementarVistas(n.id);
        var pp=path.join(__dirname,'client','noticia.html');
        if(!fs.existsSync(pp)) return res.json({success:true,noticia:n});
        var urlN=BASE_URL+'/noticia/'+n.slug;
        var cHTML=(n.contenido||'').split('\n').filter(function(p){return p.trim();}).map(function(p){return '<p>'+p.trim()+'</p>';}).join('');
        var html=fs.readFileSync(pp,'utf8');
        html=html.replace('<!-- META_TAGS -->',metaTags(n,urlN))
            .replace(/{{TITULO}}/g,esc(n.titulo))
            .replace(/{{CONTENIDO}}/g,cHTML)
            .replace(/{{FECHA}}/g,new Date(n.fecha).toLocaleDateString('es-DO',{year:'numeric',month:'long',day:'numeric'}))
            .replace(/{{IMAGEN}}/g,n.imagen||'')
            .replace(/{{ALT}}/g,esc(n.imagen_alt||n.titulo))
            .replace(/{{VISTAS}}/g,n.vistas||0)
            .replace(/{{REDACTOR}}/g,esc(n.redactor||'Redaccion EFD'))
            .replace(/{{SECCION}}/g,esc(n.seccion||''))
            .replace(/{{URL}}/g,encodeURIComponent(urlN));
        res.setHeader('Content-Type','text/html;charset=utf-8');
        res.setHeader('Cache-Control','public,max-age=300');
        res.send(html);
    } catch(e){ res.status(500).send('Error interno'); }
});

app.use(function(req,res){
    var idx=path.join(__dirname,'client','index.html');
    if(fs.existsSync(idx)) return res.sendFile(idx);
    res.status(404).send('Not found');
});

cron.schedule('0 */2 * * *', function(){
    var cat=CATEGORIAS[Math.floor(Math.random()*CATEGORIAS.length)];
    generarNoticia(cat,null,1).catch(function(e){ console.error('Cron error:',e.message); });
});

async function start(){
    try{
        console.log('Inicializando BD...');
        await db.inicializarDB();
    } catch(e){ console.error('Error DB (servidor sigue vivo):', e.message); }

    app.listen(PORT,'0.0.0.0',function(){
        console.log('\n EL FAROL AL DIA V35.5 MODULAR\n Puerto:'+PORT+' | Gemini:'+ENV.GEMINI_KEYS.length+' keys | DeepSeek:'+(ENV.DEEPSEEK_API_KEY?'SI':'NO'));
    });
}

start().catch(function(err){ console.error('Error global:',err.message); process.exit(1); });
module.exports = app;
