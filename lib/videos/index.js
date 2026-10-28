'use strict';
/**
 * MICRO-PIPELINE DE VIDEOS CORTOS (clips flash / reels que las fuentes de prensa envían a los redactores).
 *
 *   clip original ──► validación (ffprobe) ──► FFmpeg local ──► MP4 listo para la web + póster + descriptor
 *
 *  FFmpeg hace, en una sola pasada:
 *   · DEGRADADO estético: sombra de marca (negro #070707) desde abajo y suave arriba + filete naranja #FF5500 + marca de agua del Farol
 *   · LIMPIEZA: elimina TODOS los metadatos (título, GPS/ubicación, dispositivo, fecha de creación, comentarios, capítulos, subtítulos,
 *     pistas de datos) y re-codifica, así no sobreviven marcas ocultas ni etiquetas pesadas del archivo original
 *   · EMPAQUETADO: H.264 High + AAC, ≤ 720p (vertical 720x1280 / horizontal 1280x720), CRF 26 con tope de bitrate, audio normalizado,
 *     `+faststart` (reproduce al instante en la noticia, sin esperar la descarga completa)
 *
 *  Seguridad: sin shell (spawn con argumentos), `-protocol_whitelist file` (el clip no puede arrastrar URLs/playlists), solo contenedores
 *  mp4/mov/webm/mkv/avi, límite de tamaño y de duración, descarga por URL con anti-SSRF, una codificación a la vez (cola) y timeout.
 *
 *  ⚠️ No se intenta borrar marcas de agua/créditos de terceros incrustados en la imagen: son atribución. El crédito de la fuente
 *     se guarda aparte y se muestra bajo el video en la noticia.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const sharp = require('sharp');
const almacen = require('../imagenes/almacen');
const dep = require('../imagenes/depurador');
const { cargarMarca } = require('../imagenes/marca');

const num = (k, d) => { const v = parseFloat(process.env[k]); return Number.isFinite(v) ? v : d; };
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const MIN_SEG = num('VIDEO_MIN_SEG', 3);
const MAX_SEG = num('VIDEO_MAX_SEG', 30);                  // clips flash: 15-20 s; margen hasta 30
const MAX_BYTES = num('VIDEO_MAX_MB', 80) * 1024 * 1024;
const TIMEOUT_MS = num('VIDEO_TIMEOUT_MS', 180000);
const CRF = num('VIDEO_CRF', 26);
const DEGRADADO = process.env.VIDEO_DEGRADADO !== '0';
const BASE_URL = (process.env.BASE_URL || 'https://elfarolaldia.com').replace(/\/$/, '');
const FORMATOS_OK = ['mov', 'mp4', 'matroska', 'webm', 'avi'];
const NOMBRE_RE = /^efd-vid-[a-z0-9-]+\.mp4$/;
const LIMITES = { minSeg: MIN_SEG, maxSeg: MAX_SEG, maxMB: MAX_BYTES / 1048576 };

class VideoError extends Error { constructor(msg, codigo = 'error') { super(msg); this.codigo = codigo; } }

// ── Utilidades ──────────────────────────────────────────────────────────
function run(cmd, args, { timeoutMs = TIMEOUT_MS, maxOut = 2e6 } = {}) {
    return new Promise((ok, ko) => {
        const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '', vencido = false;
        p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
        const t = setTimeout(() => { vencido = true; p.kill('SIGKILL'); }, timeoutMs);
        p.stdout.on('data', d => { if (out.length < maxOut) out += d; });
        p.stderr.on('data', d => { if (err.length < 16000) err += d; });
        p.on('error', e => { clearTimeout(t); ko(e.code === 'ENOENT' ? new VideoError('FFmpeg no está instalado en el servidor', 'sin_ffmpeg') : e); });
        p.on('close', code => { clearTimeout(t); vencido ? ko(new VideoError('FFmpeg excedió el tiempo límite', 'timeout')) : ok({ code, out, err }); });
    });
}

let _disp = null;
/** ¿Hay FFmpeg/FFprobe? (cacheado) */
function disponible() {
    if (!_disp) _disp = (async () => {
        try {
            const [a, b] = await Promise.all([run(FFMPEG, ['-version'], { timeoutMs: 8000 }), run(FFPROBE, ['-version'], { timeoutMs: 8000 })]);
            return { ok: a.code === 0 && b.code === 0, version: (a.out.match(/ffmpeg version (\S+)/) || [])[1] || null };
        } catch (e) { return { ok: false, error: e.message }; }
    })();
    return _disp;
}

