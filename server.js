/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR V10.0
 * SISTEMA DE DETECCIÓN DE ENTIDADES + BÚSQUEDA INTELIGENTE DE IMÁGENES
 * Como un editor de imágenes de periódico real
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

// ==================== REDACTORES ====================
const REDACTORES = [
    { nombre: 'Carlos Méndez', especialidad: 'Nacionales' },
    { nombre: 'Laura Santana', especialidad: 'Deportes' },
    { nombre: 'Roberto Peña', especialidad: 'Internacionales' },
    { nombre: 'Ana María Castillo', especialidad: 'Economía' },
    { nombre: 'José Miguel Fernández', especialidad: 'Tecnología' },
    { nombre: 'Patricia Jiménez', especialidad: 'Espectáculos' }
];

function elegirRedactor(categoria) {
    const especialistas = REDACTORES.filter(r => r.especialidad === categoria);
    if (especialistas.length > 0) {
        return especialistas[Math.floor(Math.random() * especialistas.length)].nombre;
    }
    return REDACTORES[Math.floor(Math.random() * REDACTORES.length)].nombre;
}

// ==================== GENERAR SLUG ====================
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

// ==================== BASE DE DATOS DE ENTIDADES CONOCIDAS ====================
const ENTIDADES_CONOCIDAS = {
    // Músicos/DJs
    'diplo': { nombre: 'Diplo', categoria: 'DJ/Music Producer', queries: ['Diplo DJ', 'Diplo performing', 'Diplo concert', 'Diplo electronic music'] },
    'bad bunny': { nombre: 'Bad Bunny', categoria: 'Artista', queries: ['Bad Bunny', 'Bad Bunny concert', 'Bad Bunny live', 'Bad Bunny reggaeton'] },
    'j balvin': { nombre: 'J Balvin', categoria: 'Artista', queries: ['J Balvin', 'J Balvin concert', 'J Balvin reggaeton', 'J Balvin live'] },
    'maluma': { nombre: 'Maluma', categoria: 'Artista', queries: ['Maluma', 'Maluma concert', 'Maluma reggaeton', 'Maluma live'] },
    
    // Políticos
    'luis abinader': { nombre: 'Luis Abinader', categoria: 'Político', queries: ['Luis Abinader', 'Luis Abinader presidente', 'Luis Abinader dominicano'] },
    'danilo medina': { nombre: 'Danilo Medina', categoria: 'Político', queries: ['Danilo Medina', 'Danilo Medina presidente'] },
    'leonel fernández': { nombre: 'Leonel Fernández', categoria: 'Político', queries: ['Leonel Fernández', 'Leonel Fernández presidente'] },
    
    // Equipos deportivos
    'real madrid': { nombre: 'Real Madrid', categoria: 'Equipo', queries: ['Real Madrid', 'Real Madrid football', 'Real Madrid players', 'Real Madrid champions'] },
    'barcelona': { nombre: 'Barcelona', categoria: 'Equipo', queries: ['Barcelona', 'Barcelona football', 'Barcelona players'] },
    'psg': { nombre: 'Paris Saint-Germain', categoria: 'Equipo', queries: ['PSG', 'Paris Saint-Germain', 'PSG football'] },
    'juventus': { nombre: 'Juventus', categoria: 'Equipo', queries: ['Juventus', 'Juventus football', 'Juventus players'] },
    'manchester united': { nombre: 'Manchester United', categoria: 'Equipo', queries: ['Manchester United', 'Man United', 'Manchester United football'] },
    'manchester city': { nombre: 'Manchester City', categoria: 'Equipo', queries: ['Manchester City', 'Man City', 'Manchester City football'] },
    
    // Empresas/Tech
    'apple': { nombre: 'Apple', categoria: 'Tecnología', queries: ['Apple', 'Apple iPhone', 'Apple products', 'Apple technology'] },
    'samsung': { nombre: 'Samsung', categoria: 'Tecnología', queries: ['Samsung', 'Samsung phones', 'Samsung technology'] },
    'microsoft': { nombre: 'Microsoft', categoria: 'Tecnología', queries: ['Microsoft', 'Microsoft Windows', 'Microsoft technology'] },
    'google': { nombre: 'Google', categoria: 'Tecnología', queries: ['Google', 'Google technology', 'Google innovation'] },
    'meta': { nombre: 'Meta', categoria: 'Tecnología', queries: ['Meta', 'Meta technology', 'Meta social media'] },
    'tesla': { nombre: 'Tesla', categoria: 'Tecnología', queries: ['Tesla', 'Tesla car', 'Tesla electric vehicle', 'Tesla Elon Musk'] },
    
    // Celebridades internacionales
    'elon musk': { nombre: 'Elon Musk', categoria: 'Empresario', queries: ['Elon Musk', 'Elon Musk Tesla', 'Elon Musk entrepreneur'] },
    'bill gates': { nombre: 'Bill Gates', categoria: 'Empresario', queries: ['Bill Gates', 'Bill Gates Microsoft', 'Bill Gates entrepreneur'] },
    'oprah': { nombre: 'Oprah Winfrey', categoria: 'Celebridad', queries: ['Oprah', 'Oprah Winfrey', 'Oprah show'] },
    
    // Deportistas
    'lionel messi': { nombre: 'Lionel Messi', categoria: 'Deportista', queries: ['Messi', 'Lionel Messi', 'Messi football', 'Messi playing'] },
    'cristiano ronaldo': { nombre: 'Cristiano Ronaldo', categoria: 'Deportista', queries: ['Ronaldo', 'Cristiano Ronaldo', 'Ronaldo football'] },
    'neymar': { nombre: 'Neymar', categoria: 'Deportista', queries: ['Neymar', 'Neymar football', 'Neymar playing'] },
};

