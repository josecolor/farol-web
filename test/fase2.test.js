'use strict';
// Pruebas sin red externa: Redis→fallback memoria, Ollama simulado, imágenes sintéticas.
process.env.REDIS_URL = ''; process.env.MONGO_URL = ''; process.env.IMG_DIR = '/tmp/efd-test-img';
process.env.LLM_BASE_URL = 'http://127.0.0.1:19999';
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

    // ── LLM con Ollama simulado ──
    console.log('\nRouter Llama (Ollama simulado)');
    let intentos = 0;
    const srv = http.createServer((req, res) => {
        let b = ''; req.on('data', c => b += c); req.on('end', () => {
            if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }));
            const body = JSON.parse(b); intentos++;
            if (body.model === 'llama3.1:8b' && intentos <= 2) { res.statusCode = 500; return res.end('boom'); }   // el principal falla → debe caer al fallback
            res.setHeader('Content-Type', 'application/x-ndjson');
            const salida = body.format === 'json' ? '```json\n{"consultas":["Palacio Nacional", "National Palace Santo Domingo",],}\n```' : 'TITULO_A: Prueba\nCONTENIDO:\nHola.';
            for (const tr of salida.match(/.{1,12}/gs)) res.write(JSON.stringify({ message: { content: tr }, done: false }) + '\n');
            res.end(JSON.stringify({ done: true }) + '\n');
        });
    }).listen(19999);
    process.env.LLM_MODEL = 'llama3.1:8b'; process.env.LLM_MODEL_FALLBACK = 'llama3.2:3b';
    delete require.cache[require.resolve('../lib/llm')]; const llm = require('../lib/llm');
    const txt = await llm.llamarGemini('hola', 1, 8000);
    ok(txt.includes('TITULO_A: Prueba') && intentos >= 2, 'streaming OK + fallback automático 8B → 3B cuando el principal falla');
    const j = await llm.generarJSON('x'); ok(Array.isArray(j.consultas) && j.consultas.length === 2, 'JSON con ``` y comas sobrantes se repara');
    ok((await llm.estado()).servicio_vivo === true, 'estado() consulta /api/tags');

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
