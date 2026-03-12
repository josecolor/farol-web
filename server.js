/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR V18.1 (FIX 429)
 *
 * CAMBIOS RESPECTO A V18.0:
 * 1. ✅ Gemini: retry con backoff exponencial (5s, 10s, 20s)
 * 2. ✅ Cron: cada 3h + delay aleatorio (evita picos de API)
 * 3. ✅ Cache de imágenes en memoria (TTL 24h, evita repetir calls)
 * 4. ✅ Rate limiter específico para /api/generar-noticia (3/min)
 * 5. ✅ TODO lo demás intacto — frontend, BD, rutas, admin, etc.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { Pool } = require('pg');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL requerido');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ==================== RATE LIMITERS ====================

// Limiter general (igual que antes)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.log(`⛔ Rate limit general excedido para IP: ${req.ip}`);
        res.status(429).json({ error: 'Demasiadas solicitudes, intente más tarde.' });
    }
});
app.use(limiter);

// ✅ FIX #4 — Limiter específico para generación (evita spam al endpoint público)
const limiterGeneracion = rateLimit({
    windowMs: 60 * 1000,  // ventana de 1 minuto
    max: 3,               // máximo 3 generaciones por IP por minuto
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.log(`⛔ Spam en generación desde IP: ${req.ip}`);
        res.status(429).json({ error: 'Demasiadas generaciones, espera un momento.' });
    }
});

// ==================== CONFIGURACIÓN IA (ENTRENABLE SIN CÓDIGO) ====================
const CONFIG_IA_PATH = path.join(__dirname, 'config-ia.json');

function cargarConfigIA() {
    const defaultConfig = {
        enabled: true,
        maxNoticias: 10,
        creditosMensuales: 500,
        instruccion_principal: 'Eres un periodista profesional dominicano. Escribe noticias verificadas, equilibradas y profesionales.',
        tono: 'profesional',
        extension: 'media',
        enfasis: 'Noticias locales con contexto histórico',
        evitar: 'Especulación sin fuentes, titulares sensacionalistas, desinformación',
        prioridades: {
            'Nacionales': 10,
            'Deportes': 8,
            'Internacionales': 6,
            'Economía': 7,
            'Tecnología': 6,
            'Espectáculos': 5
        },
        imagenes: {
            buscar_personas: true,
            validar_relevancia: true,
            usar_fallback_ilustrativo: true,
            max_intentos_imagen: 3
        }
    };

    try {
        if (fs.existsSync(CONFIG_IA_PATH)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_IA_PATH, 'utf8'));
            return { ...defaultConfig, ...config };
        }
    } catch (e) {
        console.warn('⚠️ Error leyendo config IA, usando default');
    }

    fs.writeFileSync(CONFIG_IA_PATH, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
}

function guardarConfigIA(config) {
    try {
        fs.writeFileSync(CONFIG_IA_PATH, JSON.stringify(config, null, 2));
        console.log('✅ Configuración IA guardada');
        return true;
    } catch (e) {
        console.error('❌ Error guardando config:', e.message);
        return false;
    }
}

let CONFIG_IA = cargarConfigIA();

// ==================== HISTORIAL DE ERRORES ====================
const HISTORIAL_ERRORES_PATH = path.join(__dirname, 'historial-errores.json');

function cargarHistorial() {
    try {
        if (fs.existsSync(HISTORIAL_ERRORES_PATH)) {
            return JSON.parse(fs.readFileSync(HISTORIAL_ERRORES_PATH, 'utf8'));
        }
    } catch (e) {
        console.warn('⚠️ Error leyendo historial');
    }
    return [];
}

function guardarError(tipo, descripcion, detalles = {}) {
    try {
        let historial = cargarHistorial();
        historial.push({
            timestamp: new Date().toISOString(),
            tipo,
            descripcion,
            detalles,
            resuelto: false
        });
        if (historial.length > 100) historial = historial.slice(-100);
        fs.writeFileSync(HISTORIAL_ERRORES_PATH, JSON.stringify(historial, null, 2));
        console.log(`📝 Error registrado: ${tipo} - ${descripcion}`);
    } catch (e) {
        console.error('❌ Error guardando historial:', e.message);
    }
}

// ==================== REDACTORES ====================
const REDACTORES = [
    { nombre: 'Carlos Méndez',         especialidad: 'Nacionales'      },
    { nombre: 'Laura Santana',          especialidad: 'Deportes'        },
    { nombre: 'Roberto Peña',           especialidad: 'Internacionales' },
    { nombre: 'Ana María Castillo',     especialidad: 'Economía'        },
    { nombre: 'José Miguel Fernández',  especialidad: 'Tecnología'      },
    { nombre: 'Patricia Jiménez',       especialidad: 'Espectáculos'    }
];

