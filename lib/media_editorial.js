const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

function runCmd(bin, args, timeoutMs = 45000) {
  return new Promise((resolve) => {
    let settled = false;
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { proc.kill('SIGKILL'); } catch (_) {}
        resolve({ ok: false, code: -1, stdout, stderr: `${stderr}\nTIMEOUT` });
      }
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, code: -1, stdout, stderr: err.message });
      }
    });

    proc.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: code === 0, code, stdout, stderr });
      }
    });
  });
}

async function probeMedia(filePath) {
  const res = await runCmd(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'stream=width,height,codec_type,duration',
    '-of', 'json',
    filePath,
  ], 15000);
  if (!res.ok) return null;
  try {
    return JSON.parse(res.stdout);
  } catch (_) {
    return null;
  }
}

/**
 * Recorte editorial de imagen con FFmpeg para eliminar franjas/banners/esquinas de terceros
 * y opcionalmente estampar marca propia sin romper la publicación si falla.
 */
async function procesarImagenEditorial(inputPath, outputPath, opts = {}) {
  try {
    await fsp.access(inputPath, fs.constants.R_OK);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });

    // Porcentaje de recorte editorial (ej. 0.06 = 6% arriba/abajo para quitar banners/logos)
    const cropTop = Number.isFinite(opts.cropTop) ? opts.cropTop : 0.06;
    const cropBottom = Number.isFinite(opts.cropBottom) ? opts.cropBottom : 0.08;
    const cropSide = Number.isFinite(opts.cropSide) ? opts.cropSide : 0.02;
    const targetWidth = Number.isFinite(opts.width) ? opts.width : 1200;

    const keepH = Math.max(0.5, 1 - cropTop - cropBottom);
    const keepW = Math.max(0.6, 1 - cropSide * 2);

    const cropFilter = `crop=iw*${keepW}:ih*${keepH}:iw*${cropSide}:ih*${cropTop},scale=${targetWidth}:-2:flags=lanczos`;

    const args = ['-y', '-i', inputPath];
    let vf = cropFilter;

    if (opts.watermarkPath) {
      try {
        await fsp.access(opts.watermarkPath, fs.constants.R_OK);
        const wmW = Math.max(80, Math.round(targetWidth * 0.16));
        const margin = 18;
        args.push('-i', opts.watermarkPath);
        vf = `[0:v]${cropFilter}[base];[1:v]scale=${wmW}:-1,format=rgba,colorchannelmixer=aa=0.85[wm];[base][wm]overlay=W-w-${margin}:H-h-${margin}:format=auto`;
      } catch (_) {
        // Si no existe la marca, continúa solo con el recorte editorial limpio
      }
    }

    args.push('-vf', vf);
    if (vf.includes('[base]')) {
      // Ya mapeado implícitamente por el último filtro o con -map
      args.splice(args.indexOf('-vf'), 2, '-filter_complex', vf);
    }

    args.push('-q:v', '2', outputPath);

    const res = await runCmd(FFMPEG, args, 45000);
    if (!res.ok) {
      return { ok: false, outputPath: inputPath, fallback: true, error: res.stderr.slice(-300) };
    }

    const info = await probeMedia(outputPath);
    return { ok: true, outputPath, fallback: false, probe: info };
  } catch (err) {
    return { ok: false, outputPath: inputPath, fallback: true, error: err.message };
  }
}

/**
 * Recorte y preparación de clip breve con FFmpeg (sin alterar el flujo principal si falla).
 */
async function editarClipEditorial(inputPath, outputPath, opts = {}) {
  try {
    await fsp.access(inputPath, fs.constants.R_OK);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });

    const startSec = Number.isFinite(opts.startSec) ? Math.max(0, opts.startSec) : 0;
    const durationSec = Number.isFinite(opts.durationSec) ? Math.min(30, Math.max(3, opts.durationSec)) : 15;
    const cropTop = Number.isFinite(opts.cropTop) ? opts.cropTop : 0.08;
    const cropBottom = Number.isFinite(opts.cropBottom) ? opts.cropBottom : 0.10;
    const keepH = Math.max(0.5, 1 - cropTop - cropBottom);

    const args = [
      '-y',
      '-ss', String(startSec),
      '-t', String(durationSec),
      '-i', inputPath,
      '-vf', `crop=iw:ih*${keepH}:0:ih*${cropTop},scale=1280:-2:flags=lanczos`,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '24',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ];

    const res = await runCmd(FFMPEG, args, 120000);
    if (!res.ok) {
      return { ok: false, outputPath: inputPath, fallback: true, error: res.stderr.slice(-300) };
    }

    return { ok: true, outputPath, fallback: false };
  } catch (err) {
    return { ok: false, outputPath: inputPath, fallback: true, error: err.message };
  }
}

module.exports = {
  procesarImagenEditorial,
  editarClipEditorial,
  probeMedia,
};