// Una codificación a la vez: Railway tiene pocas CPU y el LLM local compite por ellas.
let _cola = Promise.resolve();
const enCola = fn => { const p = _cola.then(fn, fn); _cola = p.catch(() => {}); return p; };

/** ffprobe → { duracion, ancho, alto, fps, audio, codec, formato, etiquetas[] } (ancho/alto ya con la rotación aplicada). */
async function sondear(archivo) {
    let r;
    try { r = await run(FFPROBE, ['-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json', '-show_format', '-show_streams', archivo], { timeoutMs: 20000 }); }
    catch (e) { if (e instanceof VideoError) throw e; throw new VideoError('No se pudo analizar el archivo', 'invalido'); }
    let j; try { j = JSON.parse(r.out); } catch { j = null; }
    if (r.code !== 0 || !j?.format) throw new VideoError('El archivo no es un video válido', 'invalido');
    const formatos = String(j.format.format_name || '').split(',');
    if (!formatos.some(f => FORMATOS_OK.includes(f))) throw new VideoError(`Formato de contenedor no admitido (${j.format.format_name}). Envía MP4, MOV, WebM o MKV`, 'formato');
    const streams = j.streams || [];
    const v = streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
    if (!v) throw new VideoError('El archivo no contiene pista de video', 'invalido');
    let rot = Number(v.tags?.rotate || 0);
    for (const sd of v.side_data_list || []) if (sd.rotation !== undefined) rot = Number(sd.rotation);
    const girado = Math.abs(Math.round(rot)) % 180 === 90;
    const [fn, fd] = String(v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v.r_frame_rate || '0/1').split('/').map(Number);
    const etiquetas = new Set(Object.keys(j.format.tags || {}));
    streams.forEach(s => Object.keys(s.tags || {}).forEach(k => etiquetas.add(k)));
    return {
        duracion: parseFloat(j.format.duration || v.duration || 0),
        ancho: girado ? v.height : v.width, alto: girado ? v.width : v.height,
        fps: fd ? fn / fd : 0, audio: streams.some(s => s.codec_type === 'audio'),
        codec: v.codec_name, formato: j.format.format_name, bytes: Number(j.format.size || 0),
        etiquetas: [...etiquetas], formatoTags: j.format.tags || {}, capitulos: (j.chapters || []).length,
    };
}

/** Tamaño de salida: nunca se amplía; horizontal ≤ 1280x720, vertical ≤ 720x1280; lados pares (H.264). */
function dimsSalida(w, h) {
    const horizontal = w >= h, maxW = horizontal ? 1280 : 720, maxH = horizontal ? 720 : 1280;
    const f = Math.min(1, maxW / w, maxH / h), par = n => Math.max(2, Math.floor(n / 2) * 2);
    return { W: par(w * f), H: par(h * f) };
}

