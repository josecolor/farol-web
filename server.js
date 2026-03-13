//**
 * 🏮 EL FAROL AL DÍA - SERVIDOR V24.2 (ESTABLE - TODAS LAS CORRECCIONES)
 * 
 * ✅ Rate limiting para Gemini (evita 429)
 * ✅ Banco de imágenes ilustrativo (sin APIs externas)
 * ✅ Migración automática de base de datos
 * ✅ Manejo de errores robusto
 * ✅ Sistema de cola para generación
 * ✅ Proxy de imágenes local
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { Pool } = require('pg');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// ==================== DIRECTORIOS ====================
const IMAGES_DIR = path.join(__dirname, 'images');
const CACHE_DIR = path.join(IMAGES_DIR, 'cache');

// Crear directorios si no existen
try {
    if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    console.log('✅ Directorios de imágenes creados/verificados');
} catch (e) {
    console.error('❌ Error creando directorios:', e.message);
}

// ==================== CONEXIÓN A BASE DE DATOS ====================
if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL no está definida');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

// ==================== MIDDLEWARES ====================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use('/images', express.static(path.join(__dirname, 'images'), {
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('X-Content-Type-Options', 'nosniff');
    }
}));
app.use(cors());

// Trust proxy para Railway
app.set('trust proxy', 1);

// ==================== CONFIGURACIÓN IA ====================
const CONFIG_IA_PATH = path.join(__dirname, 'config-ia.json');

function cargarConfigIA() {
    const defaultConfig = {
        enabled: true,
        maxNoticias: 10,
        instruccion_principal: 'Eres un periodista profesional dominicano. Escribe noticias verificadas y equilibradas.',
        tono: 'profesional',
        extension: 'media',
        enfasis: 'Noticias locales con contexto histórico',
        evitar: 'Especulación sin fuentes, titulares sensacionalistas'
    };

    try {
        if (fs.existsSync(CONFIG_IA_PATH)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_IA_PATH, 'utf8'));
            return { ...defaultConfig, ...config };
        }
    } catch (e) {
        console.warn('⚠️ Error leyendo config IA:', e.message);
    }

    // Crear archivo por defecto si no existe
    try {
        fs.writeFileSync(CONFIG_IA_PATH, JSON.stringify(defaultConfig, null, 2));
    } catch (e) {
        console.error('❌ Error creando config IA:', e.message);
    }

    return defaultConfig;
}

function guardarConfigIA(config) {
    try {
        fs.writeFileSync(CONFIG_IA_PATH, JSON.stringify(config, null, 2));
        return true;
    } catch (e) {
        console.error('❌ Error guardando config:', e.message);
        return false;
    }
}

let CONFIG_IA = cargarConfigIA();

// ==================== SISTEMA DE COLA PARA GEMINI ====================
const GEMINI_QUEUE = {
    lastRequest: 0,
    minDelay: 3000, // 3 segundos mínimo entre requests
    maxRetries: 3,
    pending: false,
    queue: []
};

/**
 * Espera el tiempo necesario antes de llamar a Gemini
 */
async function esperarTurnoGemini() {
    const ahora = Date.now();
    const tiempoDesdeUltimo = ahora - GEMINI_QUEUE.lastRequest;

    if (tiempoDesdeUltimo < GEMINI_QUEUE.minDelay) {
        const espera = GEMINI_QUEUE.minDelay - tiempoDesdeUltimo;
        console.log(`⏳ Esperando ${Math.ceil(espera / 1000)}s para respetar rate limit de Gemini...`);
        await new Promise(resolve => setTimeout(resolve, espera));
    }

    GEMINI_QUEUE.lastRequest = Date.now();
}

/**
 * Llama a Gemini con reintentos y backoff exponencial
 */