function elegirRedactor(categoria) {
    const esp = REDACTORES.filter(r => r.especialidad === categoria);
    return esp.length > 0
        ? esp[Math.floor(Math.random() * esp.length)].nombre
        : 'IA Gemini';
}

// ==================== SLUG ====================
function generarSlug(texto) {
    return texto.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 80);
}

// ==================== BANCO DE IMÁGENES ILUSTRATIVAS ====================
const BANCO_IMAGENES_ILUSTRATIVAS = {
    'Nacionales': {
        urls: [
            'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg',
            'https://images.pexels.com/photos/290595/pexels-photo-290595.jpeg',
            'https://images.pexels.com/photos/3616480/pexels-photo-3616480.jpeg',
            'https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg'
        ],
        alt: 'Congreso Nacional - República Dominicana'
    },
    'Deportes': {
        urls: [
            'https://images.pexels.com/photos/46798/the-ball-stadion-football-the-pitch-46798.jpeg',
            'https://images.pexels.com/photos/1884574/pexels-photo-1884574.jpeg',
            'https://images.pexels.com/photos/209977/pexels-photo-209977.jpeg',
            'https://images.pexels.com/photos/3621943/pexels-photo-3621943.jpeg'
        ],
        alt: 'Estadio de fútbol - Deportes'
    },
    'Internacionales': {
        urls: [
            'https://images.pexels.com/photos/2860705/pexels-photo-2860705.jpeg',
            'https://images.pexels.com/photos/358319/pexels-photo-358319.jpeg',
            'https://images.pexels.com/photos/2869499/pexels-photo-2869499.jpeg',
            'https://images.pexels.com/photos/3407617/pexels-photo-3407617.jpeg'
        ],
        alt: 'Noticias Internacionales'
    },
    'Espectáculos': {
        urls: [
            'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg',
            'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg',
            'https://images.pexels.com/photos/3651308/pexels-photo-3651308.jpeg',
            'https://images.pexels.com/photos/3587478/pexels-photo-3587478.jpeg'
        ],
        alt: 'Entretenimiento y Espectáculos'
    },
    'Economía': {
        urls: [
            'https://images.pexels.com/photos/4386466/pexels-photo-4386466.jpeg',
            'https://images.pexels.com/photos/6772070/pexels-photo-6772070.jpeg',
            'https://images.pexels.com/photos/3184591/pexels-photo-3184591.jpeg',
            'https://images.pexels.com/photos/3532557/pexels-photo-3532557.jpeg'
        ],
        alt: 'Gráficos de Economía'
    },
    'Tecnología': {
        urls: [
            'https://images.pexels.com/photos/3861958/pexels-photo-3861958.jpeg',
            'https://images.pexels.com/photos/2582937/pexels-photo-2582937.jpeg',
            'https://images.pexels.com/photos/5632399/pexels-photo-5632399.jpeg',
            'https://images.pexels.com/photos/3932499/pexels-photo-3932499.jpeg'
        ],
        alt: 'Tecnología e Innovación'
    }
};

// ==================== ✅ FIX #3: CACHE DE IMÁGENES ====================
const CACHE_IMAGENES = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas en ms

function guardarEnCache(clave, imagen) {
    CACHE_IMAGENES.set(clave, { imagen, timestamp: Date.now() });
}

function obtenerDeCache(clave) {
    if (!CACHE_IMAGENES.has(clave)) return null;
    const entrada = CACHE_IMAGENES.get(clave);
    if (Date.now() - entrada.timestamp > CACHE_TTL) {
        CACHE_IMAGENES.delete(clave);
        return null;
    }
    return entrada.imagen;
}

// ==================== ✅ FIX #1: GEMINI CON RETRY Y BACKOFF ====================
async function llamarGeminiConRetry(prompt, maxIntentos = 3) {
    const delay = ms => new Promise(r => setTimeout(r, ms));

    for (let i = 0; i < maxIntentos; i++) {
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0.8,
                            maxOutputTokens: 2500,
                            topP: 0.95
                        }
                    })
                }
            );

            // 429 → esperar con backoff exponencial y reintentar
            if (response.status === 429) {
                const espera = Math.pow(2, i) * 5000; // 5s, 10s, 20s
                console.log(`⏳ Gemini 429 — esperando ${espera / 1000}s (intento ${i + 1}/${maxIntentos})`);
                guardarError('gemini_429', `Rate limit Gemini, reintentando en ${espera / 1000}s`, { intento: i + 1 });
                await delay(espera);
                continue;
            }

            if (!response.ok) {
                throw new Error(`Gemini error ${response.status}`);
            }

            return await response.json();

        } catch (e) {
            if (i === maxIntentos - 1) throw e; // último intento → lanzar error
            console.log(`⚠️ Gemini error en intento ${i + 1}: ${e.message}, reintentando...`);
            await delay(3000);
        }
    }
    throw new Error('Gemini no respondió después de todos los reintentos');
}