/** Capa RGBA del tamaño del video: degradado de marca + filete naranja + marca de agua. Una sola imagen → un solo overlay en FFmpeg. */
async function crearOverlay(W, H) {
    const fil = Math.max(4, Math.round(H * 0.008));
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>
      <linearGradient id="b" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#070707" stop-opacity="0.9"/><stop offset="0.22" stop-color="#1a0a00" stop-opacity="0.55"/><stop offset="0.42" stop-color="#070707" stop-opacity="0"/></linearGradient>
      <linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070707" stop-opacity="0.5"/><stop offset="0.16" stop-color="#070707" stop-opacity="0"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#b)"/><rect width="100%" height="100%" fill="url(#t)"/>
      <rect y="${H - fil}" width="100%" height="${fil}" fill="#FF5500"/></svg>`);
    const capas = [{ input: svg, left: 0, top: 0 }];
    const wm = await cargarMarca().catch(() => null);
    if (wm) {
        const m = await sharp(wm).resize({ width: Math.max(40, Math.round(W * (W >= H ? 0.16 : 0.26))), fit: 'inside' }).png().toBuffer();
        const mt = await sharp(m).metadata(), mg = Math.round(W * 0.025);
        capas.push({ input: m, left: Math.max(0, W - mt.width - mg), top: Math.max(0, H - mt.height - mg - fil) });
    }
    return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(capas).png().toBuffer();
}

// ── Pipeline principal ──────────────────────────────────────────────────
/**
 * Procesa un clip local. Devuelve el descriptor { nombre, poster, url, urlPoster, duracion, ancho, alto, bytes, fuente, ... }.
 * @param {string} entrada ruta del clip original (no se modifica ni se borra)
 * @param {{fuente?:string, titulo?:string}} opts  fuente = crédito que se muestra bajo el video
 */
async function procesarArchivo(entrada, { fuente = '', titulo = '' } = {}) {
    const d = await disponible();
    if (!d.ok) throw new VideoError('FFmpeg no está disponible en el servidor', 'sin_ffmpeg');
    const st = await fsp.stat(entrada);
    if (st.size > MAX_BYTES) throw new VideoError(`El clip pesa más de ${LIMITES.maxMB} MB`, 'grande');
    const info = await sondear(entrada);
    if (!(info.duracion >= MIN_SEG)) throw new VideoError(`El clip dura ${info.duracion.toFixed(1)} s; el mínimo es ${MIN_SEG} s`, 'corto');
    if (info.duracion > MAX_SEG + 0.5) throw new VideoError(`El clip dura ${info.duracion.toFixed(1)} s; el máximo para clips flash es ${MAX_SEG} s`, 'largo');
    if (info.ancho < 240 || info.alto < 240) throw new VideoError(`Resolución demasiado baja (${info.ancho}x${info.alto})`, 'resolucion');

    return enCola(async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'efd-vid-'));
        const t0 = Date.now();
        try {
            const { W, H } = dimsSalida(info.ancho, info.alto);
            const overlayPng = DEGRADADO ? await crearOverlay(W, H) : null;
            const ovFile = path.join(dir, 'capa.png'), salida = path.join(dir, 'salida.mp4');
            if (overlayPng) await fsp.writeFile(ovFile, overlayPng);

            const base = `[0:v:0]scale=${W}:${H}:flags=lanczos,setsar=1${info.fps > 30.5 ? ',fps=30' : ''},format=yuv420p`;
            const filtro = overlayPng ? `${base}[b];[b][1:v]overlay=0:0:shortest=1:format=auto,format=yuv420p[v]` : `${base}[v]`;
            const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-threads', '2', '-protocol_whitelist', 'file', '-i', entrada];
            if (overlayPng) args.push('-protocol_whitelist', 'file', '-loop', '1', '-framerate', '30', '-i', ovFile);
            args.push('-filter_complex', filtro, '-map', '[v]');
            if (info.audio) args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-ar', '44100', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
            args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(CRF), '-profile:v', 'high', '-level', '4.0', '-maxrate', '2800k', '-bufsize', '5600k',
                '-map_metadata', '-1', '-map_chapters', '-1', '-metadata:s:v:0', 'encoder=', '-sn', '-dn',                       // fuera metadatos, capítulos, subtítulos y pistas de datos
                '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',         // sin etiqueta "encoder"/versión de FFmpeg
                '-movflags', '+faststart', '-t', String(Math.min(info.duracion, MAX_SEG)), salida);
            const r = await run(FFMPEG, args);
            if (r.code !== 0) throw new VideoError(`FFmpeg falló: ${r.err.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 300)}`, 'ffmpeg');

            const fin = await sondear(salida);
            if (!(fin.duracion >= 1)) throw new VideoError('El video procesado salió vacío', 'ffmpeg');

            // Póster = fotograma del video ya con degradado y marca
            const posterPng = path.join(dir, 'poster.png');
            const rp = await run(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-protocol_whitelist', 'file', '-ss', String(Math.min(1, fin.duracion / 2)), '-i', salida, '-frames:v', '1', posterPng], { timeoutMs: 30000 });
            if (rp.code !== 0) throw new VideoError('No se pudo extraer el póster', 'ffmpeg');
            const poster = await sharp(posterPng).jpeg({ quality: 82, mozjpeg: true }).toBuffer();   // sharp no copia metadatos

            const id = `efd-vid-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
            const buf = await fsp.readFile(salida);
            const desc = {
                nombre: `${id}.mp4`, posterNombre: `${id}.jpg`, duracion: Math.round(fin.duracion * 10) / 10, ancho: fin.ancho, alto: fin.alto, bytes: buf.length,
                fuente: String(fuente || '').slice(0, 120) || null, titulo: String(titulo || '').slice(0, 200) || null, creado: new Date().toISOString(),
                original: { duracion: Math.round(info.duracion * 10) / 10, ancho: info.ancho, alto: info.alto, codec: info.codec, formato: info.formato, bytes: info.bytes || st.size,
                    metadatosEliminados: info.etiquetas, capitulosEliminados: info.capitulos },
                proceso: { degradado: !!overlayPng, ms: Date.now() - t0 },
            };
            await almacen.guardar(desc.nombre, buf, { tipo: 'video', fuente: desc.fuente }, 'video/mp4');
            await almacen.guardar(desc.posterNombre, poster, { tipo: 'video-poster', video: desc.nombre });
            await almacen.guardar(`${id}.json`, Buffer.from(JSON.stringify(desc)), { tipo: 'video-descriptor' }, 'application/json');
            console.log(`   🎬 [video] ${desc.nombre} ${info.ancho}x${info.alto}→${fin.ancho}x${fin.alto} ${desc.duracion}s ${(info.bytes || st.size) / 1024 | 0}KB→${buf.length / 1024 | 0}KB (${desc.proceso.ms}ms, metadatos quitados: ${info.etiquetas.length})`);
            return _conUrls(desc);
        } finally { await fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
    });
}

