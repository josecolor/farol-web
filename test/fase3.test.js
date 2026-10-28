'use strict';
// FASE FINAL — (1) filtro geográfico estricto de imágenes  (2) micro-pipeline de videos cortos con FFmpeg.
// Sin red externa. Los clips de prueba se generan con FFmpeg (lavfi).
const os = require('os'), fs = require('fs'), path = require('path'), http = require('http'), { spawn, spawnSync } = require('child_process');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'efd-f3-'));
process.env.REDIS_URL = ''; process.env.MONGO_URL = ''; process.env.IMG_DIR = path.join(TMP, 'almacen');
process.env.LLM_BASE_URL = 'http://127.0.0.1:19999'; process.env.BASE_URL = 'https://elfarolaldia.com';
const assert = require('assert'); const sharp = require('sharp');
let pass = 0; const ok = (c, m) => { assert(c, m); pass++; console.log('  ✓', m); };
const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${cmd} falló: ${r.stderr}`); return r.stdout; };
const probe = f => JSON.parse(sh('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]));

(async () => {
    // ═══════════════ 1. FILTRO GEOGRÁFICO ═══════════════
    const geo = require('../lib/imagenes/geo');
    console.log('\nContexto geográfico de la primicia');
    const det = (titulo, categoria = 'Nacionales', contenido = '') => geo.detectarContexto({ titulo, categoria, contenido });
    let c = det('Abinader inaugura puente en Los Mina');
    ok(c.id === 'DO' && /Los Mina República Dominicana/.test(c.anchor), `RD + lugar específico → "${c.anchor}"`);
    ok(det('Alcaldía recoge basura en el sector').anchor === 'Santo Domingo República Dominicana' && det('Alcaldía recoge basura en el sector').implicito, 'sin pistas: línea local por defecto (Santo Domingo, RD)');
    ok(det('Presidente de Panamá anuncia plan del Canal', 'Internacionales').anchor === 'Panamá', 'Panamá detectado');
    ok(det('Alcalde de Bogotá anuncia plan de movilidad', 'Internacionales').anchor === 'Bogotá Colombia', 'Colombia + Bogotá (con tilde)');
    ok(det('Tormenta golpea la región', 'Internacionales').id === null, 'internacional sin país identificable → sin país (no se inventa)');
    ok(det('El gobierno usa nuevo sistema').id === 'DO', '"usa" (verbo) NO se confunde con Estados Unidos');
    ok(det('Precio de la china sube en el mercado', 'Economía').asiaPermitida === false, '"china" (naranja en RD) NO activa Asia');
    ok(det('China anuncia aranceles contra EEUU', 'Internacionales').asiaPermitida === true, '"China" (país) sí permite contexto asiático');
    ok(det('Dominicano gana título en Miami', 'Deportes').permitidos.has('US') && det('Dominicano gana título en Miami', 'Deportes').id === 'DO', 'dominicano en Miami: RD principal, EE.UU. permitido');

    console.log('\nAnclaje obligatorio de consultas');
    const cRD = det('Abinader en Palacio Nacional');
    ok(geo.anclarConsulta('foto del puente', cRD) === `${cRD.anchor} foto del puente` && /República Dominicana/.test(cRD.anchor), `la consulta genérica se antepone con el contexto → "${geo.anclarConsulta('foto del puente', cRD)}"`);
    ok(geo.anclarConsulta(geo.anclarConsulta('puente', cRD), cRD) === geo.anclarConsulta('puente', cRD), 'idempotente (no duplica el contexto)');
    ok(geo.anclarConsulta('elecciones', det('Elecciones en Panamá', 'Internacionales'), { idioma: 'en' }) === 'Panama elecciones', 'idioma en → nombre en inglés');
    ok(geo.anclarConsulta('Santo Domingo puente', cRD) === 'Santo Domingo puente', 'si ya incluye el lugar no se toca');
    ok(geo.anclarConsulta('x', undefined).includes('República Dominicana'), 'sin contexto: cae a la línea local, nunca búsqueda genérica');

    const cache = require('../lib/cache'); cache.iniciar();
    const dep = require('../lib/imagenes/depurador'), web = require('../lib/imagenes/web');
    const urls = []; dep.descargarPagina = async (u) => { urls.push(decodeURIComponent(u)); return { html: '', urlFinal: u }; };
    await web.buscarPaginas('puente nuevo', det('Obras en Los Mina'));
    ok(urls.length === 2 && urls.every(u => /q=Los Mina República Dominicana puente nuevo|q=Santo Domingo Este República Dominicana puente nuevo/.test(u)), 'Bing y DuckDuckGo reciben la consulta con el contexto antepuesto');
    ok(/setmkt=es-DO/.test(urls[0]), 'mercado de Bing = país de la noticia (es-DO)');
    urls.length = 0; await web.buscarPaginas('plan canal', det('Panamá anuncia plan del Canal', 'Internacionales'));
    ok(urls.every(u => /q=Panamá plan canal/.test(u)) && /setmkt=es-PA/.test(urls[0]), 'Panamá: consulta anclada y mercado es-PA');
    urls.length = 0; await web.buscarPaginas('tormenta', det('Tormenta golpea la región', 'Internacionales'));
    ok(urls.every(u => /q=noticias internacionales tormenta/.test(u)), 'internacional sin país: igualmente anclada (nunca genérica)');

    console.log('\nValidación estricta de candidatos');
    const ahora = new Date('2026-10-25');
    const ctx = geo.detectarContexto({ titulo: 'Abinader inaugura puente en Los Mina', categoria: 'Nacionales', contenido: 'El presidente Luis Abinader inauguró un puente en Santo Domingo Este.' });
    const v = o => geo.validarCandidato({ urlPagina: 'https://upload.wikimedia.org/x', urlDescarga: 'https://upload.wikimedia.org/a.jpg', ...o }, ctx, { ahora });
    ok(v({ titulo: 'Puente en Los Mina, Santo Domingo Este', fecha: '2026-10-20' }).ok, 'foto local, reciente → pasa');
    ok(v({ titulo: 'Luis Abinader inaugura puente en Santo Domingo' }).ok, 'persona de la noticia → pasa');
    for (const [t, motivo, extra] of [
        ['Monte Fuji en primavera, Japón', /Asia/], ['Templo en Bangkok al amanecer', /Asia/], ['Terrazas de arroz en Bali, Santo Domingo tour', /Asia/],
        ['Puente de Brooklyn, Nueva York', /ajeno/], ['Obras viales', /Asia|ajeno/, { urlPagina: 'https://example.jp/a' }],
        ['Puente en Santo Domingo (foto de archivo)', /archivo/], ['Imagen ilustrativa de puente, Santo Domingo', /archivo/], ['Stock photo bridge Santo Domingo', /archivo/],
        ['Puente en Santo Domingo', /antigua/, { fecha: '2019-03-02' }], ['Puente en Santo Domingo 2018', /antigua/],
        ['Cristiano Ronaldo celebra gol en Santo Domingo', /persona fuera/], ['Retrato de hombre en Santo Domingo', /retrato/],
        ['Puente sobre el río', /modo estricto/]]) {
        const r = v({ titulo: t, ...(extra || {}) }); ok(!r.ok && motivo.test(r.motivo), `descarta "${t}" → ${r.motivo}`);
    }
    ok(v({ titulo: 'Puente sobre el río', urlPagina: 'https://diariolibre.com/nota/1' }).ok, 'medio local dominicano cuenta como evidencia local');
    ok(v({ titulo: 'Puente sobre el río', urlPagina: 'https://presidencia.gob.do/nota/1' }).ok, 'dominio .gob.do cuenta como evidencia local');
    ok(geo.validarCandidato({ titulo: 'Puente sobre el río', urlPagina: 'https://x.org/a', urlDescarga: 'https://x.org/a.jpg' }, ctx, { ahora, estricto: false }).ok, 'IMG_GEO_ESTRICTO=0: sin evidencia positiva pasa (las demás reglas siguen)');
    ok(v({ titulo: 'Jugo de china en Santo Domingo' }).ok, '"jugo de china" en RD no se toma por China');
    ok(v({ titulo: 'Dominican Republic Announces New Bridge Plan' }).ok, 'titular en Title Case no se confunde con nombre de persona');
    ok(v({ titulo: 'Foto de la fuente', esFuente: true, urlPagina: 'https://listindiario.com/n', fecha: '2019-01-01' }).ok, 'la foto de la fuente original (og:image de la nota) pasa');
    ok(!v({ titulo: 'Puente (foto de archivo)', esFuente: true }).ok, '...salvo que sea de archivo');
    const ctxPA = geo.detectarContexto({ titulo: 'Panamá anuncia plan del Canal', categoria: 'Internacionales' });
    ok(!geo.validarCandidato({ titulo: 'Plaza en Santo Domingo, República Dominicana', urlPagina: 'https://x.org/a' }, ctxPA, { ahora }).ok, 'noticia de Panamá: foto de RD descartada');

    console.log('\nFlujo completo con filtro geográfico');
    const { clasificar } = require('../lib/imagenes/licencias');
    const base = { id: 'x:1', proveedor: 'Wikimedia Commons', autor: 'Juan', urlPagina: 'https://commons.wikimedia.org/wiki/File:X.jpg', urlDescarga: 'https://upload.wikimedia.org/a.jpg', titulo: 'Puente Los Mina', descripcion: '', categorias: [], ancho: 1600, alto: 1000, anchoOriginal: 3000, altoOriginal: 2000, licencia: clasificar('CC BY 4.0') };
    const rb = Buffer.alloc(1600 * 900 * 3); for (let i = 0; i < rb.length; i++) rb[i] = ((i % 1600) * 3 + (i >> 11) * 5 + (i * i >> 7)) & 255;
    const foto = await sharp(rb, { raw: { width: 1600, height: 900, channels: 3 } }).jpeg().toBuffer();
    dep.descargar = async () => foto;
    const webMod = require('../lib/imagenes/web'); let recibido = null;
    webMod.candidatos = async a => { recibido = a; return [
        { ...base, id: 'web:tokyo', proveedor: 'example.jp', web: true, titulo: 'Puente Los Mina visto desde Tokio', urlPagina: 'https://example.jp/a', licencia: { permitida: true, tipo: 'fuente', etiqueta: 'f', url: null, requiereCredito: true } },
        { ...base, id: 'web:archivo', proveedor: 'listindiario.com', web: true, titulo: 'Puente Los Mina (foto de archivo)', urlPagina: 'https://listindiario.com/a', licencia: { permitida: true, tipo: 'fuente', etiqueta: 'f', url: null, requiereCredito: true } },
        { ...base, id: 'web:ok', proveedor: 'diariolibre.com', web: true, titulo: 'Abinader inaugura puente Los Mina', urlPagina: 'https://diariolibre.com/a', fecha: '2026-10-24', licencia: { permitida: true, tipo: 'fuente', etiqueta: 'Imagen de la fuente original', url: null, requiereCredito: true } }]; };
    const { obtenerImagenLimpia } = require('../lib/imagenes/index');
    const r = await obtenerImagenLimpia({ titulo: 'Abinader inaugura puente en Los Mina', contenido: 'x', categoria: 'Nacionales' });
    ok(recibido?.contexto?.id === 'DO' && /Los Mina/.test(recibido.contexto.anchor), 'el extractor web recibe el contexto geográfico');
    ok(/diariolibre/.test(r.fuente), `elige la foto local y reciente; descarta Tokio y archivo (${r.fuente})`);

    // ═══════════════ 2. VIDEOS CORTOS ═══════════════
    console.log('\nVideos cortos (FFmpeg)');
    const videos = require('../lib/videos');
    const disp = await videos.disponible(); ok(disp.ok, `FFmpeg disponible (${disp.version})`);
    const clips = path.join(TMP, 'clips'); fs.mkdirSync(clips);
    const gen = (nombre, size, seg, extra = [], audio = true) => sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30:duration=${seg}`,
        ...(audio ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seg}`, '-c:a', 'aac'] : ['-an']), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', ...extra, path.join(clips, nombre)]);
    const META = ['-metadata', 'title=Clip de prensa', '-metadata', 'comment=Embargo Presidencia', '-metadata', 'location=+18.4861-069.9312/', '-metadata', 'creation_time=2026-10-20T10:00:00Z', '-metadata', 'artist=Camarógrafo X', '-metadata:s:v:0', 'handler_name=Whatsapp Video'];
    gen('horizontal.mp4', '1920x1080', 6, META); gen('vertical.mp4', '1080x1920', 5, ['-metadata', 'title=Reel'], false);
    gen('largo.mp4', '320x240', 45); gen('corto.mp4', '640x360', 1);
    const origMeta = probe(path.join(clips, 'horizontal.mp4')).format.tags;
    ok(origMeta.title && origMeta.location && origMeta.comment && origMeta.creation_time, 'el clip original trae metadatos (título, GPS, comentario, fecha)');

    const d = await videos.procesarArchivo(path.join(clips, 'horizontal.mp4'), { fuente: 'Presidencia RD', titulo: 'Prueba' });
    const salida = path.join(process.env.IMG_DIR, d.nombre), pj = probe(salida);
    const vs = pj.streams.find(s => s.codec_type === 'video'), as = pj.streams.find(s => s.codec_type === 'audio');
    ok(vs.codec_name === 'h264' && vs.profile === 'High' && vs.pix_fmt === 'yuv420p' && as?.codec_name === 'aac', 'salida H.264 High yuv420p + AAC (reproduce en todos los navegadores)');
    ok(vs.width === 1280 && vs.height === 720 && d.ancho === 1280, '1920x1080 → 1280x720');
    ok(Math.abs(parseFloat(pj.format.duration) - 6) < 0.5, `duración conservada (${pj.format.duration}s)`);
    const tags = { ...pj.format.tags }, claves = Object.keys(tags).join(',');
    ok(!/title|comment|location|creation_time|artist|encoder/.test(claves), `metadatos del origen eliminados (quedan: ${claves})`);
    ok(!pj.streams.some(s => /Whatsapp/i.test(JSON.stringify(s.tags || {}))), 'etiquetas de pista (handler "Whatsapp Video") eliminadas');
    const bytes = fs.readFileSync(salida); ok(bytes.indexOf('moov') < bytes.indexOf('mdat'), 'faststart: el átomo moov va antes de los datos (reproducción inmediata)');
    ok(d.bytes < fs.statSync(path.join(clips, 'horizontal.mp4')).size, `empaquetado más liviano (${(fs.statSync(path.join(clips, 'horizontal.mp4')).size / 1024) | 0} KB → ${(d.bytes / 1024) | 0} KB)`);
    ok(d.original.metadatosEliminados.includes('title') && d.original.metadatosEliminados.includes('location'), 'el descriptor registra qué metadatos se quitaron');

    // degradado: la franja inferior izquierda es mucho más oscura que la del clip original
    const lumi = async (png) => { const { data, info } = await sharp(png).resize(1280, 720, { fit: 'fill' }).extract({ left: 0, top: 560, width: 640, height: 130 }).greyscale().raw().toBuffer({ resolveWithObject: true }); return data.reduce((a, b) => a + b, 0) / data.length; };
    sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', path.join(clips, 'horizontal.mp4'), '-frames:v', '1', path.join(clips, 'orig.png')]);
    sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', salida, '-frames:v', '1', path.join(clips, 'proc.png')]);
    const [lo, lp] = [await lumi(path.join(clips, 'orig.png')), await lumi(path.join(clips, 'proc.png'))];
    ok(lp < lo * 0.7, `degradado aplicado: luminosidad inferior ${lo.toFixed(0)} → ${lp.toFixed(0)}`);
    const pm = await sharp(fs.readFileSync(path.join(process.env.IMG_DIR, d.posterNombre))).metadata();
    ok(pm.format === 'jpeg' && pm.width === 1280 && !pm.exif, 'póster JPEG 1280x720 sin EXIF, extraído del video ya procesado');
    const desc = await videos.descriptor(d.nombre); ok(desc?.url === `https://elfarolaldia.com/video/${d.nombre}` && desc.fuente === 'Presidencia RD', 'descriptor persistido y recuperable por nombre');
    ok((await videos.descriptor('../../etc/passwd')) === null && (await videos.descriptor('efd-vid-x.mp4')) === null, 'descriptor: nombre inválido/inexistente → null');

    const dv = await videos.procesarArchivo(path.join(clips, 'vertical.mp4')); const pv = probe(path.join(process.env.IMG_DIR, dv.nombre));
    ok(pv.streams.find(s => s.codec_type === 'video').height === 1280 && !pv.streams.some(s => s.codec_type === 'audio'), 'reel vertical 1080x1920 → 720x1280, sin audio sigue funcionando');

    const falla = async (f, cod) => { try { await videos.procesarArchivo(f); return null; } catch (e) { return e.codigo; } };
    ok(await falla(path.join(clips, 'largo.mp4')) === 'largo', 'rechaza clips de más de 30 s');
    ok(await falla(path.join(clips, 'corto.mp4')) === 'corto', 'rechaza clips de menos de 3 s');
    fs.writeFileSync(path.join(clips, 'falso.mp4'), '<html>no soy video</html>'); ok(['invalido', 'formato'].includes(await falla(path.join(clips, 'falso.mp4'))), 'rechaza archivos que no son video');
    fs.writeFileSync(path.join(clips, 'evil.m3u8'), '#EXTM3U\n#EXTINF:10,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n'); ok(['invalido', 'formato'].includes(await falla(path.join(clips, 'evil.m3u8'))), 'una playlist HLS maliciosa NO se procesa (sin lectura de archivos del servidor)');
    for (const u of ['http://example.com/a.mp4', 'https://127.0.0.1/a.mp4', 'https://169.254.169.254/latest']) { let e; try { await videos.procesarDesdeUrl(u); } catch (x) { e = x; } ok(e?.codigo === 'url', `descarga por URL bloquea ${u}`); }

    // ═══════════════ 3. SERVIDOR (integración HTTP con pg simulado) ═══════════════
    console.log('\nServidor: rutas de video');
    const PORT = 18000 + Math.floor(Math.random() * 1000), vjson = path.join(TMP, 'video-noticia.json');
    const srv = spawn(process.execPath, ['-r', path.join(__dirname, 'mock-pg-video.js'), path.join(__dirname, '..', 'server.js')], {
        cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PORT: String(PORT), DATABASE_URL: 'postgres://x', BASE_URL: `http://127.0.0.1:${PORT}`, TEST_VIDEO_JSON: vjson } });
    let log = ''; srv.stdout.on('data', x => log += x); srv.stderr.on('data', x => log += x);
    const AUTH = 'Basic ' + Buffer.from('director:311').toString('base64');
    const req = (method, p, { headers = {}, body } = {}) => new Promise((res, rej) => {
        const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers, agent: false }, resp => { const parts = []; resp.on('data', c => parts.push(c)); resp.on('end', () => res({ status: resp.statusCode, headers: resp.headers, body: Buffer.concat(parts) })); });
        r.on('error', rej); if (body) r.write(body); r.end();
    });
    try {
        for (let i = 0; i < 80; i++) { try { if ((await req('GET', '/health')).status === 200) break; } catch {} await new Promise(r => setTimeout(r, 250)); if (i === 79) throw new Error('el servidor no arrancó:\n' + log.slice(-1500)); }
        const clip = fs.readFileSync(path.join(clips, 'horizontal.mp4'));
        ok((await req('POST', '/api/video/subir', { headers: { 'Content-Type': 'video/mp4' }, body: clip })).status === 401, 'subir clip sin sesión → 401');
        ok((await req('POST', '/api/video/subir', { headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: '{}' })).status === 415, 'Content-Type no-video → 415');
        ok((await req('POST', '/api/video/subir', { headers: { Authorization: AUTH, 'Content-Type': 'video/mp4' }, body: Buffer.from('basura') })).status === 422, 'cuerpo que no es video → 422 con mensaje');
        const up = await req('POST', '/api/video/subir?fuente=Polic%C3%ADa%20Nacional&titulo=Operativo', { headers: { Authorization: AUTH, 'Content-Type': 'video/mp4', 'Content-Length': clip.length }, body: clip });
        const j = JSON.parse(up.body); ok(up.status === 200 && j.success && /^efd-vid-/.test(j.video.nombre) && j.video.fuente === 'Policía Nacional', `POST /api/video/subir → ${j.video?.nombre}`);
        const full = await req('GET', `/video/${j.video.nombre}`);
        ok(full.status === 200 && full.headers['content-type'] === 'video/mp4' && full.headers['accept-ranges'] === 'bytes' && full.body.length === j.video.bytes, 'GET /video/:nombre sirve el MP4 completo');
        const part = await req('GET', `/video/${j.video.nombre}`, { headers: { Range: 'bytes=0-99' } });
        ok(part.status === 206 && part.body.length === 100 && part.headers['content-range'] === `bytes 0-99/${j.video.bytes}`, 'Range bytes=0-99 → 206 (Safari/iOS)');
        const cola = await req('GET', `/video/${j.video.nombre}`, { headers: { Range: 'bytes=-50' } }); ok(cola.status === 206 && cola.body.length === 50, 'Range de sufijo (-50) → 206');
        ok((await req('GET', `/video/${j.video.nombre}`, { headers: { Range: 'bytes=99999999-' } })).status === 416, 'Range fuera de rango → 416');
        ok((await req('GET', '/video/..%2F..%2Fetc%2Fpasswd')).status === 404 && (await req('GET', '/video/otro.mp4')).status === 404, 'nombre inválido o inexistente → 404');
        ok((await req('GET', `/img/${j.video.posterNombre}`)).status === 200, 'el póster se sirve por /img/');
        ok((await req('GET', '/api/video/status', { headers: { Authorization: AUTH } })).status === 200, 'GET /api/video/status');
        const adj = await req('POST', '/api/video/adjuntar/1', { headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: j.video.nombre }) });
        ok(adj.status === 200 && JSON.parse(adj.body).slug === 'prueba', 'POST /api/video/adjuntar/:id adjunta el clip a la noticia');
        ok((await req('POST', '/api/video/adjuntar/1', { headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'efd-vid-nope.mp4' }) })).status === 404, 'adjuntar clip inexistente → 404 (el servidor solo confía en clips procesados)');
        const du = await req('POST', '/api/video/desde-url', { headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://127.0.0.1/a.mp4' }) });
        ok(du.status === 400, 'desde-url con IP privada → 400 (anti-SSRF)');

        const sin = (await req('GET', '/noticia/prueba')).body.toString();
        ok(!sin.includes('<video') && !sin.includes('{{VIDEO}}'), 'noticia sin clip: sin <video> y sin marcador sin reemplazar');
        fs.writeFileSync(vjson, JSON.stringify({ video_nombre: j.video.nombre, video_url: j.video.url, video_poster: j.video.urlPoster, video_credito: 'Policía Nacional', video_duracion: j.video.duracion }));
        await req('POST', '/api/cache/purgar', { headers: { Authorization: AUTH } });                 // la página se cachea 120 s
        const pag = (await req('GET', '/noticia/prueba')).body.toString();
        ok(pag.includes(`<source src="/video/${j.video.nombre}" type="video/mp4">`) && pag.includes('Video: Policía Nacional') && /controls playsinline/.test(pag), 'la noticia muestra el <video> con póster y crédito');
        ok(/"@type":"VideoObject"/.test(pag) && pag.includes('og:video') && /PT6S/.test(pag), 'SEO: VideoObject (JSON-LD) + og:video');
    } catch (e) { console.error('--- log del servidor ---\n' + log.slice(-2500)); throw e; } finally { srv.kill('SIGKILL'); }

    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(`\n✅ ${pass} comprobaciones OK (fase final)\n`); process.exit(0);
})().catch(e => { console.error('\n❌', e.stack || e.message); process.exit(1); });
