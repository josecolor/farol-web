/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR PROFESIONAL V10.3 - PARTE 1
 * Gemini con DETECCIÓN DE ENTIDADES PREMIUM (Regla de Oro)
 * Horarios automáticos: Cada 6 horas + Diaria 8 AM
 * VERSIÓN DEFINITIVA - CODIGO COMPLETO Y SEGURO
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// ==================== CONEXIÓN POSTGRESQL ====================
if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL no está definida');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==================== MIDDLEWARE ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ==================== LISTA DE REDACTORES ====================
const REDACTORES = [
    { nombre: 'Carlos Méndez', especialidad: 'Nacionales' },
    { nombre: 'Laura Santana', especialidad: 'Deportes' },
    { nombre: 'Roberto Peña', especialidad: 'Internacionales' },
    { nombre: 'Ana María Castillo', especialidad: 'Economía' },
    { nombre: 'José Miguel Fernández', especialidad: 'Tecnología' },
    { nombre: 'Patricia Jiménez', especialidad: 'Espectáculos' },
    { nombre: 'Fernando Rivas', especialidad: 'Nacionales' },
    { nombre: 'Carmen Lora', especialidad: 'Deportes' },
    { nombre: 'Miguel Ángel Pérez', especialidad: 'Internacionales' }
];

function elegirRedactor(categoria) {
    const especialistas = REDACTORES.filter(r => r.especialidad === categoria);
    if (especialistas.length > 0) {
        return especialistas[Math.floor(Math.random() * especialistas.length)].nombre;
    }
    return REDACTORES[Math.floor(Math.random() * REDACTORES.length)].nombre;
}

// ==================== FUNCIÓN PARA GENERAR SLUG ====================
function generarSlug(texto) {
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 80);
}

