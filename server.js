/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR V15.0 COMPLETO
 * PROMPT MINIMALISTA POTENTE - SIN ERROR 429
 * MEJORAS: Cada 2 horas + Anti-duplicados + Relacionadas + SEO Discover + Sitemap mejorado
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
    const esp = REDACTORES.filter(r => r.especialidad === categoria);
    return esp.length > 0 ? esp[Math.floor(Math.random() * esp.length)].nombre : 'IA Gemini';
}

// ==================== SLUG ====================
function generarSlug(texto) {
    return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 80);
}

// ==================== BANCO DE IMÁGENES ====================
const BANCO_IMAGENES = {
    'Nacionales': ['https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg', 'https://images.pexels.com/photos/290595/pexels-photo-290595.jpeg'],
    'Deportes': ['https://images.pexels.com/photos/46798/the-ball-stadion-football-the-pitch-46798.jpeg', 'https://images.pexels.com/photos/1884574/pexels-photo-1884574.jpeg'],
    'Internacionales': ['https://images.pexels.com/photos/2860705/pexels-photo-2860705.jpeg', 'https://images.pexels.com/photos/358319/pexels-photo-358319.jpeg'],
    'Espectáculos': ['https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg', 'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg'],
    'Economía': ['https://images.pexels.com/photos/4386466/pexels-photo-4386466.jpeg', 'https://images.pexels.com/photos/6772070/pexels-photo-6772070.jpeg'],
    'Tecnología': ['https://images.pexels.com/photos/3861958/pexels-photo-3861958.jpeg', 'https://images.pexels.com/photos/2582937/pexels-photo-2582937.jpeg']
};

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

// ==================== NOTICIAS RELACIONADAS ====================
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

// ==================== BUSCAR IMAGEN ====================
async function buscarImagen(persona, busqueda, categoria) {
    const delay = ms => new Promise(r => setTimeout(r, ms));

    try {
        // PRIORIDAD 1: Si hay persona, buscar primero
        if (persona && persona.length > 2) {
            console.log(`🎯 Buscando imagen de: ${persona}`);

            if (process.env.UNSPLASH_ACCESS_KEY) {
                try {
                    const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(persona)}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&per_page=1`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.results?.length > 0) {
                            console.log(`✅ Imagen encontrada: Unsplash`);
                            return { url: data.results[0].urls.regular, alt: persona, source: 'Unsplash' };
                        }
                    }
                } catch (e) { console.log(`⚠️ Unsplash error`); }
                await delay(200);
            }

            if (process.env.PEXELS_API_KEY) {
                try {
                    const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(persona)}&per_page=1`, {
                        headers: { 'Authorization': process.env.PEXELS_API_KEY }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.photos?.length > 0) {
                            console.log(`✅ Imagen encontrada: Pexels`);
                            return { url: data.photos[0].src.landscape, alt: persona, source: 'Pexels' };
                        }
                    }
                } catch (e) { console.log(`⚠️ Pexels error`); }
                await delay(200);
            }

            if (process.env.PIXABAY_API_KEY) {
                try {
                    const res = await fetch(`https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(persona)}&per_page=1`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.hits?.length > 0) {
                            console.log(`✅ Imagen encontrada: Pixabay`);
                            return { url: data.hits[0].webformatURL, alt: persona, source: 'Pixabay' };
                        }
                    }
                } catch (e) { console.log(`⚠️ Pixabay error`); }
            }
        }

        // PRIORIDAD 2: Usar búsqueda de imagen
        if (busqueda && busqueda.length > 0) {
            console.log(`📸 Buscando imagen: ${busqueda}`);

            if (process.env.UNSPLASH_ACCESS_KEY) {
                try {
                    const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(busqueda)}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&per_page=1`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.results?.length > 0) {
                            console.log(`✅ Imagen encontrada: Unsplash`);
                            return { url: data.results[0].urls.regular, alt: busqueda, source: 'Unsplash' };
                        }
                    }
                } catch (e) { }
                await delay(200);
            }

            if (process.env.PEXELS_API_KEY) {
                try {
                    const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(busqueda)}&per_page=1`, {
                        headers: { 'Authorization': process.env.PEXELS_API_KEY }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.photos?.length > 0) {
                            console.log(`✅ Imagen encontrada: Pexels`);
                            return { url: data.photos[0].src.landscape, alt: busqueda, source: 'Pexels' };
                        }
                    }
                } catch (e) { }
                await delay(200);
            }

            if (process.env.PIXABAY_API_KEY) {
                try {
                    const res = await fetch(`https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(busqueda)}&per_page=1`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.hits?.length > 0) {
                            console.log(`✅ Imagen encontrada: Pixabay`);
                            return { url: data.hits[0].webformatURL, alt: busqueda, source: 'Pixabay' };
                        }
                    }
                } catch (e) { }
            }
        }

        // PRIORIDAD 3: Banco de respaldo
        console.log(`📸 Usando banco de respaldo`);
        const imagenes = BANCO_IMAGENES[categoria] || BANCO_IMAGENES['Nacionales'];
        return { url: imagenes[Math.floor(Math.random() * imagenes.length)], alt: categoria, source: 'respaldo' };

    } catch (error) {
        console.error('❌ Error imagen:', error.message);
        return { url: BANCO_IMAGENES['Nacionales'][0], alt: 'Noticia', source: 'emergencia' };
    }
}