// ==================== BUSCAR Y VALIDAR IMAGEN (con cache) ====================
async function buscarImagenInteligente(persona, busqueda, categoria) {
    const delay = ms => new Promise(r => setTimeout(r, ms));

    // ✅ FIX #3 — Verificar cache antes de hacer calls a APIs externas
    const cacheKey = `${persona || ''}-${busqueda || ''}-${categoria}`.toLowerCase().replace(/\s+/g, '_');
    const imagenCacheada = obtenerDeCache(cacheKey);
    if (imagenCacheada) {
        console.log(`📦 Imagen desde cache: ${cacheKey}`);
        return imagenCacheada;
    }

    let intento = 0;
    const maxIntentos = CONFIG_IA.imagenes.max_intentos_imagen;

    console.log(`\n🎬 === BÚSQUEDA INTELIGENTE DE IMÁGENES ===`);
    console.log(`   Persona: ${persona || 'ninguna'}`);
    console.log(`   Búsqueda: ${busqueda || 'ninguna'}`);
    console.log(`   Categoría: ${categoria}`);

    // CAPA 1: BUSCAR IMAGEN DE PERSONA (si existe)
    if (persona && CONFIG_IA.imagenes.buscar_personas) {
        console.log(`\n📍 CAPA 1: Buscando imagen de "${persona}"...`);

        if (process.env.UNSPLASH_ACCESS_KEY) {
            try {
                intento++;
                console.log(`   [Intento ${intento}] Unsplash...`);
                const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(persona)}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&per_page=1`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.results?.length > 0) {
                        const img = data.results[0];
                        const resultado = { url: img.urls.regular, alt: persona, source: 'Unsplash', tipo: 'persona', validada: true };
                        guardarEnCache(cacheKey, resultado);
                        console.log(`   ✅ ENCONTRADA en Unsplash`);
                        return resultado;
                    }
                }
            } catch (e) {
                console.log(`   ⚠️ Error Unsplash`);
                guardarError('imagen_unsplash', `Error buscando ${persona}`, { error: e.message });
            }
            await delay(300);
        }

        if (process.env.PEXELS_API_KEY) {
            try {
                intento++;
                console.log(`   [Intento ${intento}] Pexels...`);
                const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(persona)}&per_page=1`, {
                    headers: { 'Authorization': process.env.PEXELS_API_KEY }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.photos?.length > 0) {
                        const img = data.photos[0];
                        const resultado = { url: img.src.landscape, alt: persona, source: 'Pexels', tipo: 'persona', validada: true };
                        guardarEnCache(cacheKey, resultado);
                        console.log(`   ✅ ENCONTRADA en Pexels`);
                        return resultado;
                    }
                }
            } catch (e) {
                console.log(`   ⚠️ Error Pexels`);
                guardarError('imagen_pexels', `Error buscando ${persona}`, { error: e.message });
            }
            await delay(300);
        }

        if (process.env.PIXABAY_API_KEY) {
            try {
                intento++;
                console.log(`   [Intento ${intento}] Pixabay...`);
                const res = await fetch(`https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(persona)}&per_page=1`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.hits?.length > 0) {
                        const img = data.hits[0];
                        const resultado = { url: img.webformatURL, alt: persona, source: 'Pixabay', tipo: 'persona', validada: true };
                        guardarEnCache(cacheKey, resultado);
                        console.log(`   ✅ ENCONTRADA en Pixabay`);
                        return resultado;
                    }
                }
            } catch (e) {
                console.log(`   ⚠️ Error Pixabay`);
                guardarError('imagen_pixabay', `Error buscando ${persona}`, { error: e.message });
            }
        }

        console.log(`   ❌ No se encontró imagen de persona`);
    }

    // CAPA 2: BUSCAR IMAGEN CON BÚSQUEDA TEMÁTICA
    if (busqueda && intento < maxIntentos) {
        console.log(`\n🔍 CAPA 2: Buscando imagen temática "${busqueda}"...`);

        if (process.env.UNSPLASH_ACCESS_KEY) {
            try {
                intento++;
                console.log(`   [Intento ${intento}] Unsplash...`);
                const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(busqueda)}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&per_page=1`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.results?.length > 0) {
                        const img = data.results[0];
                        const resultado = { url: img.urls.regular, alt: busqueda, source: 'Unsplash', tipo: 'tematica', validada: true };
                        guardarEnCache(cacheKey, resultado);
                        console.log(`   ✅ ENCONTRADA en Unsplash`);
                        return resultado;
                    }
                }
            } catch (e) {
                console.log(`   ⚠️ Error Unsplash`);
            }
            await delay(300);
        }

        if (process.env.PEXELS_API_KEY) {
            try {
                intento++;
                console.log(`   [Intento ${intento}] Pexels...`);
                const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(busqueda)}&per_page=1`, {
                    headers: { 'Authorization': process.env.PEXELS_API_KEY }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.photos?.length > 0) {
                        const img = data.photos[0];
                        const resultado = { url: img.src.landscape, alt: busqueda, source: 'Pexels', tipo: 'tematica', validada: true };
                        guardarEnCache(cacheKey, resultado);
                        console.log(`   ✅ ENCONTRADA en Pexels`);
                        return resultado;
                    }
                }
            } catch (e) {
                console.log(`   ⚠️ Error Pexels`);
            }
        }

        console.log(`   ❌ No se encontró imagen temática`);
    }

    // CAPA 3: USAR FALLBACK ILUSTRATIVO (sin llamadas a APIs externas)
    if (CONFIG_IA.imagenes.usar_fallback_ilustrativo) {
        console.log(`\n🎨 CAPA 3: Usando imagen ilustrativa de respaldo...`);
        const banco = BANCO_IMAGENES_ILUSTRATIVAS[categoria] || BANCO_IMAGENES_ILUSTRATIVAS['Nacionales'];
        const img = banco.urls[Math.floor(Math.random() * banco.urls.length)];
        const resultado = {
            url: img,
            alt: banco.alt,
            source: 'ilustrativa',
            tipo: 'ilustrativa',
            validada: true,
            nota: 'Imagen ilustrativa (no hay foto específica disponible)'
        };
        guardarEnCache(cacheKey, resultado);
        console.log(`   ✅ Imagen ilustrativa: ${categoria}`);
        return resultado;
    }

    // FALLBACK DE EMERGENCIA
    console.log(`\n⚠️ FALLBACK DE EMERGENCIA`);
    return {
        url: BANCO_IMAGENES_ILUSTRATIVAS['Nacionales'].urls[0],
        alt: 'El Farol al Día',
        source: 'emergencia',
        tipo: 'emergencia',
        validada: false,
        nota: 'Imagen de emergencia'
    };
}