async function llamarGemini(prompt, intentos = 0) {
    const maxIntentos = GEMINI_QUEUE.maxRetries;

    try {
        await esperarTurnoGemini();

        console.log(`🤖 Llamando a Gemini (intento ${intentos + 1}/${maxIntentos})...`);

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
                }),
                timeout: 30000
            }
        );

        if (response.status === 429) {
            console.log(`⚠️ Rate limit de Gemini (429) - intento ${intentos + 1}`);

            if (intentos < maxIntentos - 1) {
                const espera = Math.pow(2, intentos) * 5000; // 5s, 10s, 20s
                console.log(`⏳ Esperando ${espera / 1000}s antes de reintentar...`);
                await new Promise(resolve => setTimeout(resolve, espera));
                return llamarGemini(prompt, intentos + 1);
            } else {
                throw new Error('Gemini rate limit excedido después de reintentos');
            }
        }

        if (!response.ok) {
            throw new Error(`Gemini error ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!texto) {
            throw new Error('Respuesta vacía de Gemini');
        }

        console.log('✅ Gemini respondió exitosamente');
        return texto;

    } catch (error) {
        console.error(`❌ Error en llamada a Gemini:`, error.message);

        if (intentos < maxIntentos - 1) {
            const espera = Math.pow(2, intentos) * 3000;
            console.log(`⏳ Reintentando en ${espera / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, espera));
            return llamarGemini(prompt, intentos + 1);
        }

        throw error;
    }
}

// ==================== BANCO DE IMÁGENES ILUSTRATIVAS ====================
const BANCO_IMAGENES = {
    'Nacionales': [
        'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg',
        'https://images.pexels.com/photos/290595/pexels-photo-290595.jpeg',
        'https://images.pexels.com/photos/3616480/pexels-photo-3616480.jpeg',
        'https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg'
    ],
    'Deportes': [
        'https://images.pexels.com/photos/46798/the-ball-stadion-football-the-pitch-46798.jpeg',
        'https://images.pexels.com/photos/1884574/pexels-photo-1884574.jpeg',
        'https://images.pexels.com/photos/209977/pexels-photo-209977.jpeg',
        'https://images.pexels.com/photos/3621943/pexels-photo-3621943.jpeg'
    ],
    'Internacionales': [
        'https://images.pexels.com/photos/2860705/pexels-photo-2860705.jpeg',
        'https://images.pexels.com/photos/358319/pexels-photo-358319.jpeg',
        'https://images.pexels.com/photos/2869499/pexels-photo-2869499.jpeg',
        'https://images.pexels.com/photos/3407617/pexels-photo-3407617.jpeg'
    ],
    'Espectáculos': [
        'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg',
        'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg',
        'https://images.pexels.com/photos/3651308/pexels-photo-3651308.jpeg',
        'https://images.pexels.com/photos/3587478/pexels-photo-3587478.jpeg'
    ],
    'Economía': [
        'https://images.pexels.com/photos/4386466/pexels-photo-4386466.jpeg',
        'https://images.pexels.com/photos/6772070/pexels-photo-6772070.jpeg',
        'https://images.pexels.com/photos/3184591/pexels-photo-3184591.jpeg',
        'https://images.pexels.com/photos/3532557/pexels-photo-3532557.jpeg'
    ],
    'Tecnología': [
        'https://images.pexels.com/photos/3861958/pexels-photo-3861958.jpeg',
        'https://images.pexels.com/photos/2582937/pexels-photo-2582937.jpeg',
        'https://images.pexels.com/photos/5632399/pexels-photo-5632399.jpeg',
        'https://images.pexels.com/photos/3932499/pexels-photo-3932499.jpeg'
    ]
};

// ==================== FUNCIONES PARA IMÁGENES ====================

/**
 * Genera nombre único para imagen cacheadas
 */
function generarNombreImagen(titulo, categoria) {
    const timestamp = Date.now();
    const hash = crypto.createHash('md5')
        .update(`${titulo}-${categoria}-${timestamp}`)
        .digest('hex')
        .substring(0, 8);
    return `img-${hash}-${timestamp}.jpg`;
}

/**
 * Descarga y cachea una imagen localmente
 */