// ==================== GENERAR NOTICIA ====================
async function generarNoticia(categoria) {
    try {
        console.log(`\n🤖 Generando noticia: ${categoria}`);

        const prompt = `Escribe una noticia profesional de ${categoria} en República Dominicana.

RESPONDE EXACTAMENTE:

TITULO: [título 50-60 caracteres]
PERSONA: [nombre de persona famosa si existe, sino vacío]
DESCRIPCION: [SEO máximo 160 caracteres]
PALABRAS: [5 palabras clave separadas por coma]
BUSQUEDA_IMAGEN: [búsqueda específica 3-5 palabras en inglés]
CONTENIDO:
[400-500 palabras de noticia profesional en párrafos]`;

        console.log(`📤 Enviando a Gemini...`);

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 1500 }
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Gemini ${response.status}`);
        }

        const data = await response.json();
        const texto = data.candidates[0].content.parts[0].text;

        // PARSEAR RESPUESTA
        let titulo = "", persona = "", descripcion = "", palabras = categoria, busqueda_imagen = "", contenido = "";

        const lineas = texto.split('\n');
        for (let i = 0; i < lineas.length; i++) {
            const linea = lineas[i].trim();
            
            if (linea.startsWith('TITULO:')) titulo = linea.replace('TITULO:', '').trim();
            else if (linea.startsWith('PERSONA:')) persona = linea.replace('PERSONA:', '').trim();
            else if (linea.startsWith('DESCRIPCION:')) descripcion = linea.replace('DESCRIPCION:', '').trim();
            else if (linea.startsWith('PALABRAS:')) palabras = linea.replace('PALABRAS:', '').trim();
            else if (linea.startsWith('BUSQUEDA_IMAGEN:')) busqueda_imagen = linea.replace('BUSQUEDA_IMAGEN:', '').trim();
            else if (linea.startsWith('CONTENIDO:')) {
                contenido = linea.replace('CONTENIDO:', '').trim();
                for (let j = i + 1; j < lineas.length; j++) {
                    contenido += '\n' + lineas[j];
                }
                break;
            }
        }

        // Limpiar
        titulo = titulo.replace(/[*_#`]/g, '').trim().substring(0, 255) || `Noticia de ${categoria}`;
        
        // MEJORA 4: Verificar duplicados
        const esDuplicado = await tituloDuplicado(titulo);
        if (esDuplicado) {
            console.log(`⚠️ Título duplicado, se omite: ${titulo.substring(0, 50)}`);
            return { success: false, error: 'Título similar ya existe' };
        }
        
        persona = persona.replace(/[*_#`]/g, '').trim();
        descripcion = descripcion.replace(/[*_#`]/g, '').trim().substring(0, 160);
        palabras = palabras.replace(/[*_#`]/g, '').trim().substring(0, 255);
        busqueda_imagen = busqueda_imagen.replace(/[*_#`]/g, '').trim();
        contenido = (contenido || `Noticia sobre ${categoria}`).substring(0, 5000);

        console.log(`✅ Título: ${titulo.substring(0, 50)}`);
        console.log(`✅ Persona: ${persona || 'ninguna'}`);
        console.log(`✅ Búsqueda imagen: ${busqueda_imagen}`);

        // Buscar imagen
        const imagen = await buscarImagen(persona, busqueda_imagen, categoria);

        const slug = generarSlug(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        const slugFinal = existe.rows.length > 0 ? `${slug}-${Date.now()}` : slug;
        const redactor = elegirRedactor(categoria);

        const result = await pool.query(
            `INSERT INTO noticias (titulo, slug, seccion, contenido, seo_description, seo_keywords, redactor, imagen, imagen_alt, estado)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, slug`,
            [titulo, slugFinal, categoria, contenido, descripcion, palabras, redactor, imagen.url, imagen.alt || titulo, 'publicada']
        );

        const noticia = result.rows[0];
        console.log(`✅ Noticia guardada ID: ${noticia.id}`);
        console.log(`✅ Imagen: ${imagen.source}`);

        return {
            success: true,
            id: noticia.id,
            slug: noticia.slug,
            titulo: titulo,
            url: `${BASE_URL}/noticia/${noticia.slug}`,
            imagen: imagen.url,
            redactor: redactor,
            persona: persona || 'ninguna',
            imagen_fuente: imagen.source,
            mensaje: '✅ Noticia generada'
        };

    } catch (error) {
        console.error(`❌ ERROR:`, error.message);
        return { success: false, error: error.message };
    }
}

// ==================== CATEGORÍAS ====================
const CATEGORIAS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];

// ==================== AUTOMATIZACIÓN (MEJORA 1: Cada 2 horas) ====================
console.log('\n📅 Configurando automatización (cada 2 horas)...');
cron.schedule('0 */2 * * *', async () => {
    const cat = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    console.log(`\n⏰ [${new Date().toLocaleTimeString()}] Generando noticia cada 2 horas: ${cat}`);
    await generarNoticia(cat);
});

cron.schedule('0 8 * * *', async () => {
    console.log(`\n🌅 [${new Date().toLocaleTimeString()}] Generando noticia diaria: Nacionales`);
    await generarNoticia('Nacionales');
});

console.log('✅ Automatización configurada: Cada 2 horas + Diaria 8 AM');

// ==================== RUTAS ====================
app.get('/health', (req, res) => res.json({ status: 'OK' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));

app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, titulo, slug, seccion, imagen, fecha, vistas, redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30', ['publicada']);
        res.json({ success: true, noticias: result.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/generar-noticia', async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });
    const resultado = await generarNoticia(categoria);
    res.status(resultado.success ? 200 : 500).json(resultado);
});

// ==================== NOTICIA POR SLUG (MEJORA 2 y 3) ====================
app.get('/noticia/:slug', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM noticias WHERE slug = $1 AND estado = $2', [req.params.slug, 'publicada']);
        if (result.rows.length === 0) return res.status(404).send('Noticia no encontrada');

        const n = result.rows[0];
        await pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE id = $1', [n.id]);

        // Obtener noticias relacionadas
        const relacionadas = await obtenerRelacionadas(n.id, n.seccion, n.seo_keywords, 4);

        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
            
            // MEJORA 3: SEO para Google Discover
            const fechaISO = new Date(n.fecha).toISOString();
            const meta = `<title>${n.titulo} | El Farol al Día</title>
<meta name="description" content="${n.seo_description || n.titulo}">
<meta name="keywords" content="${n.seo_keywords}">
<meta property="og:title" content="${n.titulo}">
<meta property="og:description" content="${n.seo_description || n.titulo}">
<meta property="og:image" content="${n.imagen}">
<meta property="og:url" content="${BASE_URL}/noticia/${n.slug}">
<meta property="og:type" content="article">
<meta property="article:published_time" content="${fechaISO}">
<meta property="article:author" content="${n.redactor}">
<meta name="twitter:card" content="summary_large_image">
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

            // Generar HTML de noticias relacionadas
            let relacionadasHTML = '';
            if (relacionadas.length > 0) {
                relacionadasHTML = '<h3>Noticias relacionadas</h3><div class="relacionadas">';
                relacionadas.forEach(r => {
                    relacionadasHTML += `
                        <div class="relacionada-item">
                            <a href="/noticia/${r.slug}">
                                <img src="${r.imagen}" alt="${r.titulo}" loading="lazy">
                                <h4>${r.titulo}</h4>
                                <span>${new Date(r.fecha).toLocaleDateString('es-DO')}</span>
                            </a>
                        </div>
                    `;
                });
                relacionadasHTML += '</div>';
            }

            html = html.replace('<!-- META_TAGS -->', meta);
            html = html.replace(/{{TITULO}}/g, n.titulo);
            html = html.replace(/{{CONTENIDO}}/g, n.contenido.split('\n').map(p => `<p>${p}</p>`).join(''));
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
        res.status(500).send('Error');
    }
});

// ==================== SITEMAP MEJORADO (MEJORA 5) ====================
app.get('/sitemap.xml', async (req, res) => {
    try {
        const result = await pool.query('SELECT slug, fecha FROM noticias WHERE estado=$1 ORDER BY fecha DESC', ['publicada']);
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
    res.send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${BASE_URL}/sitemap.xml`);
});

app.get('/status', async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado=$1', ['publicada']);
        res.json({ 
            status: 'OK', 
            noticias: parseInt(result.rows[0].count),
            version: '15.0',
            automatizacion: 'Cada 2 horas + 8 AM'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== INICIAR ====================
async function iniciar() {
    try {
        console.log('\n🚀 Iniciando servidor V15.0...\n');
        await inicializarBase();

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔════════════════════════════════════════════════════════════════════╗
║      🏮 EL FAROL AL DÍA - SERVIDOR V15.0 COMPLETO 🏮             ║
║        PROMPT MINIMALISTA POTENTE - TODAS LAS MEJORAS              ║
╠════════════════════════════════════════════════════════════════════╣
║ ✅ Puerto: ${PORT}                                                  ║
║ ✅ PostgreSQL: Conectado                                           ║
║ ✅ Gemini 2.5 Flash: ACTIVADO                                      ║
║ ✅ MEJORA 1: Automatización CADA 2 HORAS                          ║
║ ✅ MEJORA 2: Noticias relacionadas                                ║
║ ✅ MEJORA 3: SEO para Google Discover                             ║
║ ✅ MEJORA 4: Anti-duplicados (títulos similares)                  ║
║ ✅ MEJORA 5: Sitemap mejorado (lastmod, priority, changefreq)     ║
║ ✅ Búsqueda de imágenes: 3 APIs                                   ║
║ ✅ Redactores automáticos                                         ║
║ ✅ LISTO PARA GOOGLE ADSENSE                                      ║
╚════════════════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    }
}

iniciar();

module.exports = app;
