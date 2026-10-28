'use strict';
// Pruebas sin red externa: Redis→fallback memoria, Ollama simulado, imágenes sintéticas.
process.env.REDIS_URL = ''; process.env.MONGO_URL = ''; process.env.IMG_DIR = '/tmp/efd-test-img';
process.env.LLM_BASE_URL = 'http://127.0.0.1:19999'; process.env.LLM_RETRY_MS = '10';
const assert = require('assert'); const http = require('http'); const sharp = require('sharp');
let pass = 0; const ok = (c, m) => { assert(c, m); pass++; console.log('  ✓', m); };

(async () => {
    // ── licencias ──
    const { clasificar } = require('../lib/imagenes/licencias');
    console.log('\nLicencias');
    ok(clasificar('CC BY 4.0').permitida && clasificar('CC BY 4.0').requiereCredito, 'CC BY 4.0 permitida con crédito');
    ok(clasificar('CC0').permitida && clasificar('Public domain').permitida, 'CC0 y dominio público permitidas');
    for (const l of ['CC BY-SA 4.0', 'CC BY-NC 2.0', 'CC BY-ND 2.0', 'CC BY-NC-SA 3.0', 'GFDL', 'Fair use', 'All rights reserved', ''])
        ok(!clasificar(l).permitida, `rechaza "${l}"`);

    // ── depurador: metadatos ──
    const dep = require('../lib/imagenes/depurador');
    console.log('\nDepurador (metadatos)');
    const base = { id: 'x:1', proveedor: 'Wikimedia Commons', autor: 'Juan Pérez', urlPagina: 'https://commons.wikimedia.org/wiki/File:X.jpg', urlDescarga: 'https://upload.wikimedia.org/a.jpg', titulo: 'Palacio Nacional', descripcion: 'Fachada', categorias: [], ancho: 1600, alto: 1000, anchoOriginal: 3000, altoOriginal: 2000, licencia: clasificar('CC BY 4.0') };
    ok(dep.evaluarMetadatos(base).ok, 'foto válida pasa');
    ok(!dep.evaluarMetadatos({ ...base, urlDescarga: 'http://x.org/a.jpg' }).ok, 'http rechazado');
    ok(!dep.evaluarMetadatos({ ...base, urlDescarga: 'https://media.gettyimages.com/a.jpg' }).ok, 'banco comercial rechazado');
    ok(!dep.evaluarMetadatos({ ...base, titulo: 'Logo del partido' }).ok, 'logo rechazado');
    ok(dep.evaluarMetadatos({ ...base, titulo: 'Catálogo de biólogos' }).ok, '"catálogo/biólogos" NO dispara falso positivo de "logo"');
    ok(!dep.evaluarMetadatos({ ...base, anchoOriginal: 640, altoOriginal: 480 }).ok, 'baja resolución rechazada');
    ok(!dep.evaluarMetadatos({ ...base, licencia: clasificar('CC BY-SA 4.0') }).ok, 'BY-SA rechazada');

    // ── anti-SSRF ──
    console.log('\nAnti-SSRF');
    for (const u of ['https://127.0.0.1/a.jpg', 'https://169.254.169.254/latest', 'https://10.0.0.5/x', 'http://upload.wikimedia.org/a.jpg'])
        await dep.descargar(u, 'test').then(() => ok(false, 'debió fallar ' + u), () => ok(true, `bloquea ${u}`));

    // ── depurador: contenido ──
    console.log('\nDepurador (contenido)');
    const ruido = Buffer.alloc(1600 * 900 * 3); for (let i = 0; i < ruido.length; i++) ruido[i] = (i * 7919 + (i >> 3) * 31) & 255;
    const foto = await sharp(ruido, { raw: { width: 1600, height: 900, channels: 3 } }).jpeg().toBuffer();
    const plana = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#336699' } }).jpeg().toBuffer();
    const peq = await sharp(ruido, { raw: { width: 1600, height: 900, channels: 3 } }).resize(400, 225).jpeg().toBuffer();
    const i1 = await dep.inspeccionar(foto); ok(i1.ok, 'foto con detalle pasa');
    ok(!(await dep.inspeccionar(plana)).ok, 'imagen plana rechazada');
    ok(!(await dep.inspeccionar(peq)).ok, 'resolución real baja rechazada');
    ok(!(await dep.inspeccionar(Buffer.from('<html>no soy imagen</html>'))).ok, 'archivo no-imagen rechazado');
    await dep.marcarUsada({ id: 'x:1' }, i1.huella);
    ok(!!(await dep.yaUsada({ id: 'x:2' }, i1.huella)), 'detecta duplicado por huella visual');
    ok(!!(await dep.yaUsada({ id: 'x:1' }, null)), 'detecta imagen ya usada por id');

    // ── marca de agua ──
    console.log('\nMarca de agua / tarjeta');
    const { aplicarMarca, tarjetaMarca, cargarMarca } = require('../lib/imagenes/marca');
    ok(!!(await cargarMarca()), 'marca válida (respaldo desde favicon porque watermark.png está corrupto)');
    const m = await aplicarMarca(foto); const mm = await sharp(m.buffer).metadata();
    ok(m.marcada && mm.width === 1200 && mm.height === 675 && !mm.exif, 'recorte 1200x675, marca aplicada, sin EXIF');
    const t = await tarjetaMarca('Deportes'); ok((await sharp(t.buffer).metadata()).width === 1200, 'tarjeta de marca generada');
    require('fs').writeFileSync('/tmp/muestra-marca.jpg', m.buffer); require('fs').writeFileSync('/tmp/muestra-tarjeta.jpg', t.buffer);

    // ── caché ──
    const cache = require('../lib/cache'); cache.iniciar();
    console.log('\nCaché (fallback memoria)');
    let llamadas = 0; const f = async () => { llamadas++; await new Promise(r => setTimeout(r, 50)); return { n: llamadas }; };
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => cache.wrap('t', 'k', 1, f)));
    ok(llamadas === 1 && rs.every(r => r.n === 1), 'anti-estampida: 5 peticiones simultáneas → 1 consulta');
    await cache.wrap('t', 'k', 1, f); ok(llamadas === 1, 'segunda lectura sale de caché');
    await cache.invalidar('t'); await cache.wrap('t', 'k', 1, f); ok(llamadas === 2, 'invalidar(namespace) fuerza recarga');
    await new Promise(r => setTimeout(r, 1100));
    const viejo = await cache.wrap('t', 'k', 1, f); ok(viejo.n === 2, 'stale-while-revalidate: sirve el viejo al instante');
    await new Promise(r => setTimeout(r, 150)); ok(llamadas === 3, '...y refresca en segundo plano');
    const filas = []; await cache.contarVista('a'); await cache.contarVista('a'); await cache.contarVista('b');
    const n = await cache.vaciarVistas({ query: async (sql, p) => filas.push(p) });
    ok(n === 2 && filas.find(p => p[0] === 'a')[1] === 2, 'vistas agrupadas: 3 hits → 2 UPDATE');

    // ── LLM: Ollama (qwen2.5:0.5b) como motor único ──
    console.log('\nMotor Ollama (simulado)');
    let intentos = 0; const modelosVistos = new Set();
    const srv = http.createServer((req, res) => {
        let b = ''; req.on('data', c => b += c); req.on('end', () => {
            if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:0.5b' }] }));
            const body = JSON.parse(b); intentos++; modelosVistos.add(body.model);
            if (intentos <= 2) { res.statusCode = 500; return res.end('boom'); }              // falla transitoria → reintento
            res.setHeader('Content-Type', 'application/x-ndjson');
            const salida = body.format === 'json' ? '```json\n{"consultas":["Palacio Nacional", "National Palace Santo Domingo",],}\n```' : 'Titular libre sin etiquetas\n\nCuerpo.';
            for (const tr of salida.match(/.{1,12}/gs)) res.write(JSON.stringify({ message: { content: tr }, done: false }) + '\n');
            res.end(JSON.stringify({ done: true }) + '\n');
        });
    }).listen(19999);
    delete process.env.LLM_MODEL; delete process.env.LLM_MODEL_FALLBACK;
    delete require.cache[require.resolve('../lib/llm')]; const llm = require('../lib/llm');
    ok(llm.MODELO === 'qwen2.5:0.5b', 'el modelo por defecto es qwen2.5:0.5b');
    ok(typeof llm.llamarGemini === 'undefined', 'no queda rastro de llamarGemini en la API del motor');
    const txt = await llm.generarTexto('hola', 3, 1000);
    ok(txt.includes('Titular libre') && intentos === 3 && modelosVistos.size === 1 && modelosVistos.has('qwen2.5:0.5b'), 'streaming OK + reintenta SOLO con qwen2.5:0.5b (sin modelos de respaldo)');
    const j = await llm.generarJSON('x'); ok(Array.isArray(j.consultas) && j.consultas.length === 2, 'JSON con ``` y comas sobrantes se repara');
    ok((await llm.estado()).servicio_vivo === true, 'estado() consulta /api/tags');

    // ── Jefe de Redacción: prompt de sistema + parser inteligente ──
    console.log('\nJefe de Redacción (parser flexible)');
    const jefe = require('../lib/jefe');
    const sis = jefe.bloqueSistema();
    ok(/NOTICIA DURA/.test(sis) && /VIRALITY_SCORE/.test(sis) && /SEO/.test(sis) && /TITULAR_SOCIAL/.test(sis), 'el prompt de sistema trae clasificación, virality y titulares SEO/redes');
    const cuerpo = 'Vecinos de Los Mina denunciaron el problema esta semana. Se supo que las autoridades revisan el caso. La gente del sector pide una solución rápida. '.repeat(6);
    let pj1 = jefe.parsearRespuesta(`TIPO_NOTICIA: DURA\nVIRALITY_SCORE: 82/100\nTITULO_A: Incendio en Los Mina deja tres heridos\nTITULO_B: Fuego en Los Mina: 3 heridos\nDESCRIPCION: Resumen.\nPALABRAS: a, b\nSUBTEMA_LOCAL: seguridad-policia\nCONTENIDO:\nPrimer párrafo.\n\nSegundo párrafo.`);
    ok(pj1.tituloA.startsWith('Incendio') && pj1.tituloB.startsWith('Fuego') && pj1.tipoModelo === 'DURA' && pj1.viralityModelo === 82 && pj1.subtema === 'seguridad-policia' && pj1.contenido.includes('Segundo'), 'formato con etiquetas TITULO_A/B + tipo + virality');
    let pj2 = jefe.parsearRespuesta(`Alcaldía de SDE anuncia nuevo plan de aceras\n\n${cuerpo}`);
    ok(pj2.modo.startsWith('libre') && pj2.tituloA === 'Alcaldía de SDE anuncia nuevo plan de aceras' && pj2.contenido.length > 300, 'texto libre SIN etiquetas: primera línea = título, el resto = cuerpo (sin error)');
    let pj3 = jefe.parsearRespuesta(`Aquí tienes la noticia:\n\n**Título:** "Invivienda estrena parque para los vecinos"\n**Descripción:** Un parque nuevo.\n\n**Contenido:**\n${cuerpo}`);
    ok(pj3.tituloA === 'Invivienda estrena parque para los vecinos' && !/\*\*/.test(pj3.contenido) && pj3.contenido.length > 300, 'markdown, comillas y preámbulo del modelo se limpian');
    let pj4 = jefe.parsearRespuesta(`TITULO_A: [Opción 1 — 65 chars, usa palabras clave reales de GSC]\nTITULO_B: [Opción 2 — 65 chars]\nCONTENIDO:\n${cuerpo}`);
    ok(pj4.tituloA.length > 10 && !/Opci[oó]n/.test(pj4.tituloA) && /titulo-derivado/.test(pj4.modo), 'placeholders copiados del prompt se descartan y el título se deriva del cuerpo');
    let pj5 = jefe.parsearRespuesta(`TITULO: Parque nuevo en Sabana Perdida\nCONTENIDO:\n${cuerpo.replace(/\. /g, '. ')}`);
    ok(pj5.contenido.split('\n\n').length >= 3, 'bloque único largo → se reparte en párrafos de ~3 oraciones');
    let pj6; try { pj6 = jefe.parsearRespuesta(''); } catch (e) { pj6 = null; }
    ok(pj6 && pj6.tituloA.length > 5, 'respuesta vacía NO lanza error: devuelve título publicable');
    const ev = jefe.evaluarFinal({ parsed: { ...pj2, tipoModelo: 'GENERAL', viralityModelo: 70 }, titulo: 'Tiroteo en Los Mina deja un herido', contenido: cuerpo, categoria: 'Nacionales', contexto: '' });
    ok(ev.tipo_noticia === 'DURA' && ev.virality_score > 0 && ev.virality_score <= 100 && ev.virality_modelo === 70, 'vocabulario de hecho grave fuerza DURA y el score se mezcla modelo+heurística');
    ok(jefe.clasificarNoticia('Nuevo festival de música en SDE') === 'GENERAL', 'noticia sin hecho grave = GENERAL');

    // ── MongoDB: falla en silencio si no hay MONGO_URL ──
    console.log('\nMongoDB (sin conexión)');
    const mongo = require('../lib/mongo');
    ok((await mongo.guardarEvaluacion({ slug: 'x' })) === false && (await mongo.estado()).configurada === false, 'sin MONGO_URL: guardarEvaluacion no lanza y estado() lo explica');

    // ── Extractor web: og:image y filtros ──
    console.log('\nExtractor web de imágenes');
    const web = require('../lib/imagenes/web');
    const html = '<html><head><title>X</title><meta property="og:title" content="Abinader visita el Palacio"><meta property="og:image" content="/fotos/palacio-1200.jpg"><meta name="twitter:image" content="https://cdn.site.do/logo-default.png"></head></html>';
    const ex = web.extraerDePagina(html, 'https://listindiario.com/nota/1');
    ok(ex.imagenes.length === 1 && ex.imagenes[0] === 'https://listindiario.com/fotos/palacio-1200.jpg' && ex.titulo.includes('Abinader'), 'extrae og:image (URL relativa resuelta), descarta logos/placeholders');

    // ── Flujo completo de imágenes con búsqueda simulada ──
    console.log('\nFlujo completo obtenerImagenLimpia');
    require('../lib/imagenes/buscador');
    require.cache[require.resolve('../lib/imagenes/buscador')].exports.buscar = async q => [
        { ...base, id: 'c:BYSA', licencia: clasificar('CC BY-SA 4.0'), titulo: 'Palacio Nacional' },
        { ...base, id: 'c:OFFTOPIC', titulo: 'Gato durmiendo', descripcion: 'mascota' },
        { ...base, id: 'c:OK', titulo: 'Palacio Nacional Santo Domingo', urlDescarga: 'https://upload.wikimedia.org/ok.jpg' }];
    const r2b = Buffer.alloc(1600 * 900 * 3); for (let i = 0; i < r2b.length; i++) r2b[i] = ((i % 1600) * 3 + (i >> 11) * 5 + (i * i >> 7)) & 255;
    const foto2 = await sharp(r2b, { raw: { width: 1600, height: 900, channels: 3 } }).jpeg().toBuffer();
    dep.descargar = async () => foto2;                       // simula la descarga https (sin red en el sandbox)
    delete require.cache[require.resolve('../lib/imagenes/index')];
    const { obtenerImagenLimpia, relevancia } = require('../lib/imagenes/index');
    const almacen = require('../lib/imagenes/almacen');
    ok(relevancia({ titulo: 'Palacio Nacional Santo Domingo', descripcion: '', categorias: [] }, 'Palacio Nacional') === 1, 'relevancia exacta = 1');
    ok(relevancia({ titulo: 'Gato durmiendo', descripcion: '', categorias: [] }, 'Palacio Nacional') === 0, 'foto fuera de tema = 0');
    // Nivel 1 (web directa, simulada): la fuente original aporta su foto
    const r3b = Buffer.alloc(1600 * 900 * 3); for (let i = 0; i < r3b.length; i++) { const px = (i / 3) | 0, x = px % 1600, y = (px / 1600) | 0; r3b[i] = ((Math.imul(i, 2654435761) >>> 13) & 127) + ((x < 800 && y < 450) ? 128 : 0); }   // cuadrante claro → huella distinta
    const foto3 = await sharp(r3b, { raw: { width: 1600, height: 900, channels: 3 } }).jpeg().toBuffer();
    const webMod = require('../lib/imagenes/web');
    webMod.candidatos = async () => [{ id: 'web:abc123', proveedor: 'listindiario.com', urlDescarga: 'https://cdn.listindiario.com/a.jpg', urlPagina: 'https://listindiario.com/nota/1',
        titulo: 'Abinader visita el Palacio Nacional', descripcion: '', autor: 'listindiario.com', categorias: [], web: true, esFuente: true,
        licencia: { permitida: true, tipo: 'fuente', etiqueta: 'Imagen de la fuente original', url: null, requiereCredito: true } }];
    dep.descargar = async url => /listindiario/.test(url) ? foto3 : foto2;
    const rw = await obtenerImagenLimpia({ titulo: 'Abinader visita el Palacio Nacional', contenido: 'x', categoria: 'Nacionales', enlaceFuente: 'https://listindiario.com/nota/1' });
    ok(/^web-listindiario-com/.test(rw.fuente) && rw.credito === 'listindiario.com' && rw.paginaFuente === 'https://listindiario.com/nota/1' && rw.procesada === true, `extractor web: foto de la fuente con marca y crédito (${rw.fuente})`);
    webMod.candidatos = async () => [];                      // sin resultados web → baja al nivel con licencia verificable
    const r = await obtenerImagenLimpia({ titulo: 'Abinader visita el Palacio Nacional', contenido: 'x', categoria: 'Nacionales', personaQuery: null });
    ok(/wikimedia/.test(r.fuente) && r.licencia === 'CC BY 4.0' && /Juan P/.test(r.credito), `elige la foto válida y relevante (${r.fuente}, ${r.licencia}, ${r.credito})`);
    ok(r.procesada === true && !!(await almacen.leer(r.nombre)), 'marca aplicada y foto persistida');
    const r2 = await obtenerImagenLimpia({ titulo: 'Abinader visita el Palacio Nacional', contenido: 'x', categoria: 'Nacionales' });
    ok(r2.fuente === 'marca-farol', 'misma foto NO se reutiliza en otra noticia → tarjeta de marca');
    ok((await almacen.leer('../../etc/passwd')) === null, 'anti path-traversal en almacén');
    require('fs').writeFileSync('/tmp/muestra-final.jpg', await almacen.leer(r.nombre));

    srv.close();
    console.log(`\n✅ ${pass} comprobaciones OK\n`); process.exit(0);
})().catch(e => { console.error('\n❌', e.stack || e.message); process.exit(1); });