const _conUrls = d => ({ ...d, url: `${BASE_URL}/video/${d.nombre}`, urlPoster: `${BASE_URL}/img/${d.posterNombre}` });

/** Descriptor guardado de un video ya procesado (null si no existe). El servidor solo confía en esto, nunca en URLs del cliente. */
async function descriptor(nombre) {
    if (!NOMBRE_RE.test(String(nombre || ''))) return null;
    const buf = await almacen.leer(nombre.replace(/\.mp4$/, '.json')).catch(() => null);
    if (!buf) return null;
    try { return _conUrls(JSON.parse(buf.toString('utf8'))); } catch { return null; }
}

// ── Entrada de archivos ─────────────────────────────────────────────────
/** Vuelca un stream (petición HTTP o descarga) a un archivo temporal con tope de bytes. Devuelve { archivo, limpiar }. */
async function recibirEnTemporal(stream, { maxBytes = MAX_BYTES } = {}) {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'efd-vid-in-'));
    const archivo = path.join(dir, 'entrada.bin');
    const limpiar = () => fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    try {
        await new Promise((ok, ko) => {
            let total = 0, fallo = false;
            const out = fs.createWriteStream(archivo);
            const abortar = e => { if (fallo) return; fallo = true; stream.unpipe(out); out.destroy(); ko(e); };
            stream.on('data', c => { total += c.length; if (total > maxBytes) abortar(new VideoError(`El clip pesa más de ${maxBytes / 1048576} MB`, 'grande')); });
            stream.on('error', abortar); out.on('error', abortar);
            out.on('finish', () => !fallo && ok());
            stream.pipe(out);
        });
        if ((await fsp.stat(archivo)).size === 0) throw new VideoError('El archivo llegó vacío', 'invalido');
    } catch (e) { await limpiar(); throw e; }
    return { archivo, limpiar };
}