// ==================== INICIALIZAR BD ====================
async function inicializarBase() {
    const client = await pool.connect();
    try {
        console.log('🔧 Inicializando BD...');
        await client.query(`CREATE TABLE IF NOT EXISTS noticias (
            id SERIAL PRIMARY KEY,
            titulo VARCHAR(255) NOT NULL,
            slug VARCHAR(255) UNIQUE,
            seccion VARCHAR(100),
            contenido TEXT,
            seo_description VARCHAR(160),
            seo_keywords VARCHAR(255),
            redactor VARCHAR(100),
            imagen TEXT,
            imagen_alt VARCHAR(255),
            imagen_source VARCHAR(50),
            vistas INTEGER DEFAULT 0,
            fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            estado VARCHAR(50) DEFAULT 'publicada'
        )`);
        console.log('✅ BD lista');
    } catch (e) {
        console.error('❌ Error BD:', e.message);
    } finally {
        client.release();
    }
}

// ==================== VERIFICAR TÍTULO DUPLICADO ====================
async function tituloDuplicado(titulo) {
    try {
        const tituloNormalizado = titulo.toLowerCase().replace(/[^\w\s]/g, '').substring(0, 50);
        const result = await pool.query('SELECT titulo FROM noticias WHERE estado = $1', ['publicada']);
        for (const row of result.rows) {
            const existente = row.titulo.toLowerCase().replace(/[^\w\s]/g, '').substring(0, 50);
            let coincidencias = 0;
            const palabrasTitulo = tituloNormalizado.split(' ');
            const palabrasExistente = existente.split(' ');
            for (const palabra of palabrasTitulo) {
                if (palabra.length > 3 && palabrasExistente.includes(palabra)) coincidencias++;
            }
            if (coincidencias / Math.max(palabrasTitulo.length, 1) > 0.6) return true;
        }
        return false;
    } catch (error) {
        return false;
    }
}