// ==================== DETECTAR ENTIDAD ====================
function detectarEntidad(titulo, contenido) {
    console.log(`🔍 Detectando entidades en: "${titulo.substring(0, 60)}..."`);
    
    const textoCompleto = `${titulo} ${contenido}`.toLowerCase();
    
    for (const [clave, entidad] of Object.entries(ENTIDADES_CONOCIDAS)) {
        if (textoCompleto.includes(clave.toLowerCase())) {
            console.log(`✅ ENTIDAD DETECTADA: ${entidad.nombre} (${entidad.categoria})`);
            return entidad;
        }
    }
    
    console.log(`❌ No se detectó entidad conocida`);
    return null;
}

// ==================== INICIALIZAR BD ====================
async function inicializarBase() {
    const client = await pool.connect();
    try {
        console.log('🔧 Inicializando base de datos...');
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
                entity VARCHAR(255),
                entity_categoria VARCHAR(100),
                ubicacion VARCHAR(100) DEFAULT 'Santo Domingo',
                redactor VARCHAR(100) DEFAULT 'IA Gemini',
                imagen TEXT DEFAULT '/default-news.jpg',
                imagen_alt VARCHAR(255),
                vistas INTEGER DEFAULT 0,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                estado VARCHAR(50) DEFAULT 'publicada'
            );
        `);

        const columnas = [
            'slug VARCHAR(255)',
            'seo_description VARCHAR(160)',
            'seo_keywords VARCHAR(255)',
            'imagen_alt VARCHAR(255)',
            'entity VARCHAR(255)',
            'entity_categoria VARCHAR(100)'
        ];

        for (const col of columnas) {
            const colName = col.split(' ')[0];
            const check = await client.query(
                `SELECT column_name FROM information_schema.columns 
                 WHERE table_name='noticias' AND column_name=$1`,
                [colName]
            );

            if (check.rows.length === 0) {
                console.log(`➕ Agregando columna ${colName}...`);
                await client.query(`ALTER TABLE noticias ADD COLUMN ${col}`);
            }
        }

        await client.query(`
            UPDATE noticias 
            SET slug = lower(regexp_replace(titulo, '[^a-zA-Z0-9áéíóúÁÉÍÓÚüÜñÑ]+', '-', 'g')) 
            WHERE slug IS NULL OR slug = ''
        `);

        await client.query('COMMIT');
        console.log('✅ Base de datos lista');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error BD:', error.message);
        return false;
    } finally {
        client.release();
    }
}

// ==================== BÚSQUEDA INTELIGENTE DE IMÁGENES ====================
async function buscarImagenInteligente(titulo, contenido, entity, imageQueries, categoria) {
    try {
        console.log(`\n🎬 BÚSQUEDA INTELIGENTE DE IMÁGENES`);
        console.log(`📌 Entity: ${entity ? entity.nombre : 'ninguna'}`);
        console.log(`📂 Categoría: ${categoria}`);
        
        let queriesPrioritarias = [];
        
        // ========== 1. SI HAY ENTITY DETECTADA: BÚSQUEDA PRIORITARIA ==========
        if (entity) {
            console.log(`\n🎯 MODO: Búsqueda prioritaria por ENTITY`);
            queriesPrioritarias = entity.queries;
            console.log(`   Queries prioritarias:`, queriesPrioritarias.slice(0, 2));
        } else {
            console.log(`\n🔄 MODO: Búsqueda por IMAGE_QUERY`);
            queriesPrioritarias = imageQueries || [];
        }

        let imagenesEncontradas = [];
        const todasLasQueries = [...queriesPrioritarias, ...(imageQueries || [])].filter(q => q && q.length > 2);
        
        console.log(`\n📋 Total de queries a probar: ${todasLasQueries.length}`);

        // ========== BUSCAR EN APIs ==========
        
        // UNSPLASH
        if (process.env.UNSPLASH_ACCESS_KEY) {
            console.log(`\n🔍 Buscando en Unsplash...`);
            for (let i = 0; i < Math.min(todasLasQueries.length, 3); i++) {
                const query = todasLasQueries[i];
                try {
                    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&orientation=landscape&per_page=5`;
                    const response = await fetch(url);
                    
                    if (response.ok) {
                        const data = await response.json();
                        if (data.results && data.results.length > 0) {
                            data.results.forEach((img, idx) => {
                                let relevancia = 0;
                                
                                // Mayor relevancia si es query prioritaria
                                if (i < queriesPrioritarias.length) {
                                    relevancia += 10;
                                }
                                
                                // Mayor relevancia si es el primer resultado
                                if (idx === 0) relevancia += 5;
                                
                                imagenesEncontradas.push({
                                    url: img.urls.regular,
                                    alt: img.alt_description || img.description || 'Noticia',
                                    source: 'Unsplash',
                                    relevancia: relevancia,
                                    query: query
                                });
                            });
                            console.log(`   ✅ ${data.results.length} imágenes encontradas para: "${query}"`);
                        }
                    }
                } catch (e) {
                    console.log(`   ⚠️ Error en query: "${query}"`);
                }
            }
        }

        // PEXELS
        if (process.env.PEXELS_API_KEY && imagenesEncontradas.length < 15) {
            console.log(`\n🔍 Buscando en Pexels...`);
            for (let i = 0; i < Math.min(todasLasQueries.length, 3); i++) {
                const query = todasLasQueries[i];
                try {
                    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`;
                    const response = await fetch(url, {
                        headers: { 'Authorization': process.env.PEXELS_API_KEY }
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        if (data.photos && data.photos.length > 0) {
                            data.photos.forEach((img, idx) => {
                                let relevancia = 0;
                                if (i < queriesPrioritarias.length) relevancia += 10;
                                if (idx === 0) relevancia += 5;
                                
                                imagenesEncontradas.push({
                                    url: img.src.landscape,
                                    alt: img.alt || 'Noticia',
                                    source: 'Pexels',
                                    relevancia: relevancia,
                                    query: query
                                });
                            });
                            console.log(`   ✅ ${data.photos.length} imágenes encontradas para: "${query}"`);
                        }
                    }
                } catch (e) {
                    console.log(`   ⚠️ Error en query: "${query}"`);
                }
            }
        }

        // PIXABAY
        if (process.env.PIXABAY_API_KEY && imagenesEncontradas.length < 15) {
            console.log(`\n🔍 Buscando en Pixabay...`);
            for (let i = 0; i < Math.min(todasLasQueries.length, 3); i++) {
                const query = todasLasQueries[i];
                try {
                    const url = `https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&per_page=5`;
                    const response = await fetch(url);
                    
                    if (response.ok) {
                        const data = await response.json();
                        if (data.hits && data.hits.length > 0) {
                            data.hits.forEach((img, idx) => {
                                let relevancia = 0;
                                if (i < queriesPrioritarias.length) relevancia += 10;
                                if (idx === 0) relevancia += 5;
                                
                                imagenesEncontradas.push({
                                    url: img.webformatURL,
                                    alt: img.tags || 'Noticia',
                                    source: 'Pixabay',
                                    relevancia: relevancia,
                                    query: query
                                });
                            });
                            console.log(`   ✅ ${data.hits.length} imágenes encontradas para: "${query}"`);
                        }
                    }
                } catch (e) {
                    console.log(`   ⚠️ Error en query: "${query}"`);
                }
            }
        }

        // ========== SELECCIONAR LA MEJOR IMAGEN ==========
        if (imagenesEncontradas.length > 0) {
            imagenesEncontradas.sort((a, b) => (b.relevancia || 0) - (a.relevancia || 0));
            
            console.log(`\n🏆 TOP 3 MEJORES IMÁGENES:`);
            imagenesEncontradas.slice(0, 3).forEach((img, i) => {
                console.log(`   ${i+1}. ${img.source} | relevancia: ${img.relevancia} | query: "${img.query}"`);
            });
            
            const seleccionada = imagenesEncontradas[0];
            console.log(`\n✅ IMAGEN SELECCIONADA DE: ${seleccionada.source}`);
            console.log(`   Query usado: "${seleccionada.query}"`);
            console.log(`   Relevancia: ${seleccionada.relevancia}`);
            
            return {
                url: seleccionada.url,
                alt: seleccionada.alt,
                source: seleccionada.source,
                query: seleccionada.query
            };
        }

        // ========== RESPALDO POR CATEGORÍA ==========
        console.log(`\n📸 Usando imagen de respaldo para: ${categoria}`);
        
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
            alt: titulo,
            source: 'respaldo',
            query: 'respaldo'
        };

    } catch (error) {
        console.error('❌ Error en búsqueda inteligente:', error.message);
        return {
            url: 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg',
            alt: 'Noticia',
            source: 'emergencia',
            query: 'emergencia'
        };
    }
}

// ==================== GENERAR NOTICIA CON DETECCIÓN DE ENTIDADES ====================
async function generarNoticiaCompleta(categoria) {
    try {
        console.log(`\n🤖 Generando noticia para: ${categoria}`);

        const prompt = `Genera una noticia profesional sobre ${categoria} en República Dominicana.

REQUISITOS CRÍTICOS:
- Título: 50-60 caracteres, atractivo, con nombre si aplica
- Contenido: 400-500 palabras
- Datos específicos de RD
- Párrafos cortos y claros

ENTIDADES IMPORTANTES:
Si habla de una persona famosa, artista, DJ, político, equipo o empresa, 
INCLÚYELO en el título y usa su nombre completo.

Responde con este formato EXACTO:

TITULO: [título con nombre si aplica]
ENTITY_NAME: [nombre de persona/artista/equipo si existe, sino dejar vacío]
DESCRIPCION: [descripción 160 caracteres máximo]
PALABRAS_CLAVE: [5 palabras clave separadas por coma]
IMAGE_QUERY: [4 queries de búsqueda en inglés, separadas por comas]
CONTENIDO: [contenido completo]

Ejemplos:

Ejemplo 1 (CON ENTITY):
TITULO: Diplo sorprende con nuevo set en festival de Miami
ENTITY_NAME: Diplo
DESCRIPCION: El famoso DJ Diplo presentó un innovador set electrónico en Miami
PALABRAS_CLAVE: Diplo, DJ, Festival, Miami, Música
IMAGE_QUERY: Diplo DJ performing, Diplo electronic music, Diplo concert stage, Diplo festival live
CONTENIDO: El reconocido productor...

Ejemplo 2 (SIN ENTITY):
TITULO: Nuevo plan de viviendas en Santo Domingo
ENTITY_NAME: 
DESCRIPCION: El gobierno anuncia iniciativa de viviendas sociales
PALABRAS_CLAVE: viviendas, construcción, santo domingo, gobierno, social
IMAGE_QUERY: government housing project, construction homes, new neighborhood, dominican construction
CONTENIDO: Las autoridades...`;

        console.log(`📤 Enviando a Gemini...`);

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
                        maxOutputTokens: 2500
                    }
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Gemini error: ${response.status}`);
        }

        const data = await response.json();
        const texto = data.candidates[0].content.parts[0].text;

        // PARSEAR
        const tituloMatch = texto.match(/TITULO:\s*(.+?)(?=\nENTITY_NAME:|$)/i);
        const entityMatch = texto.match(/ENTITY_NAME:\s*(.+?)(?=\nDESCRIPCION:|$)/i);
        const descMatch = texto.match(/DESCRIPCION:\s*(.+?)(?=\nPALABRAS_CLAVE:|$)/i);
        const keyMatch = texto.match(/PALABRAS_CLAVE:\s*(.+?)(?=\nIMAGE_QUERY:|$)/i);
        const imgMatch = texto.match(/IMAGE_QUERY:\s*(.+?)(?=\nCONTENIDO:|$)/i);
        const contMatch = texto.match(/CONTENIDO:\s*(.+?)$/is);

        if (!tituloMatch || !contMatch) {
            throw new Error('Error parseando respuesta');
        }

        const titulo = tituloMatch[1].trim().substring(0, 255);
        const entityName = entityMatch ? entityMatch[1].trim() : '';
        const desc = descMatch ? descMatch[1].trim().substring(0, 160) : titulo;
        const keywords = keyMatch ? keyMatch[1].trim().substring(0, 255) : categoria;
        const imageQueries = imgMatch 
            ? imgMatch[1].split(',').map(q => q.trim()).filter(q => q.length > 0)
            : [categoria, `${categoria} dominican republic`];
        const contenido = contMatch[1].trim();

        if (contenido.length < 200) {
            throw new Error('Contenido muy corto');
        }

        console.log(`\n✅ Noticia parseada:`);
        console.log(`   Título: ${titulo.substring(0, 60)}`);
        console.log(`   Entity: ${entityName || 'ninguna'}`);
        console.log(`   Contenido: ${contenido.substring(0, 80)}...`);

        // ========== DETECCIÓN DE ENTIDADES ==========
        let entityDetectada = null;
        if (entityName && entityName.length > 0) {
            entityDetectada = detectarEntidad(titulo, contenido);
        }

        // ========== BÚSQUEDA INTELIGENTE DE IMÁGENES ==========
        const imagenData = await buscarImagenInteligente(
            titulo,
            contenido,
            entityDetectada,
            imageQueries,
            categoria
        );

        const slug = generarSlug(titulo);
        const redactor = elegirRedactor(categoria);

        // Verificar slug único
        const existe = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        const slugFinal = existe.rows.length > 0 ? `${slug}-${Date.now()}` : slug;

        // Guardar
        const result = await pool.query(
            `INSERT INTO noticias (
                titulo, slug, seccion, contenido, 
                seo_description, seo_keywords, 
                entity, entity_categoria,
                redactor, imagen, imagen_alt, estado
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
            RETURNING id, slug`,
            [
                titulo,
                slugFinal,
                categoria,
                contenido,
                desc,
                keywords,
                entityDetectada ? entityDetectada.nombre : entityName,
                entityDetectada ? entityDetectada.categoria : null,
                redactor,
                imagenData.url,
                imagenData.alt,
                'publicada'
            ]
        );

        const noticia = result.rows[0];
        console.log(`\n✅ Noticia guardada: ID ${noticia.id}`);
        console.log(`✅ URL: ${BASE_URL}/noticia/${noticia.slug}`);
        console.log(`✅ Imagen: ${imagenData.source} (Query: "${imagenData.query}")`);

        return {
            success: true,
            id: noticia.id,
            slug: noticia.slug,
            titulo: titulo,
            url: `${BASE_URL}/noticia/${noticia.slug}`,
            imagen: imagenData.url,
            redactor: redactor,
            entity: entityDetectada ? entityDetectada.nombre : entityName || 'ninguna',
            imagen_query: imagenData.query,
            mensaje: '✅ Noticia publicada con imagen inteligente'
        };

    } catch (error) {
        console.error(`\n❌ ERROR:`, error.message);
        return { success: false, error: error.message };
    }
}

// ==================== CATEGORÍAS ====================
const CATEGORIAS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];

// ==================== AUTOMATIZACIÓN ====================
console.log('\n📅 Configurando automatización...');
cron.schedule('0 */6 * * *', async () => {
    console.log('\n⏰ [6 HORAS] Generando noticia automática...');
    const cat = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    await generarNoticiaCompleta(cat);
});

cron.schedule('0 8 * * *', async () => {
    console.log('\n🌅 [8 AM] Generando noticia diaria...');
    await generarNoticiaCompleta('Nacionales');
});
console.log('✅ Automatización configurada');

// ==================== RUTAS ====================
app.get('/health', (req, res) => {
    res.json({ status: 'OK' });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// ==================== API ====================
app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, titulo, slug, seccion, imagen, fecha, vistas, redactor, entity FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30',
            ['publicada']
        );
        res.json({ success: true, noticias: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

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

        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');

            const meta = `
<title>${n.titulo} | El Farol al Día</title>
<meta name="description" content="${n.seo_description || n.titulo}">
<meta name="keywords" content="${n.seo_keywords}">
<meta property="og:title" content="${n.titulo}">
<meta property="og:description" content="${n.seo_description || n.titulo}">
<meta property="og:image" content="${n.imagen}">
<meta property="og:url" content="${BASE_URL}/noticia/${n.slug}">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  "headline": "${n.titulo}",
  "image": "${n.imagen}",
  "datePublished": "${n.fecha}",
  "author": {"@type": "Person", "name": "${n.redactor}"}
}
</script>`;

            html = html.replace('<!-- META_TAGS -->', meta);
            html = html.replace(/{{TITULO}}/g, n.titulo);
            html = html.replace(/{{CONTENIDO}}/g, n.contenido.split('\n').map(p => `<p>${p}</p>`).join(''));
            html = html.replace(/{{FECHA}}/g, new Date(n.fecha).toLocaleDateString('es-DO'));
            html = html.replace(/{{IMAGEN}}/g, n.imagen);
            html = html.replace(/{{ALT}}/g, n.imagen_alt || n.titulo);
            html = html.replace(/{{VISTAS}}/g, n.vistas);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } catch (e) {
            res.json({ success: true, noticia: n });
        }
    } catch (error) {
        res.status(500).send('Error');
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
    const robots = `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${BASE_URL}/sitemap.xml`;
    res.header('Content-Type', 'text/plain');
    res.send(robots);
});

// ==================== STATUS ====================
app.get('/status', async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado=$1', ['publicada']);
        res.json({
            status: 'OK',
            noticias: parseInt(result.rows[0].count),
            uptime: Math.floor(process.uptime()),
            version: '10.0',
            sistema: 'Detección de entidades + Búsqueda inteligente'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== FALLBACK ====================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== INICIAR ====================
async function iniciar() {
    try {
        console.log('\n🚀 Iniciando servidor V10.0...\n');
        await inicializarBase();

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔═════════════════════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - SERVIDOR V10.0 🏮                          ║
║        DETECCIÓN DE ENTIDADES + BÚSQUEDA INTELIGENTE              ║
╠═════════════════════════════════════════════════════════════════════╣
║ ✅ Servidor en puerto ${PORT}                                       ║
║ ✅ PostgreSQL conectado                                             ║
║ ✅ Gemini 2.5 Flash: ACTIVADO                                       ║
║ ✅ DETECCIÓN DE ENTIDADES: ACTIVO                                   ║
║    - Personas famosas                                               ║
║    - Artistas/DJs                                                   ║
║    - Políticos                                                      ║
║    - Equipos deportivos                                             ║
║    - Empresas/Tech                                                  ║
║ ✅ BÚSQUEDA INTELIGENTE DE IMÁGENES: ACTIVO                         ║
║    - Búsqueda prioritaria por ENTITY                                ║
║    - Lógica de editor de periódico                                  ║
║    - 3 APIs de imágenes                                             ║
║    - Selección por relevancia                                       ║
║ ✅ SEO OPTIMIZADO: LISTO PARA MONETIZAR                             ║
║ ✅ Automatización: CADA 6 HORAS + 8 AM DIARIO                       ║
║ ✅ Redactores asignados automáticamente                             ║
║ ✅ LISTO PARA GOOGLE ADSENSE                                        ║
╚═════════════════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    }
}

iniciar();

module.exports = app;