async function descargarYCachearImagen(url, nombreLocal) {
    return new Promise((resolve, reject) => {
        try {
            const protocolo = url.startsWith('https') ? https : http;
            const filePath = path.join(CACHE_DIR, nombreLocal);
            const file = fs.createWriteStream(filePath);

            protocolo.get(url, { timeout: 10000 }, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}`));
                    return;
                }

                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve(nombreLocal);
                });
            }).on('error', (err) => {
                // Limpiar archivo parcial si existe
                if (fs.existsSync(filePath)) {
                    fs.unlink(filePath, () => {});
                }
                reject(err);
            });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Obtiene una imagen para la noticia (siempre del banco local)
 */
async function obtenerImagenParaNoticia(titulo, categoria) {
    // Elegir una imagen aleatoria del banco según categoría
    const imagenesCategoria = BANCO_IMAGENES[categoria] || BANCO_IMAGENES['Nacionales'];
    const urlOriginal = imagenesCategoria[Math.floor(Math.random() * imagenesCategoria.length)];

    try {
        // Intentar cachear localmente
        const nombreLocal = generarNombreImagen(titulo, categoria);
        await descargarYCachearImagen(urlOriginal, nombreLocal);

        return {
            url: `${BASE_URL}/images/cache/${nombreLocal}`,
            url_original: urlOriginal,
            nombre: nombreLocal,
            fuente: 'cache-local',
            alt: titulo,
            caption: `Imagen ilustrativa: ${titulo}`
        };

    } catch (error) {
        console.log(`⚠️ No se pudo cachear imagen, usando URL original: ${error.message}`);
        return {
            url: urlOriginal,
            url_original: urlOriginal,
            nombre: 'original',
            fuente: 'banco-directo',
            alt: titulo,
            caption: `Imagen ilustrativa: ${titulo}`
        };
    }
}

// ==================== FUNCIONES AUXILIARES ====================

const REDACTORES = [
    { nombre: 'Carlos Méndez', especialidad: 'Nacionales' },
    { nombre: 'Laura Santana', especialidad: 'Deportes' },
    { nombre: 'Roberto Peña', especialidad: 'Internacionales' },
    { nombre: 'Ana María Castillo', especialidad: 'Economía' },
    { nombre: 'José Miguel Fernández', especialidad: 'Tecnología' },
    { nombre: 'Patricia Jiménez', especialidad: 'Espectáculos' }
];

function elegirRedactor(categoria) {
    const redactoresCategoria = REDACTORES.filter(r => r.especialidad === categoria);
    if (redactoresCategoria.length > 0) {
        return redactoresCategoria[Math.floor(Math.random() * redactoresCategoria.length)].nombre;
    }
    return 'Redacción El Farol';
}

function generarSlug(texto) {
    return texto.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 80);
}

function generarMetadatos(titulo, contenido, categoria) {
    const primerasPalabras = contenido.split(' ').slice(0, 20).join(' ');
    const descripcion = primerasPalabras.substring(0, 155) + '...';

    const palabrasArray = [
        categoria.toLowerCase(),
        'República Dominicana',
        'noticias',
        ...titulo.split(' ').filter(p => p.length > 4).slice(0, 3)
    ];

    return {
        title: `${titulo} | El Farol al Día`,
        description: descripcion,
        keywords: [...new Set(palabrasArray)].join(', ')
    };
}

// ==================== INICIALIZACIÓN DE BASE DE DATOS ====================
async function inicializarBaseDatos() {
    const client = await pool.connect();

    try {
        console.log('🔧 Inicializando base de datos...');

        // Crear tabla noticias
        await client.query(`
            CREATE TABLE IF NOT EXISTS noticias (
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
                vistas INTEGER DEFAULT 0,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                estado VARCHAR(50) DEFAULT 'publicada'
            )
        `);

        // Agregar columnas nuevas si no existen (migración V24+)
        console.log('📦 Verificando columnas nuevas...');

        const columnas = [
            'imagen_caption TEXT',
            'imagen_nombre VARCHAR(100)',
            'imagen_fuente VARCHAR(50)'
        ];

        for (const columna of columnas) {
            try {
                await client.query(`ALTER TABLE noticias ADD COLUMN IF NOT EXISTS ${columna}`);
            } catch (e) {
                console.log(`   ⚠️ Columna ya existe o no se pudo agregar: ${columna}`);
            }
        }

        console.log('✅ Base de datos inicializada correctamente');

    } catch (error) {
        console.error('❌ Error inicializando base de datos:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

// ==================== GENERACIÓN DE NOTICIAS ====================

/**
 * Verifica si un título ya existe (para evitar duplicados)
 */
async function tituloDuplicado(titulo) {
    try {
        const tituloNormalizado = titulo.toLowerCase().replace(/[^\w\s]/g, '').substring(0, 50);
        const result = await pool.query('SELECT titulo FROM noticias WHERE estado = $1', ['publicada']);

        for (const row of result.rows) {
            const existente = row.titulo.toLowerCase().replace(/[^\w\s]/g, '').substring(0, 50);

            // Comparar similitud
            const palabrasTitulo = tituloNormalizado.split(' ');
            const palabrasExistente = existente.split(' ');
            let coincidencias = 0;

            for (const palabra of palabrasTitulo) {
                if (palabra.length > 3 && palabrasExistente.includes(palabra)) {
                    coincidencias++;
                }
            }

            const similitud = coincidencias / Math.max(palabrasTitulo.length, 1);
            if (similitud > 0.6) {
                return true;
            }
        }

        return false;
    } catch (error) {
        console.error('Error verificando duplicado:', error.message);
        return false;
    }
}

/**
 * Genera una noticia completa
 */
async function generarNoticia(categoria) {
    console.log(`\n📰 ===== GENERANDO NOTICIA: ${categoria} =====`);

    try {
        if (!CONFIG_IA.enabled) {
            return { success: false, error: 'IA desactivada por el administrador' };
        }

        // Construir prompt
        const prompt = `${CONFIG_IA.instruccion_principal}

Escribe una noticia profesional sobre ${categoria} en República Dominicana.

TONO: ${CONFIG_IA.tono}
EXTENSIÓN: ${CONFIG_IA.extension} (aproximadamente 400-500 palabras)
ÉNFASIS: ${CONFIG_IA.enfasis}
EVITA: ${CONFIG_IA.evitar}

RESPONDE EXACTAMENTE CON ESTE FORMATO:

TITULO: [título impactante de 50-60 caracteres, sin asteriscos]
DESCRIPCION: [descripción SEO de 150-160 caracteres]
PALABRAS: [5-7 palabras clave separadas por coma]
CONTENIDO:
[noticia completa en párrafos separados]`;

        // Llamar a Gemini con rate limiting
        const texto = await llamarGemini(prompt);

        // Parsear respuesta
        let titulo = '';
        let descripcion = '';
        let palabras = categoria;
        let contenido = '';

        const lineas = texto.split('\n');
        let enContenido = false;
        const lineasContenido = [];

        for (const linea of lineas) {
            const lineaTrim = linea.trim();

            if (lineaTrim.startsWith('TITULO:')) {
                titulo = lineaTrim.replace('TITULO:', '').trim();
            } else if (lineaTrim.startsWith('DESCRIPCION:')) {
                descripcion = lineaTrim.replace('DESCRIPCION:', '').trim();
            } else if (lineaTrim.startsWith('PALABRAS:')) {
                palabras = lineaTrim.replace('PALABRAS:', '').trim();
            } else if (lineaTrim.startsWith('CONTENIDO:')) {
                enContenido = true;
            } else if (enContenido && lineaTrim.length > 0) {
                lineasContenido.push(lineaTrim);
            }
        }

        contenido = lineasContenido.join('\n\n');

        // Limpiar caracteres especiales
        titulo = titulo.replace(/[*_#`]/g, '').trim();
        descripcion = descripcion.replace(/[*_#`]/g, '').trim();
        palabras = palabras.replace(/[*_#`]/g, '').trim();

        // Validar
        if (!titulo || titulo.length < 20) {
            throw new Error('Título demasiado corto o no encontrado');
        }

        if (!contenido || contenido.length < 300) {
            throw new Error('Contenido demasiado corto o no encontrado');
        }

        if (!descripcion || descripcion.length < 50) {
            // Generar descripción desde el contenido
            descripcion = contenido.split(' ').slice(0, 20).join(' ').substring(0, 155) + '...';
        }

        // Verificar duplicados
        const duplicado = await tituloDuplicado(titulo);
        if (duplicado) {
            return { success: false, error: 'Ya existe una noticia con título similar' };
        }

        // Obtener imagen
        console.log('🖼️ Obteniendo imagen ilustrativa...');
        const imagen = await obtenerImagenParaNoticia(titulo, categoria);

        // Generar slug
        const slug = generarSlug(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        const slugFinal = existe.rows.length > 0 ? `${slug}-${Date.now()}` : slug;

        // Elegir redactor
        const redactor = elegirRedactor(categoria);

        // Generar metadatos si faltan
        if (!descripcion || descripcion.length < 10) {
            const metadatos = generarMetadatos(titulo, contenido, categoria);
            descripcion = metadatos.description;
            if (!palabras || palabras === categoria) {
                palabras = metadatos.keywords;
            }
        }

        // Guardar en base de datos
        const result = await pool.query(
            `INSERT INTO noticias (
                titulo, slug, seccion, contenido, seo_description, seo_keywords, 
                redactor, imagen, imagen_alt, imagen_caption, imagen_nombre, imagen_fuente, estado
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
            RETURNING id, slug`,
            [
                titulo.substring(0, 255),
                slugFinal,
                categoria,
                contenido.substring(0, 10000),
                descripcion.substring(0, 160),
                palabras.substring(0, 255),
                redactor,
                imagen.url,
                imagen.alt,
                imagen.caption,
                imagen.nombre,
                imagen.fuente,
                'publicada'
            ]
        );

        const noticia = result.rows[0];

        console.log(`\n✅ NOTICIA PUBLICADA:`);
        console.log(`   ID: ${noticia.id}`);
        console.log(`   Título: ${titulo.substring(0, 60)}...`);
        console.log(`   Slug: ${slugFinal}`);
        console.log(`   URL: ${BASE_URL}/noticia/${slugFinal}`);

        return {
            success: true,
            id: noticia.id,
            slug: slugFinal,
            titulo,
            url: `${BASE_URL}/noticia/${slugFinal}`,
            mensaje: 'Noticia generada correctamente'
        };

    } catch (error) {
        console.error('❌ Error generando noticia:', error.message);
        return { success: false, error: error.message };
    }
}

// ==================== CATEGORÍAS Y CRON ====================
const CATEGORIAS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];

// Programar generación automática (cada 4 horas)
cron.schedule('0 */4 * * *', async () => {
    if (!CONFIG_IA.enabled) {
        console.log('⏰ CRON: IA desactivada, no se genera noticia');
        return;
    }

    console.log(`\n⏰ CRON: Ejecutando generación automática (${new Date().toLocaleString()})`);

    // Seleccionar una categoría aleatoria
    const categoria = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    await generarNoticia(categoria);
});

console.log('✅ Sistema automático configurado (cada 4 horas)');

// ==================== RUTAS PÚBLICAS ====================

// Páginas
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/nosotros', (req, res) => res.sendFile(path.join(__dirname, 'client', 'nosotros.html')));
app.get('/contacto', (req, res) => res.sendFile(path.join(__dirname, 'client', 'contacto.html')));
app.get('/privacidad', (req, res) => res.sendFile(path.join(__dirname, 'client', 'privacidad.html')));

// Health check
app.get('/health', (req, res) => res.json({ status: 'OK', version: '24.2' }));

// Obtener lista de noticias
app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, titulo, slug, seccion, imagen, fecha, vistas, redactor FROM noticias WHERE estado = $1 ORDER BY fecha DESC LIMIT 30',
            ['publicada']
        );
        res.json({ success: true, noticias: result.rows });
    } catch (error) {
        console.error('Error en /api/noticias:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Generar noticia (manual)
app.post('/api/generar-noticia', async (req, res) => {
    const { categoria } = req.body;

    if (!categoria) {
        return res.status(400).json({ success: false, error: 'Falta la categoría' });
    }

    if (!CATEGORIAS.includes(categoria)) {
        return res.status(400).json({ success: false, error: 'Categoría no válida' });
    }

    const resultado = await generarNoticia(categoria);
    res.status(resultado.success ? 200 : 500).json(resultado);
});

// Ver noticia por slug
app.get('/noticia/:slug', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM noticias WHERE slug = $1 AND estado = $2',
            [req.params.slug, 'publicada']
        );

        if (result.rows.length === 0) {
            return res.status(404).sendFile(path.join(__dirname, 'client', '404.html'));
        }

        const noticia = result.rows[0];

        // Incrementar vistas
        await pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE id = $1', [noticia.id]);

        // Cargar plantilla
        let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');

        // Reemplazar placeholders
        const fecha = new Date(noticia.fecha).toLocaleDateString('es-DO', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const contenidoHTML = noticia.contenido
            .split('\n')
            .filter(p => p.trim() !== '')
            .map(p => `<p>${p.trim()}</p>`)
            .join('');

        html = html
            .replace(/{{SECCION}}/g, noticia.seccion || '')
            .replace(/{{TITULO}}/g, noticia.titulo || '')
            .replace(/{{FECHA}}/g, fecha)
            .replace(/{{REDACTOR}}/g, noticia.redactor || 'Redacción')
            .replace(/{{VISTAS}}/g, noticia.vistas || 0)
            .replace(/{{IMAGEN}}/g, noticia.imagen || '')
            .replace(/{{ALT}}/g, noticia.imagen_alt || noticia.titulo || '')
            .replace(/{{CONTENIDO}}/g, contenidoHTML)
            .replace(/{{URL}}/g, `${BASE_URL}/noticia/${noticia.slug}`);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);

    } catch (error) {
        console.error('Error en /noticia/:slug:', error.message);
        res.status(500).send('Error interno del servidor');
    }
});

// Sitemap
app.get('/sitemap.xml', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT slug, fecha FROM noticias WHERE estado = $1 ORDER BY fecha DESC',
            ['publicada']
        );

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `  <url><loc>${BASE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;

        for (const noticia of result.rows) {
            const fecha = new Date(noticia.fecha).toISOString().split('T')[0];
            xml += `  <url><loc>${BASE_URL}/noticia/${noticia.slug}</loc><lastmod>${fecha}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
        }

        xml += '</urlset>';

        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (error) {
        console.error('Error en sitemap.xml:', error.message);
        res.status(500).send('Error generando sitemap');
    }
});