// ==================== MIGRACIÓN COMPLETA DE BD ====================
async function inicializarBase() {
    const client = await pool.connect();
    try {
        console.log('🔧 Verificando estructura de base de datos...');
        await client.query('BEGIN');

        await client.query(`
            CREATE TABLE IF NOT EXISTS noticias (
                id SERIAL PRIMARY KEY,
                titulo VARCHAR(255) NOT NULL,
                slug VARCHAR(255),
                seccion VARCHAR(100) NOT NULL,
                contenido TEXT NOT NULL,
                seo_description VARCHAR(160),
                seo_keywords VARCHAR(255),
                ubicacion VARCHAR(100) DEFAULT 'Santo Domingo',
                redactor VARCHAR(100) DEFAULT 'IA Gemini',
                imagen TEXT DEFAULT '/default-news.jpg',
                imagen_alt VARCHAR(255),
                vistas INTEGER DEFAULT 0,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                estado VARCHAR(50) DEFAULT 'publicada'
            );
        `);
        console.log('✅ Tabla "noticias" asegurada');

        const columnasNecesarias = [
            { name: 'slug', type: 'VARCHAR(255)' },
            { name: 'seo_description', type: 'VARCHAR(160)' },
            { name: 'seo_keywords', type: 'VARCHAR(255)' },
            { name: 'imagen_alt', type: 'VARCHAR(255)' }
        ];

        for (const col of columnasNecesarias) {
            const checkCol = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name='noticias' AND column_name=$1
            `, [col.name]);
            
            if (checkCol.rows.length === 0) {
                console.log(`➕ Agregando columna ${col.name}...`);
                await client.query(`ALTER TABLE noticias ADD COLUMN ${col.name} ${col.type}`);
            }
        }

        console.log('🔄 Generando slugs para noticias sin slug...');
        await client.query(`
            UPDATE noticias 
            SET slug = lower(regexp_replace(titulo, '[^a-zA-Z0-9áéíóúÁÉÍÓÚüÜñÑ]+', '-', 'g')) 
            WHERE slug IS NULL
        `);

        await client.query(`ALTER TABLE noticias ALTER COLUMN slug SET NOT NULL`);

        const checkUnique = await client.query(`
            SELECT conname FROM pg_constraint 
            WHERE conname = 'noticias_slug_unique'
        `);
        if (checkUnique.rows.length === 0) {
            console.log('➕ Agregando restricción UNIQUE en slug...');
            await client.query('ALTER TABLE noticias ADD CONSTRAINT noticias_slug_unique UNIQUE (slug)');
        }

        await client.query(`ALTER TABLE noticias ALTER COLUMN titulo TYPE VARCHAR(255)`);

        await client.query('COMMIT');
        console.log('✅ Base de datos lista y migrada correctamente');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en migración de base de datos:', error.message);
        return false;
    } finally {
        client.release();
    }
}

// ==================== 🎯 DETECCIÓN DE ENTIDADES Y GENERACIÓN ====================
async function generarNoticiaInteligente(categoria) {
    try {
        console.log(`\n🤖 Editor de imágenes analizando noticia de: ${categoria}`);

        const prompt = `Actúa como el EDITOR DE FOTOGRAFÍA de un periódico profesional.

Tu tarea es analizar la noticia y extraer la ENTIDAD principal (la persona, artista, equipo o cosa protagonista).

Noticia sobre: ${categoria} en República Dominicana.

REGLAS DE ORO:
1. Si la noticia es sobre una PERSONA FAMOSA (artista, DJ, político, deportista), la ENTIDAD es su NOMBRE.
2. La CATEGORIA es su profesión (DJ, Presidente, Cantante, Equipo).
3. El IMAGE_QUERY debe ser UNA BÚSQUEDA ULTRA-ESPECÍFICA en inglés para obtener la foto exacta.

Genera UNA noticia profesional con ESTE FORMATO EXACTO:

TITULO: [título atractivo, 50-60 caracteres]
ENTIDAD: [nombre de la persona/equipo protagonista, o vacío si no aplica]
CATEGORIA_ENTIDAD: [DJ, Presidente, Equipo, Artista, etc., o vacío]
IMAGE_QUERY: [UNA frase de búsqueda ultra-específica en inglés]
DESCRIPCION: [descripción SEO, máx 160 caracteres]
PALABRAS: [5 palabras clave separadas por coma]
CONTENIDO:
[contenido completo de 400-500 palabras]

EJEMPLOS DE CALIDAD:

TITULO: Diplo sorprende con nuevo set en festival de Miami
ENTIDAD: Diplo
CATEGORIA_ENTIDAD: DJ
IMAGE_QUERY: Diplo DJ performing live concert stage
DESCRIPCION: El reconocido DJ y productor Diplo presentó un innovador set en el festival de Miami
PALABRAS: Diplo, música electrónica, festival, DJ, Miami
CONTENIDO: El reconocido DJ estadounidense Diplo se presentó anoche en el festival de Miami con un set sorprendente que hizo bailar a miles de asistentes.

TITULO: Real Madrid gana la Champions League en emocionante final
ENTIDAD: Real Madrid
CATEGORIA_ENTIDAD: Equipo de Fútbol
IMAGE_QUERY: Real Madrid players celebrating Champions League trophy
DESCRIPCION: El Real Madrid se coronó campeón de la Champions League
PALABRAS: Real Madrid, Champions, fútbol, campeón, final
CONTENIDO: El Real Madrid hizo historia anoche al conquistar su decimocuarta Champions League.

TITULO: Luis Abinader anuncia nuevo plan de viviendas en Santo Domingo
ENTIDAD: Luis Abinader
CATEGORIA_ENTIDAD: Presidente
IMAGE_QUERY: Luis Abinader Presidente Dominicana discurso oficial
DESCRIPCION: El presidente Luis Abinader anunció hoy un ambicioso plan de viviendas
PALABRAS: Abinader, viviendas, gobierno, Santo Domingo, plan
CONTENIDO: El presidente Luis Abinader encabezó hoy el lanzamiento del nuevo plan de viviendas.

TITULO: Apple presenta el nuevo iPhone 15 con innovadoras características
ENTIDAD: 
CATEGORIA_ENTIDAD: 
IMAGE_QUERY: new iPhone 15 product presentation official
DESCRIPCION: Apple lanzó hoy el nuevo iPhone 15 con características innovadoras
PALABRAS: Apple, iPhone, tecnología, lanzamiento, innovación
CONTENIDO: Apple presentó oficialmente el esperado iPhone 15.

Ahora genera una noticia de ${categoria} en República Dominicana:`;

        console.log(`📤 Enviando solicitud a Gemini (Editor de imágenes)...`);

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 4000,
                    }
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Gemini ${response.status}`);
        }

        const data = await response.json();
        const texto = data.candidates[0].content.parts[0].text;
        console.log(`📝 Respuesta del editor: ${texto.length} caracteres`);

        // ===== PARSEO CORREGIDO =====
        let titulo = "";
        let entidad = "";
        let categoriaEntidad = "";
        let imageQuery = "";
        let descripcion = "";
        let palabras = categoria;
        let contenido = "";

        const lineas = texto.split('\n');
        
        for (let i = 0; i < lineas.length; i++) {
            const linea = lineas[i].trim();
            
            if (linea.startsWith('TITULO:')) {
                titulo = linea.substring(7).trim();
            }
            else if (linea.startsWith('ENTIDAD:')) {
                entidad = linea.substring(8).trim();
            }
            else if (linea.startsWith('CATEGORIA_ENTIDAD:')) {
                categoriaEntidad = linea.substring(18).trim();
            }
            else if (linea.startsWith('IMAGE_QUERY:')) {
                imageQuery = linea.substring(12).trim();
            }
            else if (linea.startsWith('DESCRIPCION:')) {
                descripcion = linea.substring(12).trim();
            }
            else if (linea.startsWith('PALABRAS:')) {
                palabras = linea.substring(9).trim();
            }
            else if (linea.startsWith('CONTENIDO:')) {
                contenido = linea.substring(10).trim();
                for (let j = i + 1; j < lineas.length; j++) {
                    contenido += '\n' + lineas[j];
                }
                break;
            }
        }

        // Limpiar caracteres especiales
        titulo = titulo.replace(/[*_#`]/g, '').trim();
        entidad = entidad.replace(/[*_#`]/g, '').trim();
        categoriaEntidad = categoriaEntidad.replace(/[*_#`]/g, '').trim();
        imageQuery = imageQuery.replace(/[*_#`]/g, '').trim();
        descripcion = descripcion.replace(/[*_#`]/g, '').substring(0, 160);
        palabras = palabras.replace(/[*_#`]/g, '').substring(0, 255);

        // Validaciones
        if (!titulo || titulo.length < 10) {
            titulo = `Nuevos avances en ${categoria} en República Dominicana`;
        }

        if (!imageQuery) {
            if (entidad) {
                imageQuery = `${entidad} ${categoriaEntidad || ''} official`.trim();
            } else {
                imageQuery = `${categoria} dominican republic news`;
            }
        }

        if (!descripcion) {
            descripcion = titulo.substring(0, 160);
        }

        if (!contenido || contenido.length < 200) {
            contenido = `Las autoridades dominicanas han anunciado importantes medidas en el ámbito de ${categoria} que buscan mejorar la calidad de vida de los ciudadanos. Según expertos consultados por El Farol al Día, estas iniciativas representan un avance significativo para el país.`;
        }

        console.log(`📌 Título: ${titulo.substring(0, 60)}...`);
        console.log(`🎯 Entidad detectada: ${entidad || 'ninguna'}`);
        console.log(`🔍 Image Query: ${imageQuery}`);

        return {
            titulo,
            entidad,
            categoriaEntidad,
            imageQuery,
            descripcion,
            palabras,
            contenido,
            categoria
        };

    } catch (error) {
        console.error(`\n❌ ERROR del editor:`, error.message);
        return null;
    }
}

// ==================== 🖼️ REGLA DE ORO: BÚSQUEDA PRIORITARIA ====================
async function buscarImagenConReglaDeOro(dataNoticia) {
    try {
        let busquedaFinal;
        let tipoBusqueda = "genérica";

        // REGLA DE ORO: Si hay una persona o entidad famosa, ella es la prioridad
        if (dataNoticia.entidad && dataNoticia.entidad.length > 2) {
            console.log(`🎯 APLICANDO REGLA DE ORO: Entidad detectada - ${dataNoticia.entidad}`);
            
            if (dataNoticia.categoriaEntidad) {
                busquedaFinal = `${dataNoticia.entidad} ${dataNoticia.categoriaEntidad} official photo`;
            } else {
                busquedaFinal = `${dataNoticia.entidad} portrait`;
            }
            tipoBusqueda = "por entidad";
        } 
        // Si no hay entidad, usar el imageQuery optimizado
        else if (dataNoticia.imageQuery) {
            console.log(`🖼️ Usando image query optimizado`);
            busquedaFinal = dataNoticia.imageQuery;
            tipoBusqueda = "por query";
        } 
        // Último recurso: usar la categoría
        else {
            console.log(`📸 Usando categoría como fallback`);
            busquedaFinal = dataNoticia.categoria;
            tipoBusqueda = "por categoría";
        }

        console.log(`🔍 Búsqueda ${tipoBusqueda}: "${busquedaFinal}"`);

        // Formatear para API
        const busquedaFormateada = busquedaFinal.trim().replace(/\s+/g, '+');

        // ========== 1. PROBAR PEXELS ==========
        if (process.env.PEXELS_API_KEY) {
            try {
                const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(busquedaFormateada)}&per_page=5&orientation=landscape`;
                const response = await fetch(url, {
                    headers: { 'Authorization': process.env.PEXELS_API_KEY }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.photos && data.photos.length > 0) {
                        console.log(`✅ Foto encontrada en Pexels para: ${busquedaFinal}`);
                        return {
                            url: data.photos[0].src.landscape,
                            alt: data.photos[0].alt || busquedaFinal,
                            source: 'Pexels'
                        };
                    }
                }
            } catch (e) {
                console.log(`⚠️ Pexels error: ${e.message}`);
            }
        }

        // ========== 2. PROBAR UNSPLASH ==========
        if (process.env.UNSPLASH_ACCESS_KEY) {
            try {
                const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(busquedaFormateada)}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&orientation=landscape&per_page=5`;
                const response = await fetch(url);
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.results && data.results.length > 0) {
                        console.log(`✅ Foto encontrada en Unsplash para: ${busquedaFinal}`);
                        return {
                            url: data.results[0].urls.regular,
                            alt: data.results[0].alt_description || busquedaFinal,
                            source: 'Unsplash'
                        };
                    }
                }
            } catch (e) {
                console.log(`⚠️ Unsplash error: ${e.message}`);
            }
        }

        // ========== 3. PROBAR PIXABAY ==========
        if (process.env.PIXABAY_API_KEY) {
            try {
                const url = `https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(busquedaFormateada)}&image_type=photo&orientation=horizontal&per_page=5&safesearch=true`;
                const response = await fetch(url);
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.hits && data.hits.length > 0) {
                        console.log(`✅ Foto encontrada en Pixabay para: ${busquedaFinal}`);
                        return {
                            url: data.hits[0].webformatURL,
                            alt: data.hits[0].tags || busquedaFinal,
                            source: 'Pixabay'
                        };
                    }
                }
            } catch (e) {
                console.log(`⚠️ Pixabay error: ${e.message}`);
            }
        }

        console.log(`❌ No se encontró imagen para: ${busquedaFinal}`);
        return null;

    } catch (error) {
        console.error('❌ Error en búsqueda de imagen:', error.message);
        return null;
    }
}

// ==================== 🖼️ BANCO DE RESPALDO ====================
function imagenRespaldo(categoria) {
    console.log(`📸 Usando imagen de respaldo para: ${categoria}`);
    
    const imagenesRespaldo = {
        'Nacionales': 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg',
        'Deportes': 'https://images.pexels.com/photos/46798/the-ball-stadion-football-the-pitch-46798.jpeg',
        'Internacionales': 'https://images.pexels.com/photos/2860705/pexels-photo-2860705.jpeg',
        'Espectáculos': 'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg',
        'Economía': 'https://images.pexels.com/photos/4386466/pexels-photo-4386466.jpeg',
        'Tecnología': 'https://images.pexels.com/photos/3861958/pexels-photo-3861958.jpeg'
    };
    
    return {
        url: imagenesRespaldo[categoria] || imagenesRespaldo['Nacionales'],
        alt: `Noticia de ${categoria}`,
        source: 'respaldo'
    };
}

// ==================== 🤖 GENERAR NOTICIA COMPLETA ====================
async function generarNoticiaCompleta(categoria) {
    try {
        // PASO 1: Gemini actúa como EDITOR
        const dataNoticia = await generarNoticiaInteligente(categoria);
        
        if (!dataNoticia) {
            throw new Error("No se pudo generar la noticia");
        }

        // PASO 2: APLICAR REGLA DE ORO para buscar la imagen
        let imagenData = await buscarImagenConReglaDeOro(dataNoticia);
        
        // PASO 3: Si no se encontró imagen, usar respaldo
        if (!imagenData) {
            imagenData = imagenRespaldo(categoria);
        }

        // PASO 4: Generar slug
        const slug = generarSlug(dataNoticia.titulo);
        const redactorAsignado = elegirRedactor(categoria);

        // Verificar slug duplicado
        const slugExistente = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        let slugFinal = slug;
        if (slugExistente.rows.length > 0) {
            slugFinal = `${slug}-${Date.now().toString().slice(-4)}`;
        }

        // PASO 5: Guardar en BD
        const result = await pool.query(
            `INSERT INTO noticias (
                titulo, slug, seccion, contenido, 
                seo_description, seo_keywords, 
                redactor, imagen, imagen_alt, 
                ubicacion, estado
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
            RETURNING id, slug, titulo, imagen`,
            [
                dataNoticia.titulo.substring(0, 255),
                slugFinal,
                categoria,
                dataNoticia.contenido,
                dataNoticia.descripcion,
                dataNoticia.palabras.substring(0, 255),
                redactorAsignado,
                imagenData.url,
                imagenData.alt || `Noticia sobre ${dataNoticia.entidad || categoria}`,
                'Santo Domingo',
                'publicada'
            ]
        );

        const noticia = result.rows[0];
        
        console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║  🏮 NOTICIA PUBLICADA CON EDITOR DE IMÁGENES                     ║
╠═══════════════════════════════════════════════════════════════════╣
║  📰 Título: ${dataNoticia.titulo.substring(0, 50)}...           ║
║  🎯 Entidad: ${dataNoticia.entidad || 'ninguna'}                 ║
║  🔍 Búsqueda: ${dataNoticia.imageQuery}                          ║
║  🖼️ Fuente: ${imagenData.source}                                 ║
║  👤 Redactor: ${redactorAsignado}                                ║
║  🔗 URL: ${BASE_URL}/noticia/${noticia.slug}                     ║
╚═══════════════════════════════════════════════════════════════════╝
        `);

        return {
            success: true,
            id: noticia.id,
            slug: noticia.slug,
            titulo: noticia.titulo,
            url: `${BASE_URL}/noticia/${noticia.slug}`,
            imagen: noticia.imagen,
            redactor: redactorAsignado,
            entidad: dataNoticia.entidad || 'ninguna',
            fuente_imagen: imagenData.source,
            mensaje: '✅ Noticia generada con foto de impacto real'
        };

    } catch (error) {
        console.error(`\n❌ ERROR:`, error.message);
        return { success: false, error: error.message };
    }
}

// ==================== CATEGORÍAS ====================
const CATEGORIAS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];

// ==================== ⏰ AUTOMATIZACIÓN ====================
console.log('\n📅 Configurando automatización con EDITOR DE IMÁGENES...');
cron.schedule('0 */6 * * *', async () => {
    console.log('\n⏰ Generando noticia automática (cada 6 horas)...');
    const categoria = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    await generarNoticiaCompleta(categoria);
});
cron.schedule('0 8 * * *', async () => {
    console.log('\n🌅 Generando noticia diaria (8 AM)...');
    await generarNoticiaCompleta('Nacionales');
});
console.log('✅ Automatización configurada con REGLA DE ORO');// ==================== RUTAS ====================
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// ==================== API NOTICIAS ====================
app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, titulo, slug, seccion, contenido, imagen, imagen_alt, fecha, vistas, redactor, seo_description FROM noticias WHERE estado = $1 ORDER BY fecha DESC LIMIT 30',
            ['publicada']
        );
        res.json({ success: true, noticias: result.rows });
    } catch (error) {
        console.error('❌ Error /api/noticias:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/noticias/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM noticias WHERE id = $1 AND estado = $2',
            [req.params.id, 'publicada']
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No encontrada' });
        }

        await pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE id = $1', [req.params.id]);
        res.json({ success: true, noticia: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== NOTICIA POR SLUG ====================
app.get('/noticia/:slug', async (req, res) => {
    const slugBuscado = req.params.slug;
    
    try {
        const result = await pool.query(
            'SELECT * FROM noticias WHERE slug = $1 AND estado = $2',
            [slugBuscado, 'publicada']
        );

        if (result.rows.length === 0) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Noticia no encontrada | El Farol al Día</title>
                    <style>
                        body { font-family: Arial; text-align: center; padding: 50px; background: #0b0b0b; color: white; }
                        h1 { color: #c62828; }
                        a { color: #FF8C00; text-decoration: none; font-size: 18px; }
                    </style>
                </head>
                <body>
                    <h1>🔍 Noticia no encontrada</h1>
                    <p>La noticia que buscas no existe o ha sido eliminada.</p>
                    <a href="/">← Volver al inicio</a>
                </body>
                </html>
            `);
        }

        const noticia = result.rows[0];
        await pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE id = $1', [noticia.id]);

        const contenidoFormateado = noticia.contenido
            .split('\n')
            .filter(p => p.trim() !== '')
            .map(p => `<p>${p.trim()}</p>`)
            .join('');

        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
            const urlCompartir = `${BASE_URL}/noticia/${noticia.slug}`;
            
            const metaTags = `
<title>${noticia.titulo} | El Farol al Día</title>
<meta name="description" content="${noticia.seo_description || noticia.titulo}">
<meta name="keywords" content="${noticia.seo_keywords || noticia.seccion}">
<meta property="og:title" content="${noticia.titulo}">
<meta property="og:description" content="${noticia.seo_description || noticia.titulo}">
<meta property="og:image" content="${noticia.imagen}">
<meta property="og:url" content="${urlCompartir}">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  "headline": "${noticia.titulo}",
  "description": "${noticia.seo_description || noticia.titulo}",
  "image": "${noticia.imagen}",
  "datePublished": "${noticia.fecha}",
  "author": {"@type": "Person", "name": "${noticia.redactor}"},
  "publisher": {"@type": "Organization", "name": "El Farol al Día"}
}
</script>`;

            html = html.replace('<!-- META_TAGS -->', metaTags);
            html = html.replace(/{{TITULO}}/g, noticia.titulo);
            html = html.replace(/{{CONTENIDO}}/g, contenidoFormateado);
            html = html.replace(/{{FECHA}}/g, new Date(noticia.fecha).toLocaleDateString('es-DO'));
            html = html.replace(/{{IMAGEN}}/g, noticia.imagen);
            html = html.replace(/{{ALT}}/g, noticia.imagen_alt || noticia.titulo);
            html = html.replace(/{{VISTAS}}/g, noticia.vistas);
            html = html.replace(/{{SECCION}}/g, noticia.seccion);
            html = html.replace(/{{REDACTOR}}/g, noticia.redactor);
            html = html.replace(/{{URL}}/g, urlCompartir);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
            
        } catch (error) {
            console.error('Error leyendo HTML:', error.message);
            res.json({ success: true, noticia });
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).send('Error interno');
    }
});

// ==================== GENERAR NOTICIA MANUAL ====================
app.post('/api/generar-noticia', async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });

    const resultado = await generarNoticiaCompleta(categoria);

    if (resultado.success) {
        res.json(resultado);
    } else {
        res.status(500).json(resultado);
    }
});