// ==================== OBTENER NOTICIAS RELACIONADAS ====================
async function obtenerRelacionadas(noticiaId, seccion, keywords, limit = 4) {
    try {
        const palabras = keywords ? keywords.split(',').map(k => k.trim().toLowerCase()) : [];
        let query = 'SELECT id, titulo, slug, seccion, imagen, fecha FROM noticias WHERE id != $1 AND estado = $2';
        const params = [noticiaId, 'publicada'];
        if (seccion) {
            query += ` AND seccion = $3`;
            params.push(seccion);
        }
        if (palabras.length > 0) {
            for (let i = 0; i < Math.min(palabras.length, 2); i++) {
                query += ` AND (titulo ILIKE $${params.length + 1} OR contenido ILIKE $${params.length + 1})`;
                params.push(`%${palabras[i]}%`);
            }
        }
        query += ` ORDER BY fecha DESC LIMIT $${params.length + 1}`;
        params.push(limit);
        const result = await pool.query(query, params);
        return result.rows;
    } catch (error) {
        return [];
    }
}

// ==================== GENERAR NOTICIA CON IA (usa retry) ====================
async function generarNoticia(categoria) {
    try {
        if (!CONFIG_IA.enabled) {
            console.log(`⚠️ IA desactivada`);
            return { success: false, error: 'IA desactivada por admin' };
        }

        console.log(`\n🤖 === GENERANDO NOTICIA ===`);
        console.log(`   Categoría: ${categoria}`);
        console.log(`   Config: ${CONFIG_IA.tono} / ${CONFIG_IA.extension}`);

        const prompt = `${CONFIG_IA.instruccion_principal}

Escribe una noticia profesional y COMPLETA sobre ${categoria} en República Dominicana.

TONO: ${CONFIG_IA.tono}
EXTENSIÓN: ${CONFIG_IA.extension} (400-500 palabras)
ÉNFASIS: ${CONFIG_IA.enfasis}
EVITA: ${CONFIG_IA.evitar}

RESPONDE EXACTAMENTE CON ESTE FORMATO:

TITULO: [título impactante 50-60 caracteres]
PERSONA: [nombre si la noticia es sobre alguien, sino vacío]
DESCRIPCION: [descripción SEO 150-160 caracteres]
PALABRAS: [5-7 palabras clave separadas por coma]
BUSQUEDA_IMAGEN: [búsqueda en inglés 3-5 palabras]
CONTENIDO:
[noticia COMPLETA en párrafos separados]`;

        console.log(`📤 Enviando a Gemini...`);

        // ✅ FIX #1 — Usar función con retry en vez del fetch directo
        const data = await llamarGeminiConRetry(prompt);
        const texto = data.candidates[0].content.parts[0].text;

        // PARSEAR RESPUESTA
        let titulo = "", persona = "", descripcion = "", palabras = categoria, busqueda_imagen = "", contenido = "";
        const lineas = texto.split('\n');
        let enContenido = false;
        let contenidoTemp = [];

        for (let i = 0; i < lineas.length; i++) {
            const linea = lineas[i].trim();
            if (linea.startsWith('TITULO:'))           titulo           = linea.replace('TITULO:', '').trim();
            else if (linea.startsWith('PERSONA:'))     persona          = linea.replace('PERSONA:', '').trim();
            else if (linea.startsWith('DESCRIPCION:')) descripcion      = linea.replace('DESCRIPCION:', '').trim();
            else if (linea.startsWith('PALABRAS:'))    palabras         = linea.replace('PALABRAS:', '').trim();
            else if (linea.startsWith('BUSQUEDA_IMAGEN:')) busqueda_imagen = linea.replace('BUSQUEDA_IMAGEN:', '').trim();
            else if (linea.startsWith('CONTENIDO:'))   enContenido      = true;
            else if (enContenido && linea.length > 0)  contenidoTemp.push(linea);
        }

        contenido = contenidoTemp.join('\n\n');

        // Limpiar caracteres especiales
        titulo          = titulo.replace(/[*_#`]/g, '').trim();
        persona         = persona.replace(/[*_#`]/g, '').trim();
        descripcion     = descripcion.replace(/[*_#`]/g, '').trim();
        palabras        = palabras.replace(/[*_#`]/g, '').trim();
        busqueda_imagen = busqueda_imagen.replace(/[*_#`]/g, '').trim();

        // VALIDACIÓN
        const errores = [];
        if (!titulo || titulo.length < 20) errores.push('Título muy corto');
        if (!contenido || contenido.length < 300) errores.push('Contenido insuficiente');

        if (errores.length > 0) {
            guardarError('validacion', `Generación inválida: ${errores.join(', ')}`);
            throw new Error(errores.join(', '));
        }

        // VERIFICAR DUPLICADO
        if (await tituloDuplicado(titulo)) {
            console.log(`⚠️ Título duplicado`);
            guardarError('duplicado', `Título similar ya existe: ${titulo.substring(0, 50)}`);
            return { success: false, error: 'Título similar ya existe' };
        }

        // BUSCAR IMAGEN (con cache, menos llamadas a APIs externas)
        const imagen = await buscarImagenInteligente(persona, busqueda_imagen, categoria);

        // GUARDAR EN BD
        titulo      = titulo.substring(0, 255);
        descripcion = descripcion.substring(0, 160);
        palabras    = palabras.substring(0, 255);
        contenido   = contenido.substring(0, 10000);

        const slug = generarSlug(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        const slugFinal = existe.rows.length > 0 ? `${slug}-${Date.now()}` : slug;
        const redactor = elegirRedactor(categoria);

        const result = await pool.query(
            `INSERT INTO noticias (titulo, slug, seccion, contenido, seo_description, seo_keywords, redactor, imagen, imagen_alt, imagen_source, estado)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id, slug`,
            [titulo, slugFinal, categoria, contenido, descripcion, palabras, redactor,
             imagen.url, imagen.alt, imagen.source, 'publicada']
        );

        const noticia = result.rows[0];

        console.log(`\n✅ === NOTICIA PUBLICADA ===`);
        console.log(`   ID: ${noticia.id}`);
        console.log(`   Título: ${titulo.substring(0, 50)}...`);
        console.log(`   Persona: ${persona || 'ninguna'}`);
        console.log(`   Imagen: ${imagen.tipo} (${imagen.source})`);
        console.log(`   URL: ${BASE_URL}/noticia/${noticia.slug}`);

        return {
            success: true,
            id: noticia.id,
            slug: noticia.slug,
            titulo,
            url: `${BASE_URL}/noticia/${noticia.slug}`,
            imagen: imagen.url,
            imagen_tipo: imagen.tipo,
            imagen_source: imagen.source,
            redactor,
            persona: persona || 'ninguna',
            mensaje: '✅ Noticia generada'
        };

    } catch (error) {
        console.error(`❌ ERROR:`, error.message);
        guardarError('generacion', error.message);
        return { success: false, error: error.message };
    }
}

// ==================== CATEGORÍAS ====================
const CATEGORIAS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];

// ==================== ✅ FIX #2: AUTOMATIZACIÓN — CADA 3H + DELAY ALEATORIO ====================
console.log('\n📅 Configurando automatización...');

cron.schedule('0 */3 * * *', async () => {
    if (!CONFIG_IA.enabled) return;

    // Delay aleatorio de hasta 10 minutos para no pegar APIs siempre en el mismo segundo
    const delayAleatorio = Math.floor(Math.random() * 10 * 60 * 1000);
    console.log(`\n⏰ [${new Date().toLocaleTimeString()}] Noticia automática en ${Math.round(delayAleatorio / 60000)}min...`);
    await new Promise(r => setTimeout(r, delayAleatorio));

    const cat = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    console.log(`   Generando: ${cat}`);
    await generarNoticia(cat);
});

cron.schedule('0 8 * * *', async () => {
    if (!CONFIG_IA.enabled) return;
    console.log(`\n🌅 [${new Date().toLocaleTimeString()}] Noticia diaria: Nacionales`);
    await generarNoticia('Nacionales');
});

console.log('✅ Automatización configurada (cada 3h + delay aleatorio)');

// ==================== RUTAS FRONTEND ====================
app.get('/health', (req, res) => res.json({ status: 'OK', version: '18.1' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));

// ==================== RUTAS API PÚBLICAS ====================
app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, titulo, slug, seccion, imagen, fecha, vistas, redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30',
            ['publicada']
        );
        res.json({ success: true, noticias: result.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ✅ FIX #4 — limiterGeneracion aplicado aquí (solo a este endpoint)
app.post('/api/generar-noticia', limiterGeneracion, async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });
    const resultado = await generarNoticia(categoria);
    res.status(resultado.success ? 200 : 500).json(resultado);
});

// ==================== NOTICIA POR SLUG ====================
app.get('/noticia/:slug', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM noticias WHERE slug = $1 AND estado = $2',
            [req.params.slug, 'publicada']
        );

        if (result.rows.length === 0) {
            return res.status(404).send('Noticia no encontrada');
        }

        const n = result.rows[0];
        await pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE id = $1', [n.id]);

        const relacionadas = await obtenerRelacionadas(n.id, n.seccion, n.seo_keywords, 4);

        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');

            const fechaISO = new Date(n.fecha).toISOString();
            const meta = `<title>${n.titulo} | El Farol al Día</title>
<meta name="description" content="${n.seo_description || n.titulo}">
<meta name="keywords" content="${n.seo_keywords || ''}">
<meta property="og:title" content="${n.titulo}">
<meta property="og:description" content="${n.seo_description || n.titulo}">
<meta property="og:image" content="${n.imagen}">
<meta property="og:url" content="${BASE_URL}/noticia/${n.slug}">
<meta property="og:type" content="article">
<meta property="article:published_time" content="${fechaISO}">
<meta property="article:author" content="${n.redactor}">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  "headline": "${n.titulo}",
  "description": "${n.seo_description || n.titulo}",
  "image": "${n.imagen}",
  "datePublished": "${fechaISO}",
  "author": {"@type": "Person", "name": "${n.redactor}"},
  "publisher": {"@type": "Organization", "name": "El Farol al Día"}
}
</script>`;

            let relacionadasHTML = '';
            if (relacionadas.length > 0) {
                relacionadasHTML = '<h3>Noticias relacionadas</h3><div class="relacionadas">';
                relacionadas.forEach(r => {
                    relacionadasHTML += `
                        <div class="relacionada-item">
                            <a href="/noticia/${r.slug}">
                                <img src="${r.imagen}" alt="${r.titulo}" loading="lazy" onerror="this.src='https://via.placeholder.com/200x150?text=Noticia'">
                                <h4>${r.titulo}</h4>
                                <span>${new Date(r.fecha).toLocaleDateString('es-DO')}</span>
                            </a>
                        </div>
                    `;
                });
                relacionadasHTML += '</div>';
            }

            const contenidoHTML = n.contenido.split('\n')
                .filter(p => p.trim() !== '')
                .map(p => `<p>${p.trim()}</p>`)
                .join('');

            html = html.replace('<!-- META_TAGS -->', meta);
            html = html.replace(/{{TITULO}}/g, n.titulo);
            html = html.replace(/{{CONTENIDO}}/g, contenidoHTML || '<p>Contenido no disponible</p>');
            html = html.replace(/{{FECHA}}/g, new Date(n.fecha).toLocaleDateString('es-DO', {
                year: 'numeric', month: 'long', day: 'numeric'
            }));
            html = html.replace(/{{IMAGEN}}/g, n.imagen);
            html = html.replace(/{{ALT}}/g, n.imagen_alt || n.titulo);
            html = html.replace(/{{VISTAS}}/g, n.vistas);
            html = html.replace(/{{REDACTOR}}/g, n.redactor);
            html = html.replace(/{{SECCION}}/g, n.seccion);
            html = html.replace('<!-- RELACIONADAS -->', relacionadasHTML);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);

        } catch (e) {
            res.json({ success: true, noticia: n, relacionadas });
        }
    } catch (e) {
        console.error('Error en /noticia/:slug', e.message);
        res.status(500).send('Error interno');
    }
});

// ==================== SITEMAP ====================
app.get('/sitemap.xml', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT slug, fecha FROM noticias WHERE estado=$1 ORDER BY fecha DESC',
            ['publicada']
        );
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `<url><loc>${BASE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
        result.rows.forEach(n => {
            const fecha = new Date(n.fecha).toISOString().split('T')[0];
            xml += `<url><loc>${BASE_URL}/noticia/${n.slug}</loc><lastmod>${fecha}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
        });
        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (e) {
        res.status(500).send('Error');
    }
});