// Robots.txt
app.get('/robots.txt', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send(`User-agent: *\nAllow: /\nDisallow: /api/admin\nSitemap: ${BASE_URL}/sitemap.xml`);
});

// Estadísticas
app.get('/api/estadisticas', async (req, res) => {
    try {
        const totalResult = await pool.query(
            'SELECT COUNT(*) as count, SUM(vistas) as vistas FROM noticias WHERE estado = $1',
            ['publicada']
        );

        res.json({
            success: true,
            totalNoticias: parseInt(totalResult.rows[0].count) || 0,
            totalVistas: parseInt(totalResult.rows[0].vistas) || 0
        });
    } catch (error) {
        console.error('Error en /api/estadisticas:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== RUTAS DE ADMIN (protegidas con PIN 311) ====================

// Obtener configuración IA
app.get('/api/admin/config', (req, res) => {
    const { pin } = req.query;

    if (pin !== '311') {
        return res.status(403).json({ error: 'Acceso denegado' });
    }

    res.json(CONFIG_IA);
});

// Guardar configuración IA
app.post('/api/admin/config', express.json(), (req, res) => {
    const { pin, enabled, instruccion_principal, tono, extension, enfasis, evitar } = req.body;

    if (pin !== '311') {
        return res.status(403).json({ error: 'PIN incorrecto' });
    }

    if (enabled !== undefined) CONFIG_IA.enabled = enabled;
    if (instruccion_principal) CONFIG_IA.instruccion_principal = instruccion_principal;
    if (tono) CONFIG_IA.tono = tono;
    if (extension) CONFIG_IA.extension = extension;
    if (enfasis) CONFIG_IA.enfasis = enfasis;
    if (evitar) CONFIG_IA.evitar = evitar;

    if (guardarConfigIA(CONFIG_IA)) {
        res.json({ success: true, mensaje: 'Configuración guardada' });
    } else {
        res.status(500).json({ error: 'Error guardando configuración' });
    }
});

// Publicar noticia manual
app.post('/api/publicar', express.json(), async (req, res) => {
    const { pin, titulo, seccion, contenido, redactor } = req.body;

    if (pin !== '311') {
        return res.status(403).json({ error: 'PIN incorrecto' });
    }

    if (!titulo || !seccion || !contenido) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    try {
        const slug = generarSlug(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        const slugFinal = existe.rows.length > 0 ? `${slug}-${Date.now()}` : slug;

        // Imagen por defecto
        const imagenUrl = 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg';

        await pool.query(
            `INSERT INTO noticias (titulo, slug, seccion, contenido, redactor, imagen, estado)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [titulo, slugFinal, seccion, contenido, redactor || 'Manual', imagenUrl, 'publicada']
        );

        res.json({
            success: true,
            slug: slugFinal,
            url: `${BASE_URL}/noticia/${slugFinal}`,
            mensaje: 'Noticia publicada correctamente'
        });

    } catch (error) {
        console.error('Error en /api/publicar:', error.message);
        res.status(500).json({ error:
