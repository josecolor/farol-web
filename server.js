/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR PROFESIONAL V9.2
 * Gemini genera noticias con DETECCIÓN DE PERSONAS FAMOSAS
 * Horarios automáticos: Cada 6 horas + Diaria 8 AM
 * VERSIÓN DEFINITIVA - CON BÚSQUEDA DE IMÁGENES POR NOMBRE
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

// ==================== 🖼️ BUSCAR IMAGEN DE PERSONA FAMOSA ====================
async function buscarImagenPersona(nombrePersona, categoria) {
    try {
        console.log(`🎯 Buscando imagen de: ${nombrePersona}`);
        
        // Limpiar el nombre para búsqueda
        const nombreLimpio = nombrePersona.trim().replace(/\s+/g, '+');
        
        // ========== 1. UNSPLASH (mejor para personas) ==========
        if (process.env.UNSPLASH_ACCESS_KEY) {
            try {
                // Unsplash tiene buenas fotos de personas famosas
                const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(nombreLimpio)}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&orientation=landscape&per_page=5`;
                const response = await fetch(url);
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.results && data.results.length > 0) {
                        console.log(`✅ Imagen de ${nombrePersona} encontrada en Unsplash`);
                        return {
                            url: data.results[0].urls.regular,
                            alt: `${nombrePersona} - ${categoria}`,
                            source: 'Unsplash'
                        };
                    }
                }
            } catch (e) {
                console.log(`⚠️ Unsplash error: ${e.message}`);
            }
        }
        
        // ========== 2. PEXELS ==========
        if (process.env.PEXELS_API_KEY) {
            try {
                const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(nombreLimpio)}&per_page=5&orientation=landscape`;
                const response = await fetch(url, {
                    headers: { 'Authorization': process.env.PEXELS_API_KEY }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.photos && data.photos.length > 0) {
                        console.log(`✅ Imagen de ${nombrePersona} encontrada en Pexels`);
                        return {
                            url: data.photos[0].src.landscape,
                            alt: `${nombrePersona} - ${categoria}`,
                            source: 'Pexels'
                        };
                    }
                }
            } catch (e) {
                console.log(`⚠️ Pexels error: ${e.message}`);
            }
        }
        
        // ========== 3. PIXABAY ==========
        if (process.env.PIXABAY_API_KEY) {
            try {
                const url = `https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(nombreLimpio)}&image_type=photo&orientation=horizontal&per_page=5&safesearch=true`;
                const response = await fetch(url);
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.hits && data.hits.length > 0) {
                        console.log(`✅ Imagen de ${nombrePersona} encontrada en Pixabay`);
                        return {
                            url: data.hits[0].webformatURL,
                            alt: `${nombrePersona} - ${categoria}`,
                            source: 'Pixabay'
                        };
                    }
                }
            } catch (e) {
                console.log(`⚠️ Pixabay error: ${e.message}`);
            }
        }
        
        console.log(`❌ No se encontró imagen de ${nombrePersona}, usando respaldo`);
        return null;

    } catch (error) {
        console.error('❌ Error buscando imagen de persona:', error.message);
        return null;
    }
}

// ==================== 🖼️ BUSCAR IMAGEN GENÉRICA ====================
async function buscarImagenGenerica(query, categoria) {
    try {
        console.log(`🔍 Buscando imagen genérica: "${query}"`);
        
        const queryFormateada = query.trim().replace(/\s+/g, '+');
        
        // ========== 1. UNSPLASH ==========
        if (process.env.UNSPLASH_ACCESS_KEY) {
            try {
                const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(queryFormateada)}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&orientation=landscape&per_page=5`;
                const response = await fetch(url);
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.results && data.results.length > 0) {
                        console.log(`✅ Imagen encontrada en Unsplash`);
                        return {
                            url: data.results[0].urls.regular,
                            alt: data.results[0].alt_description || query,
                            source: 'Unsplash'
                        };
                    }
                }
            } catch (e) {
                console.log(`⚠️ Unsplash error: ${e.message}`);
            }
        }
        
        // ========== 2. PEXELS ==========
        if (process.env.PEXELS_API_KEY) {
            try {
                const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(queryFormateada)}&per_page=5&orientation=landscape`;
                const response = await fetch(url, {
                    headers: { 'Authorization': process.env.PEXELS_API_KEY }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.photos && data.photos.length > 0) {
                        console.log(`✅ Imagen encontrada en Pexels`);
                        return {
                            url: data.photos[0].src.landscape,
                            alt: data.photos[0].alt || query,
                            source: 'Pexels'
                        };
                    }
                }
            } catch (e) {
                console.log(`⚠️ Pexels error: ${e.message}`);
            }
        }
        
        // ========== 3. PIXABAY ==========
        if (process.env.PIXABAY_API_KEY) {
            try {
                const url = `https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(queryFormateada)}&image_type=photo&orientation=horizontal&per_page=5&safesearch=true`;
                const response = await fetch(url);
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.hits && data.hits.length > 0) {
                        console.log(`✅ Imagen encontrada en Pixabay`);
                        return {
                            url: data.hits[0].webformatURL,
                            alt: data.hits[0].tags || query,
                            source: 'Pixabay'
                        };
                    }
                }
            } catch (e) {
                console.log(`⚠️ Pixabay error: ${e.message}`);
            }
        }
        
        return null;

    } catch (error) {
        console.error('❌ Error en búsqueda genérica:', error.message);
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

// ==================== 🤖 GENERAR NOTICIA CON GEMINI ====================
async function generarNoticiaCompleta(categoria) {
    try {
        console.log(`\n🤖 Generando noticia SEO para: ${categoria}`);

        const prompt = `Genera una noticia profesional sobre ${categoria} en República Dominicana.

REGLAS IMPORTANTES:
- Título: Atractivo, único, 50-60 caracteres
- Contenido: 400-500 palabras
- Incluye datos específicos de RD, lugares, fechas
- Si la noticia es sobre una persona famosa (artista, DJ, político, deportista, cantante), incluye su nombre
- Sin asteriscos, sin formato especial

Responde EXACTAMENTE con este formato:

TITULO: [título de la noticia]
PERSONA: [nombre de la persona principal si existe, o dejar vacío si no aplica]
DESCRIPCION: [descripción para SEO, máximo 160 caracteres]
PALABRAS: [5 palabras clave separadas por coma]
BUSQUEDA: [3 frases de búsqueda de imágenes en inglés separadas por | ]
CONTENIDO:
[contenido completo de 400-500 palabras en párrafos]

EJEMPLO CON PERSONA:
TITULO: Diplo sorprende con nuevo set en festival de Miami
PERSONA: Diplo
DESCRIPCION: El reconocido DJ y productor Diplo presentó un innovador set en el festival de Miami
PALABRAS: Diplo, música electrónica, festival, DJ, Miami
BUSQUEDA: Diplo DJ live performance | Diplo concert stage | Diplo electronic music festival
CONTENIDO:
El reconocido DJ estadounidense Diplo se presentó anoche en el festival de Miami con un set sorprendente...

EJEMPLO SIN PERSONA:
TITULO: Nuevo plan de viviendas en Santo Domingo
PERSONA: 
DESCRIPCION: El gobierno dominicano anuncia ambicioso programa de viviendas sociales en Santo Domingo
PALABRAS: viviendas, gobierno, construcción, santo domingo, desarrollo
BUSQUEDA: government housing project | construction workers building homes | new apartment buildings
CONTENIDO:
El presidente Luis Abinader encabezó hoy el lanzamiento del nuevo plan de viviendas...`;

        console.log(`📤 Enviando solicitud a Gemini...`);

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
        console.log(`📝 Respuesta: ${texto.length} caracteres`);

        // ===== PARSEO SIMPLE =====
        let titulo = "";
        let persona = "";
        let descripcion = "";
        let palabras = categoria;
        let busquedas = [];
        let contenido = "";

        const lineas = texto.split('\n');
        
        for (let i = 0; i < lineas.length; i++) {
            const linea = lineas[i].trim();
            
            if (linea.startsWith('TITULO:')) {
                titulo = linea.replace('TITULO:', '').trim();
            }
            else if (linea.startsWith('PERSONA:')) {
                persona = linea.replace('PERSONA:', '').trim();
            }
            else if (linea.startsWith('DESCRIPCION:')) {
                descripcion = linea.replace('DESCRIPCION:', '').trim();
            }
            else if (linea.startsWith('PALABRAS:')) {
                palabras = linea.replace('PALABRAS:', '').trim();
            }
            else if (linea.startsWith('BUSQUEDA:')) {
                const busquedasTexto = linea.replace('BUSQUEDA:', '').trim();
                busquedas = busquedasTexto.split('|').map(b => b.trim()).filter(b => b.length > 0);
            }
            else if (linea.startsWith('CONTENIDO:')) {
                contenido = linea.replace('CONTENIDO:', '').trim();
                for (let j = i + 1; j < lineas.length; j++) {
                    contenido += '\n' + lineas[j];
                }
                break;
            }
        }

        // Limpiar
        titulo = titulo.replace(/[*_#`]/g, '').trim();
        persona = persona.replace(/[*_#`]/g, '').trim();
        descripcion = descripcion.replace(/[*_#`]/g, '').substring(0, 160);
        palabras = palabras.replace(/[*_#`]/g, '').substring(0, 255);
        
        if (!titulo || titulo.length < 10) {
            titulo = `Nuevos avances en ${categoria} en República Dominicana`;
        }

        if (!contenido || contenido.length < 200) {
            contenido = `Las autoridades dominicanas han anunciado importantes medidas en el ámbito de ${categoria} que buscan mejorar la calidad de vida de los ciudadanos.`;
        }

        console.log(`📌 Título: ${titulo.substring(0, 60)}...`);
        console.log(`📌 Persona detectada: ${persona || 'ninguna'}`);

        // ===== BUSCAR IMAGEN =====
        let imagenData = null;
        
        // PRIORIDAD 1: Si hay persona famosa, buscar por su nombre
        if (persona && persona.length > 2) {
            console.log(`🎯 PRIORIDAD 1: Buscando imagen de ${persona}`);
            imagenData = await buscarImagenPersona(persona, categoria);
        }
        
        // PRIORIDAD 2: Si no se encontró imagen de persona o no hay persona, usar las búsquedas
        if (!imagenData && busquedas.length > 0) {
            console.log(`🖼️ PRIORIDAD 2: Usando búsquedas específicas`);
            for (const busqueda of busquedas) {
                imagenData = await buscarImagenGenerica(busqueda, categoria);
                if (imagenData) break;
            }
        }
        
        // PRIORIDAD 3: Usar el título
        if (!imagenData) {
            console.log(`📸 PRIORIDAD 3: Usando título como búsqueda`);
            imagenData = await buscarImagenGenerica(titulo.substring(0, 50), categoria);
        }
        
        // PRIORIDAD 4: Banco de respaldo
        if (!imagenData) {
            imagenData = imagenRespaldo(categoria);
        }

        console.log(`✅ Imagen obtenida de: ${imagenData.source}`);

        // Generar slug
        const slug = generarSlug(titulo);
        const redactorAsignado = elegirRedactor(categoria);

        // Verificar slug duplicado
        const slugExistente = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        let slugFinal = slug;
        if (slugExistente.rows.length > 0) {
            slugFinal = `${slug}-${Date.now().toString().slice(-4)}`;
        }

        // Guardar en BD
        const result = await pool.query(
            `INSERT INTO noticias (
                titulo, slug, seccion, contenido, 
                seo_description, seo_keywords, 
                redactor, imagen, imagen_alt, 
                ubicacion, estado
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
            RETURNING id, slug, titulo, imagen`,
            [
                titulo.substring(0, 255),
                slugFinal,
                categoria,
                contenido,
                descripcion,
                palabras.substring(0, 255),
                redactorAsignado,
                imagenData.url,
                imagenData.alt || `Noticia sobre ${persona || categoria}`,
                'Santo Domingo',
                'publicada'
            ]
        );

        const noticia = result.rows[0];
        console.log(`✅ Noticia guardada con ID: ${noticia.id}`);
        console.log(`✅ URL: ${BASE_URL}/noticia/${noticia.slug}`);

        return {
            success: true,
            id: noticia.id,
            slug: noticia.slug,
            titulo: noticia.titulo,
            url: `${BASE_URL}/noticia/${noticia.slug}`,
            imagen: noticia.imagen,
            redactor: redactorAsignado,
            persona: persona || 'ninguna',
            fuente_imagen: imagenData.source,
            mensaje: '✅ Noticia generada'
        };

    } catch (error) {
        console.error(`\n❌ ERROR:`, error.message);
        return { success: false, error: error.message };
    }
}

// ==================== CATEGORÍAS ====================
const CATEGORIAS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];

// ==================== ⏰ AUTOMATIZACIÓN ====================
console.log('\n📅 Configurando automatización...');
cron.schedule('0 */6 * * *', async () => {
    console.log('\n⏰ Generando noticia automática (cada 6 horas)...');
    const categoria = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    await generarNoticiaCompleta(categoria);
});
cron.schedule('0 8 * * *', async () => {
    console.log('\n🌅 Generando noticia diaria (8 AM)...');
    await generarNoticiaCompleta('Nacionales');
});
console.log('✅ Automatización configurada');

// ==================== RUTAS ====================
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
            return res.status(404).send('Noticia no encontrada');
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

            res.send(html);
            
        } catch (error) {
            res.json({ success: true, noticia });
        }
        
    } catch (error) {
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
Sitemap: ${BASE_URL}/sitemap.xml
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
            version: '9.2'
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
        console.log('\n🚀 Iniciando servidor...');
        
        const dbOk = await inicializarBase();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - SERVIDOR PROFESIONAL V9.2 🏮             ║
╠═══════════════════════════════════════════════════════════════════╣
║ ✅ Servidor en puerto ${PORT}                                     ║
║ ✅ DETECCIÓN DE PERSONAS FAMOSAS ACTIVADA                        ║
║ ✅ PRIORIDAD: Buscar por nombre de la persona                    ║
║ ✅ 3 APIs de imágenes: Unsplash, Pexels, Pixabay                 ║
║ ✅ Banco de respaldo por categoría                               ║
║ ✅ Automatización: Cada 6 horas + 8 AM                            ║
║ ✅ VERSIÓN DEFINITIVA - SIN ERRORES                               ║
╚═══════════════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    }
}

iniciar();

module.exports = app;