app.get('/robots.txt', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send(`User-agent: *\nAllow: /\nDisallow: /api/admin\nSitemap: ${BASE_URL}/sitemap.xml`);
});

// ==================== ESTADÍSTICAS ====================
app.get('/api/estadisticas', async (req, res) => {
    try {
        const totalResult = await pool.query(
            'SELECT COUNT(*) as count, SUM(vistas) as vistas FROM noticias WHERE estado=$1',
            ['publicada']
        );
        const totalNoticias = parseInt(totalResult.rows[0].count);
        const totalVistas   = parseInt(totalResult.rows[0].vistas) || 0;
        res.json({ success: true, totalNoticias, totalVistas });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==================== CONFIGURACIÓN ====================
app.get('/api/configuracion', async (req, res) => {
    try {
        const configPath = path.join(__dirname, 'config.json');
        let config = { googleAnalytics: '' };
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
        res.json({ success: true, config });
    } catch (e) {
        res.json({ success: true, config: { googleAnalytics: '' } });
    }
});

app.post('/api/configuracion', express.json(), async (req, res) => {
    try {
        const { pin, googleAnalytics } = req.body;
        if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        const configPath = path.join(__dirname, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify({ googleAnalytics }, null, 2));
        res.json({ success: true, message: 'Configuración guardada' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==================== PUBLICAR NOTICIA MANUAL ====================
app.post('/api/publicar', express.json(), async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, redactor, seoTitle, seoDesc, seoKeywords } = req.body;
        if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        if (!titulo || !seccion || !contenido) {
            return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });
        }
        const slug = generarSlug(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        const slugFinal = existe.rows.length > 0 ? `${slug}-${Date.now()}` : slug;
        const result = await pool.query(
            `INSERT INTO noticias (titulo, slug, seccion, contenido, seo_description, seo_keywords, redactor, imagen, imagen_alt, estado)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, slug`,
            [titulo, slugFinal, seccion, contenido, seoDesc || titulo, seoKeywords || seccion,
             redactor || 'Manual',
             'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg',
             titulo, 'publicada']
        );
        const noticia = result.rows[0];
        res.json({
            success: true,
            id: noticia.id,
            slug: noticia.slug,
            message: `✅ Noticia publicada: ${titulo}`,
            url: `${BASE_URL}/noticia/${noticia.slug}`
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==================== STATUS ====================
app.get('/status', async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado=$1', ['publicada']);
        res.json({
            status: 'OK',
            version: '18.1',
            noticias: parseInt(result.rows[0].count),
            ia_enabled: CONFIG_IA.enabled,
            cache_imagenes: CACHE_IMAGENES.size,
            ia_config: {
                tono: CONFIG_IA.tono,
                extension: CONFIG_IA.extension,
                imagen_system: 'Inteligente 3 capas + cache'
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==================== RUTAS ADMIN (OCULTAS) ====================
app.get('/api/admin/config', (req, res) => {
    const pin = req.query.pin;
    if (pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    res.json(CONFIG_IA);
});

app.post('/api/admin/config', express.json(), (req, res) => {
    const { pin, instruccion_principal, tono, extension, enfasis, evitar, enabled } = req.body;
    if (pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    if (instruccion_principal) CONFIG_IA.instruccion_principal = instruccion_principal;
    if (tono)       CONFIG_IA.tono       = tono;
    if (extension)  CONFIG_IA.extension  = extension;
    if (enfasis)    CONFIG_IA.enfasis    = enfasis;
    if (evitar)     CONFIG_IA.evitar     = evitar;
    if (enabled !== undefined) CONFIG_IA.enabled = enabled;
    if (guardarConfigIA(CONFIG_IA)) {
        res.json({ success: true, mensaje: 'Configuración guardada' });
    } else {
        res.status(500).json({ error: 'Error guardando configuración' });
    }
});

app.get('/api/admin/errores', (req, res) => {
    const pin = req.query.pin;
    if (pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    const historial = cargarHistorial();
    res.json({ success: true, errores: historial });
});

// ==================== CATCH ALL ====================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== INICIAR ====================
async function iniciar() {
    try {
        console.log('\n🚀 Iniciando servidor V18.1 (Fix 429)...\n');
        await inicializarBase();

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - SERVIDOR V18.1 (FIX 429 APLICADO) 🏮       ║
╠══════════════════════════════════════════════════════════════════════╣
║ ✅ Puerto: ${PORT}                                                    ║
║ ✅ PostgreSQL: Conectado                                              ║
║ ✅ Gemini 2.5 Flash: ACTIVADO con retry backoff                      ║
║                                                                       ║
║ 🔧 FIXES 429 APLICADOS:                                             ║
║   Fix #1 → Gemini: retry (5s → 10s → 20s backoff)                  ║
║   Fix #2 → Cron: cada 3h + delay aleatorio ≤10min                  ║
║   Fix #3 → Cache imágenes 24h (evita calls repetidas)              ║
║   Fix #4 → /api/generar-noticia: máx 3 req/min por IP              ║
║                                                                       ║
║ 📰 PERIÓDICO: TODO IGUAL QUE ANTES                                  ║
║   ✅ index.html, redaccion.html, noticia.html — intactos            ║
║   ✅ Panel admin /redaccion — intacto                               ║
║   ✅ Rutas /api/* — todas funcionando                               ║
║   ✅ SEO, sitemap, robots — intactos                                ║
╚══════════════════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    }
}

iniciar();
module.exports = app;
