/**
 * 🏮 EL FAROL AL DÍA — server.js V34.31 FINAL Y FUNCIONAL
 * 
 * STACK:
 * ✓ Express.js + PostgreSQL
 * ✓ Gemini 2.5 Flash (3 keys)
 * ✓ Anti-duplicados (similitud)
 * ✓ Monetización CPC
 * ✓ Telegram Bot
 * ✓ Panel redacción manual + IA
 */

require('dotenv').config();
const express = require('express');
const pg = require('pg');
const schedule = require('node-schedule');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch');
const axios = require('axios');
const crypto = require('crypto');

// CONFIG
const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// PostgreSQL
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Gemini Keys
const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY2,
  process.env.GEMINI_API_KEY3
];

let slotActual = 0;

// MIDDLEWARE
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('client'));

const auth = (req, res, next) => {
  if ((req.query.pin || req.body.pin) !== '311') {
    return res.status(401).json({ success: false, error: 'PIN incorrecto' });
  }
  next();
};

// ════════════════════════════════════════════════════════════════
// CREAR TABLAS
// ════════════════════════════════════════════════════════════════

async function crearTablas() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS noticias (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(255),
        slug VARCHAR(255) UNIQUE,
        seccion VARCHAR(50),
        contenido TEXT,
        imagen VARCHAR(500),
        descripcion_seo VARCHAR(160),
        keywords VARCHAR(255),
        redactor VARCHAR(100),
        vistas INT DEFAULT 0,
        fecha TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS noticias_publicadas_hoy (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(255),
        slug VARCHAR(255) UNIQUE,
        categoria VARCHAR(50),
        titulo_normalizado VARCHAR(255) UNIQUE,
        fecha_publicacion TIMESTAMP DEFAULT NOW(),
        gemini_key_num INT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS intentos_gemini (
        id SERIAL PRIMARY KEY,
        gemini_key_num INT,
        titulo_intento VARCHAR(255),
        resultado VARCHAR(50),
        timestamp_intento TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS config (
        id SERIAL PRIMARY KEY,
        clave VARCHAR(100) UNIQUE,
        valor TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS comentarios (
        id SERIAL PRIMARY KEY,
        noticia_id INT,
        nombre VARCHAR(100),
        email VARCHAR(100),
        texto TEXT,
        fecha TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('✅ Tablas listas');
  } catch (e) {
    console.error('❌ Error BD:', e.message);
  }
}

// ════════════════════════════════════════════════════════════════
// FUNCIONES AUXILIARES
// ════════════════════════════════════════════════════════════════

function slug(titulo) {
  return titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 80);
}

function normalizar(titulo) {
  return titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function similitud(s1, s2) {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  if (longer.length === 0) return 100;
  
  const dist = (s1, s2) => {
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) costs[j] = j;
        else if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
  };
  
  return ((longer.length - dist(longer, shorter)) / longer.length) * 100;
}

// ════════════════════════════════════════════════════════════════
// ANTI-DUPLICADOS
// ════════════════════════════════════════════════════════════════

async function verificarDuplicado(titulo, categoria) {
  try {
    const norm = normalizar(titulo);
    const result = await pool.query(
      `SELECT titulo FROM noticias_publicadas_hoy
       WHERE categoria = $1 AND fecha_publicacion > NOW() - INTERVAL '24 hours'
       LIMIT 50`,
      [categoria]
    );

    let maxSim = 0;
    for (const row of result.rows) {
      const sim = similitud(norm, normalizar(row.titulo));
      maxSim = Math.max(maxSim, sim);
    }

    return {
      esDuplicada: maxSim >= 80,
      similitud: maxSim.toFixed(1)
    };
  } catch (e) {
    return { esDuplicada: false, similitud: 0, error: e.message };
  }
}

async function guardarDuplicado(titulo, titulo_norm, slug, categoria, gemini_key_num) {
  try {
    await pool.query(
      `INSERT INTO noticias_publicadas_hoy 
       (titulo, titulo_normalizado, slug, categoria, gemini_key_num)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (titulo_normalizado) DO NOTHING`,
      [titulo, titulo_norm, slug, categoria, gemini_key_num]
    );
  } catch (e) {
    console.error('⚠️ Error guardando:', e.message);
  }
}

// ════════════════════════════════════════════════════════════════
// MONETIZACIÓN
// ════════════════════════════════════════════════════════════════

function monetizar(titulo, contenido, categoria) {
  let t = titulo;
  
  if (categoria === 'Economia') {
    if (!t.includes('inversión')) t = `${t} – Clima Inversión`;
  } else if (categoria === 'Nacionales') {
    if (t.includes('construcci') || t.includes('vivienda')) {
      t = `${t} – Plusvalía`;
    }
  }
  
  if (t.length > 110) t = t.substring(0, 107) + '...';
  return t;
}

// ════════════════════════════════════════════════════════════════
// GENERAR NOTICIA
// ════════════════════════════════════════════════════════════════

async function generarNoticia(categoria, intento = 0) {
  if (intento > 2) return null;

  try {
    slotActual = (slotActual + 1) % 3;
    const keyNum = slotActual + 1;
    const apiKey = GEMINI_KEYS[slotActual];

    console.log(`\n🚀 Key ${keyNum} - Generando ${categoria}`);

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Eres periodista de República Dominicana.
Escribe UNA noticia sobre ${categoria} en formato JSON.
Responde SOLO con JSON: {"titulo": "...", "descripcion": "...", "keywords": "...", "contenido": "..."}`;

    const response = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1500 }
    });

    const text = response.response.text();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON');

    const data = JSON.parse(match[0]);
    let titulo = (data.titulo || '').replace(/[*_#`"]/g, '').substring(0, 110);
    let desc = (data.descripcion || '').replace(/[*_#`]/g, '').substring(0, 160);
    let keywords = (data.keywords || '').split(',').map(k => k.trim()).join(', ');
    let contenido = data.contenido || '';

    if (!titulo || !contenido) throw new Error('Datos incompletos');

    // VERIFICAR DUPLICADO
    const dup = await verificarDuplicado(titulo, categoria);
    if (dup.esDuplicada) {
      console.log(`⚠️ Duplicada (${dup.similitud}%)`);
      await pool.query(
        `INSERT INTO intentos_gemini (gemini_key_num, titulo_intento, resultado)
         VALUES ($1, $2, $3)`,
        [keyNum, titulo, 'duplicada']
      );
      return generarNoticia(categoria, intento + 1);
    }

    const slugFinal = slug(titulo);
    const normTitulo = normalizar(titulo);
    const tituloMone = monetizar(titulo, contenido, categoria);

    // Guardar en anti-duplicados
    await guardarDuplicado(titulo, normTitulo, slugFinal, categoria, keyNum);

    // Imagen fallback
    let imagen = 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg';
    if (process.env.PEXELS_API_KEY) {
      try {
        const resp = await fetch(
          `https://api.pexels.com/v1/search?query=${encodeURIComponent(titulo)}&per_page=1`,
          { headers: { 'Authorization': process.env.PEXELS_API_KEY }, timeout: 5000 }
        );
        const d = await resp.json();
        if (d.photos && d.photos[0]) {
          imagen = d.photos[0].src.original;
        }
      } catch (e) {
        console.log('⚠️ Pexels error');
      }
    }

    // PUBLICAR
    await pool.query(
      `INSERT INTO noticias (titulo, slug, seccion, contenido, imagen, descripcion_seo, keywords, redactor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tituloMone, slugFinal, categoria, contenido, imagen, desc, keywords, 'IA']
    );

    console.log(`✅ Publicada: ${slugFinal}`);

    // Telegram
    if (process.env.TELEGRAM_TOKEN) {
      const msg = `📰 ${tituloMone}\n\n${desc}\n\n${BASE_URL}/${slugFinal}`;
      try {
        await axios.post(
          `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
          { chat_id: process.env.TELEGRAM_CHAT_ID, text: msg }
        );
      } catch (e) {
        console.log('⚠️ Telegram error');
      }
    }

    await pool.query(
      `INSERT INTO intentos_gemini (gemini_key_num, titulo_intento, resultado)
       VALUES ($1, $2, $3)`,
      [keyNum, titulo, 'publicada']
    );

    return { success: true, titulo: tituloMone, slug: slugFinal, url: `${BASE_URL}/${slugFinal}` };

  } catch (e) {
    console.error(`❌ Error Key ${slotActual + 1}:`, e.message);
    if (intento < 2) return generarNoticia(categoria, intento + 1);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// RUTAS
// ════════════════════════════════════════════════════════════════

app.get('/status', async (req, res) => {
  try {
    const count = await pool.query('SELECT COUNT(*) FROM noticias');
    res.json({
      version: '34.31',
      noticias: count.rows[0].count,
      modelo: 'gemini-2.5-flash',
      base_url: BASE_URL
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/generar-noticia', async (req, res) => {
  const { categoria = 'Nacionales' } = req.body;
  try {
    const resultado = await generarNoticia(categoria);
    res.json(resultado || { success: false });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/publicar', async (req, res) => {
  const { pin, titulo, seccion, contenido, redactor, imagen, seo_description } = req.body;
  if (pin !== '311') return res.status(401).json({ success: false });

  try {
    const slug_final = slug(titulo);
    await pool.query(
      `INSERT INTO noticias (titulo, slug, seccion, contenido, imagen, descripcion_seo, redactor)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [titulo, slug_final, seccion, contenido, imagen, seo_description, redactor]
    );
    res.json({ success: true, slug: slug_final, url: `${BASE_URL}/${slug_final}` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/noticias', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, titulo, slug, seccion, imagen, descripcion_seo, fecha, vistas
       FROM noticias ORDER BY fecha DESC LIMIT 100`
    );
    res.json({ success: true, noticias: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/eliminar/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM noticias WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/actualizar-imagen/:id', auth, async (req, res) => {
  try {
    await pool.query('UPDATE noticias SET imagen = $1 WHERE id = $2', [req.body.imagen, req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/estadisticas', async (req, res) => {
  try {
    const n = await pool.query('SELECT COUNT(*) FROM noticias');
    const v = await pool.query('SELECT SUM(vistas) FROM noticias');
    res.json({
      totalNoticias: n.rows[0].count,
      totalVistas: v.rows[0].sum || 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/config', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT clave, valor FROM config');
    const config = {};
    result.rows.forEach(r => { config[r.clave] = r.valor; });
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/config', auth, async (req, res) => {
  try {
    const keys = ['enabled', 'instruccion_principal', 'enfasis', 'tono', 'extension', 'evitar'];
    for (const k of keys) {
      if (k in req.body) {
        await pool.query(
          `INSERT INTO config (clave, valor) VALUES ($1, $2)
           ON CONFLICT (clave) DO UPDATE SET valor = $2`,
          [k, req.body[k]]
        );
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/memoria', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT gemini_key_num, titulo_intento, resultado FROM intentos_gemini
       ORDER BY timestamp_intento DESC LIMIT 50`
    );
    const registros = result.rows.map(r => ({
      tipo: 'intentos',
      valor: r.titulo_intento,
      resultado: r.resultado,
      key: r.gemini_key_num,
      pct_exito: r.resultado === 'publicada' ? 100 : 0
    }));
    res.json({ registros });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/comentarios', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.nombre, c.texto, c.fecha, n.titulo as noticia_titulo
       FROM comentarios c LEFT JOIN noticias n ON c.noticia_id = n.id
       ORDER BY c.fecha DESC LIMIT 50`
    );
    res.json({ comentarios: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/comentarios/eliminar/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM comentarios WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/coach', auth, async (req, res) => {
  const dias = parseInt(req.query.dias) || 7;
  try {
    const result = await pool.query(
      `SELECT seccion, COUNT(*) as total, SUM(vistas) as vistas, ROUND(AVG(vistas)) as prom
       FROM noticias WHERE fecha > NOW() - INTERVAL '${dias} days'
       GROUP BY seccion ORDER BY vistas DESC`
    );
    
    const cats = {};
    result.rows.forEach(r => {
      cats[r.seccion] = {
        total: r.total,
        vistas_promedio: r.prom || 0,
        rendimiento: Math.min(100, (r.prom || 0) / 10)
      };
    });
    
    const total_n = result.rows.reduce((s, r) => s + parseInt(r.total), 0);
    const total_v = result.rows.reduce((s, r) => s + (r.vistas || 0), 0);
    
    res.json({ success: true, categorias: cats, total_noticias: total_n, total_vistas: total_v });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/telegram/status', auth, async (req, res) => {
  res.json({
    token_activo: !!process.env.TELEGRAM_TOKEN,
    chat_id: process.env.TELEGRAM_CHAT_ID || 'No',
    status: 'OK'
  });
});

app.post('/api/telegram/test', auth, async (req, res) => {
  try {
    const msg = `🏮 Test ${new Date().toLocaleString('es-DO')}`;
    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: process.env.TELEGRAM_CHAT_ID, text: msg }
    );
    res.json({ success: true, mensaje: '✅ Enviado' });
  } catch (e) {
    res.json({ success: false, mensaje: `❌ ${e.message}` });
  }
});

// ════════════════════════════════════════════════════════════════
// CRON JOBS
// ════════════════════════════════════════════════════════════════

schedule.scheduleJob('*/10 * * * *', async () => {
  const cats = ['Nacionales', 'Deportes', 'Internacionales', 'Economia', 'Tecnologia', 'Espectaculos'];
  const cat = cats[Math.floor(Math.random() * cats.length)];
  await generarNoticia(cat);
});

schedule.scheduleJob('0 3 * * *', async () => {
  console.log('🧹 Limpieza');
  try {
    await pool.query(`DELETE FROM noticias_publicadas_hoy
                      WHERE fecha_publicacion < NOW() - INTERVAL '24 hours'`);
  } catch (e) {
    console.error('⚠️ Error limpieza:', e.message);
  }
});

// ════════════════════════════════════════════════════════════════
// INICIAR
// ════════════════════════════════════════════════════════════════

async function start() {
  try {
    await crearTablas();
    app.listen(PORT, () => {
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`🏮 EL FAROL AL DÍA — V34.31`);
      console.log(`${'═'.repeat(60)}`);
      console.log(`✅ Servidor ${PORT}`);
      console.log(`✅ BD: PostgreSQL`);
      console.log(`✅ Gemini: 3 keys`);
      console.log(`✅ Anti-duplicados: ON`);
      console.log(`✅ Monetización: ON`);
      console.log(`✅ Telegram: ON`);
      console.log(`${'═'.repeat(60)}\n`);
    });
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
}

start();

process.on('unhandledRejection', e => console.error('❌ Rejection:', e));
process.on('uncaughtException', e => console.error('❌ Exception:', e));