/** Descarga un clip desde una URL https pública (anti-SSRF, redirecciones validadas, tope de tamaño). */
async function descargarVideo(url, { maxBytes = MAX_BYTES, ua = 'ElFarolAlDia/2.0' } = {}) {
    let actual = url;
    for (let salto = 0; salto < 4; salto++) {
        try { await dep.urlSegura(actual); } catch (e) { throw new VideoError(`URL no permitida (${e.message})`, 'url'); }
        const r = await fetch(actual, { redirect: 'manual', headers: { 'User-Agent': ua, Accept: 'video/*,*/*;q=0.5' }, signal: AbortSignal.timeout(120000) });
        if ([301, 302, 303, 307, 308].includes(r.status)) { actual = new URL(r.headers.get('location'), actual).toString(); continue; }
        if (!r.ok) throw new VideoError(`La fuente respondió HTTP ${r.status}`, 'url');
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (!/^(video\/|application\/octet-stream|binary\/octet-stream)/.test(ct)) throw new VideoError(`La URL no es un video (${ct || 'sin content-type'})`, 'url');
        if (Number(r.headers.get('content-length') || 0) > maxBytes) throw new VideoError(`El clip pesa más de ${maxBytes / 1048576} MB`, 'grande');
        return recibirEnTemporal(Readable.fromWeb(r.body), { maxBytes });
    }
    throw new VideoError('Demasiadas redirecciones', 'url');
}

async function procesarDesdeUrl(url, opts = {}) {
    if (!/^https:\/\//i.test(url || '')) throw new VideoError('Solo se aceptan URLs https', 'url');
    const { archivo, limpiar } = await descargarVideo(url);
    try { return await procesarArchivo(archivo, opts); } finally { await limpiar(); }
}

// ── Servir MP4 con soporte de Range (Safari/iOS lo exigen para reproducir) ──
async function servir(req, res) {
    const nombre = req.params.nombre;
    if (!NOMBRE_RE.test(nombre)) return res.status(404).send('Video no disponible');
    const buf = await almacen.leer(nombre).catch(() => null);
    if (!buf) return res.status(404).send('Video no disponible');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public,max-age=31536000,immutable');
    const rango = req.headers.range;
    if (!rango) { res.setHeader('Content-Length', buf.length); return res.end(buf); }
    const m = /^bytes=(\d*)-(\d*)$/.exec(rango);
    let ini, fin;
    if (m && (m[1] || m[2])) {
        if (m[1] === '') { ini = Math.max(0, buf.length - Number(m[2])); fin = buf.length - 1; }
        else { ini = Number(m[1]); fin = m[2] === '' ? buf.length - 1 : Math.min(Number(m[2]), buf.length - 1); }
    }
    if (ini === undefined || ini > fin || ini >= buf.length) { res.setHeader('Content-Range', `bytes */${buf.length}`); return res.status(416).end(); }
    res.status(206).setHeader('Content-Range', `bytes ${ini}-${fin}/${buf.length}`);
    res.setHeader('Content-Length', fin - ini + 1);
    res.end(buf.subarray(ini, fin + 1));
}

module.exports = { procesarArchivo, procesarDesdeUrl, recibirEnTemporal, descargarVideo, sondear, descriptor, servir, disponible, dimsSalida,
    VideoError, NOMBRE_RE, LIMITES };