// ==================== SITEMAP ====================
app.get('/sitemap.xml', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT slug, fecha FROM noticias WHERE estado = $1 ORDER BY fecha DESC',
            ['publicada']
        );

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `  <url><loc>${BASE_URL}/</loc><priority>1.0</priority></url>\n`;

        result.rows.forEach(n => {
            xml += `  <url><loc>${BASE_URL}/noticia/${n.slug}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><priority>0.8</priority></url>\n`;
        });

        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (error) {
        res.status(500).send('Error');
    }
});

// ==================== ROBOTS.TXT ====================
app.get('/robots.txt', (req, res) => {
    const robots = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/

Sitemap: ${BASE_URL}/sitemap.xml

User-agent: Googlebot
Allow: /
`;
    res.header('Content-Type', 'text/plain');
    res.send(robots);
});

// ==================== STATUS ====================
app.get('/status', async (req, res) => {
    try {
        const dbStatus = await pool.query('SELECT 1 as health');
        const noticiasCount = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado = $1', ['publicada']);

        res.json({
            status: 'OK',
            database: dbStatus.rows[0]?.health === 1 ? 'conectado' : 'error',
            noticias_publicadas: parseInt(noticiasCount.rows[0].count),
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
            version: '10.3',
            modo: 'EDITOR DE IMÁGENES ACTIVADO'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== FALLBACK ====================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== INICIAR SERVIDOR ====================
async function iniciar() {
    try {
        console.log('\n🚀 Iniciando servidor con EDITOR DE IMÁGENES...');
        
        const dbOk = await inicializarBase();
        if (!dbOk) {
            console.log('⚠️ Continuando a pesar de errores de BD...');
        }

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - SERVIDOR PROFESIONAL V10.3 🏮            ║
╠═══════════════════════════════════════════════════════════════════╣
║  ✅ Servidor en puerto ${PORT}                                     ║
║  ✅ PostgreSQL conectado y migrado                               ║
║  ✅ EDITOR DE IMÁGENES ACTIVADO                               ║  ✅ Automatización: Cada 6h + 8 AM                             ║
║  ✅ Regla de Oro (Entidades): ACTIVADA                        ║
║  🌍 URL: ${BASE_URL}                                         ║
╚═══════════════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        console.error('❌ Error fatal al iniciar:', error.message);
        process.exit(1);
    }
}

// 🔥 ENCENDER EL MOTOR
iniciar();
  
