/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR PRINCIPAL
 * Periódico Digital Dominicano con IA
 * 
 * Stack: Node.js + Express + Supabase + Google AdSense
 * Versión: 3.0.0 (con Panel de Redacción)
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/static', express.static(path.join(__dirname, 'static')));

// ============================================================
// SUPABASE CLIENT (con manejo de errores)
// ============================================================
let supabase = null;
try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
        console.warn('⚠️ SUPABASE_URL o SUPABASE_KEY no configurados');
        console.warn('   Funcionando en modo OFFLINE (sin Supabase)');
    } else {
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
        console.log('✅ Supabase conectado correctamente');
    }
} catch (err) {
    console.warn('⚠️ Error al conectar con Supabase:', err.message);
}

// ============================================================
// ARCHIVO ads.txt (CRÍTICO - NO MODIFICAR)
// ============================================================
app.get('/ads.txt', (req, res) => {
    res.type('text/plain');
    res.send('google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0');
});

// ============================================================
// FUNCIONES DE SUPABASE (del archivo supabase-integration.js)
// ============================================================

/**
 * Reglas por defecto (si Supabase no responde)
 */
function obtenerReglasDefault() {
    return {
        instruccion_principal: 'Eres un periodista profesional dominicano. Escribe noticias verificadas y equilibradas con impacto real para República Dominicana.',
        tono: 'profesional',
        extension: 'media',
        enfasis: 'Noticias locales de Santo Domingo Este e impacto en RD',
        evitar: 'Especulación sin fuentes, titulares sensacionalistas',
        palabras_clave: ['república dominicana', 'santo domingo este', 'último minuto'],
        enfoque_geografico: 'rd',
        ultima_actualizacion: null
    };
}

/**
 * Consulta Supabase tabla 'reglas_mxl' para obtener instrucciones
 */
async function leerReglasUsuario(usuarioId = 'director') {
    if (!supabase) {
        console.log('📝 Supabase offline → usando reglas por defecto');
        return obtenerReglasDefault();
    }

    try {
        const ctrl = new AbortController();
        const tm = setTimeout(() => ctrl.abort(), 5000);

        const { data, error } = await supabase
            .from('reglas_mxl')
            .select('*')
            .eq('usuario_id', usuarioId)
            .single();

        clearTimeout(tm);

        if (error) {
            console.warn(`⚠️ Error Supabase (reglas): ${error.message}`);
            return obtenerReglasDefault();
        }

        if (!data) {
            console.log('📝 Sin reglas personalizadas en Supabase → usando defaults');
            return obtenerReglasDefault();
        }

        console.log('✅ Reglas cargadas de Supabase');
        return {
            instruccion_principal: data.instruccion_principal || '',
            tono: data.tono || 'profesional',
            extension: data.extension || 'media',
            enfasis: data.enfasis || '',
            evitar: data.evitar || '',
            palabras_clave: data.palabras_clave ? data.palabras_clave.split(',') : [],
            enfoque_geografico: data.enfoque_geografico || 'rd',
            ultima_actualizacion: data.updated_at
        };

    } catch (err) {
        console.warn(`⚠️ Supabase timeout/error: ${err.message}`);
        return obtenerReglasDefault();
    }
}

/**
 * Guarda en tabla 'memoria_ia' después de publicar
 */
async function guardarMemoriaPublicacion(noticia, feedback = null) {
    if (!supabase) {
        console.log('📚 Supabase offline → memoria no guardada');
        return false;
    }

    try {
        const { error } = await supabase
            .from('memoria_ia')
            .insert([{
                titulo: noticia.titulo.substring(0, 255),
                contenido: noticia.contenido.substring(0, 500),
                categoria: noticia.seccion,
                feedback: feedback || null,
                url_publicada: `/noticia/${noticia.slug}`,
                timestamp: new Date().toISOString(),
                usuario_id: 'director',
                exitosa: true
            }]);

        if (error) {
            console.warn(`⚠️ Error guardando memoria: ${error.message}`);
            return false;
        }

        console.log('✅ Memoria guardada en Supabase');
        return true;

    } catch (err) {
        console.warn(`⚠️ Error guardando memoria: ${err.message}`);
        return false;
    }
}

/**
 * Guarda errores en tabla 'memoria_ia'
 */
async function registrarErrorPublicacion(categoria, titulo, razon) {
    if (!supabase) return false;

    try {
        const { error } = await supabase
            .from('memoria_ia')
            .insert([{
                titulo: titulo ? titulo.substring(0, 255) : 'SIN TÍTULO',
                contenido: `Error: ${razon}`,
                categoria,
                feedback: null,
                timestamp: new Date().toISOString(),
                usuario_id: 'director',
                exitosa: false
            }]);

        if (error) return false;
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Actualizar reglas en Supabase
 */
async function actualizarReglasSupabase(nuevasReglas, usuarioId = 'director') {
    if (!supabase) return false;

    try {
        const { data: dataBuscar } = await supabase
            .from('reglas_mxl')
            .select('id')
            .eq('usuario_id', usuarioId)
            .single();

        if (dataBuscar?.id) {
            const { error } = await supabase
                .from('reglas_mxl')
                .update({
                    ...nuevasReglas,
                    updated_at: new Date().toISOString()
                })
                .eq('id', dataBuscar.id);

            if (error) throw error;
            console.log('✅ Reglas actualizadas en Supabase');
            return true;
        } else {
            const { error } = await supabase
                .from('reglas_mxl')
                .insert([{
                    usuario_id: usuarioId,
                    ...nuevasReglas,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }]);

            if (error) throw error;
            console.log('✅ Nuevas reglas guardadas en Supabase');
            return true;
        }
    } catch (err) {
        console.warn(`⚠️ Error actualizando reglas: ${err.message}`);
        return false;
    }
}

/**
 * Obtener estadísticas de publicaciones
 */
async function obtenerEstadisticasMemoria(usuarioId = 'director', dias = 7) {
    if (!supabase) return null;

    try {
        const fechaLimite = new Date();
        fechaLimite.setDate(fechaLimite.getDate() - dias);

        const { data, error } = await supabase
            .from('memoria_ia')
            .select('*')
            .eq('usuario_id', usuarioId)
            .gte('timestamp', fechaLimite.toISOString())
            .order('timestamp', { ascending: false });

        if (error) return null;

        const exitosas = data.filter(x => x.exitosa).length;
        const errores = data.filter(x => !x.exitosa).length;
        const porCategoria = {};

        data.forEach(x => {
            if (!porCategoria[x.categoria]) {
                porCategoria[x.categoria] = { total: 0, exitosas: 0, errores: 0 };
            }
            porCategoria[x.categoria].total++;
            if (x.exitosa) porCategoria[x.categoria].exitosas++;
            else porCategoria[x.categoria].errores++;
        });

        return {
            periodo: `${dias} días`,
            total: data.length,
            exitosas,
            errores,
            tasa_exito: data.length ? Math.round((exitosas / data.length) * 100) : 0,
            por_categoria: porCategoria,
            ultimas: data.slice(0, 10)
        };

    } catch (err) {
        console.warn(`⚠️ Error obteniendo estadísticas: ${err.message}`);
        return null;
    }
}

// ============================================================
// FUNCIONES DE GENERACIÓN DE NOTICIAS
// ============================================================

// Caché en memoria (válido por 60 segundos)
let noticiasCache = {
    data: [],
    timestamp: 0
};
const CACHE_DURACION = 60000; // 60 segundos

// Fuentes de imágenes de respaldo
const FALLBACK_IMAGES = [
    'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg?auto=compress&w=800',
    'https://images.pexels.com/photos/518543/pexels-photo-518543.jpeg?auto=compress&w=800',
    'https://images.pexels.com/photos/3861958/pexels-photo-3861958.jpeg?auto=compress&w=800'
];

/**
 * Obtener imagen aleatoria para una categoría
 */
function obtenerImagenCategoria(categoria) {
    const imagenes = {
        Nacionales: 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg?auto=compress&w=800',
        Deportes: 'https://images.pexels.com/photos/46798/the-ball-stadion-football-the-pitch-46798.jpeg?auto=compress&w=800',
        Internacionales: 'https://images.pexels.com/photos/460672/pexels-photo-460672.jpeg?auto=compress&w=800',
        Economía: 'https://images.pexels.com/photos/4386339/pexels-photo-4386339.jpeg?auto=compress&w=800',
        Tecnología: 'https://images.pexels.com/photos/3861958/pexels-photo-3861958.jpeg?auto=compress&w=800',
        Espectáculos: 'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&w=800'
    };
    return imagenes[categoria] || FALLBACK_IMAGES[Math.floor(Math.random() * FALLBACK_IMAGES.length)];
}

/**
 * Generar una noticia aleatoria (simulación)
 */
function generarNoticia(categoria) {
    const titulos = {
        Nacionales: [
            'Presidente Abinader anuncia nuevo plan de viviendas en Santo Domingo Este',
            'Congreso aprueba ley de modernización fiscal con enfoque en pymes',
            'Turismo en RD bate récord con más de 8 millones de visitantes',
            'MINERD lanza programa de alfabetización digital en escuelas públicas'
        ],
        Deportes: [
            'Selección Dominicana de Béisbol se prepara para el Clásico Mundial',
            'Al Horford lidera a Celtics en victoria histórica en la NBA',
            'LIDOM anuncia cambios en el calendario para la próxima temporada',
            'Atletas dominicanos brillan en Juegos Panamericanos'
        ],
        Internacionales: [
            'ONU destaca avances de RD en reducción de pobreza',
            'Crisis migratoria en Haití: República Dominicana refuerza frontera',
            'Latinoamérica busca integración económica en cumbre de Cancún',
            'EE.UU. y RD firman acuerdo de cooperación tecnológica'
        ],
        Economía: [
            'Banco Central mantiene tasa de interés estable en 7%',
            'Remesas hacia RD alcanzan los USD 8,500 millones en 2025',
            'Inflación se modera y cierra en 4.2% en febrero',
            'Zonas francas generan más de 200,000 empleos directos'
        ],
        Tecnología: [
            'Startups dominicanas reciben inversión por USD 50 millones',
            'Santo Domingo será sede del Congreso Latinoamericano de IA',
            'Gobierno liza app para trámites ciudadanos con firma digital',
            '5G llega a 15 provincias de República Dominicana'
        ],
        Espectáculos: [
            'Juan Luis Guerra anuncia gira mundial "Entre Mar y Palmeras"',
            'Premios Soberano 2026: lista completa de nominados',
            'Natti Natasha estrena video grabado en Samaná',
            'Cine dominicano: "La Familia" rompe taquilla local'
        ]
    };

    const idx = Math.floor(Math.random() * titulos[categoria].length);
    const titulo = titulos[categoria][idx];
    
    return {
        id: Date.now() + Math.random(),
        titulo: titulo,
        slug: titulo.toLowerCase()
            .replace(/[^\w\s]/gi, '')
            .replace(/\s+/g, '-')
            .substring(0, 80),
        contenido: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. ${titulo}. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.`,
        seccion: categoria,
        imagen: obtenerImagenCategoria(categoria),
        imagen_alt: `Imagen ilustrativa de ${categoria} - El Farol al Día`,
        fecha: new Date().toISOString(),
        vistas: Math.floor(Math.random() * 5000) + 500,
        seo_description: `Lee las últimas noticias de ${categoria} en República Dominicana. Información verificada y actualizada 24/7 desde Santo Domingo.`
    };
}

/**
 * Endpoint principal de noticias (con caché)
 */
app.get('/api/noticias', async (req, res) => {
    try {
        const ahora = Date.now();
        
        // Verificar caché
        if (noticiasCache.data.length > 0 && (ahora - noticiasCache.timestamp) < CACHE_DURACION) {
            return res.json({
                success: true,
                noticias: noticiasCache.data,
                cache: true,
                timestamp: new Date().toISOString()
            });
        }

        // Cargar reglas desde Supabase
        const reglas = await leerReglasUsuario();
        
        // Generar noticias (simulación - aquí iría la integración real con IA)
        const noticias = [];
        const categorias = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];
        
        for (const cat of categorias) {
            // Generar 2-3 noticias por categoría
            const cantidad = Math.floor(Math.random() * 2) + 2;
            for (let i = 0; i < cantidad; i++) {
                noticias.push(generarNoticia(cat));
            }
        }
        
        // Ordenar por fecha (más recientes primero)
        noticias.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        
        // Actualizar caché
        noticiasCache = {
            data: noticias,
            timestamp: ahora
        };

        res.json({
            success: true,
            noticias,
            cache: false,
            reglas_usadas: reglas.instruccion_principal.substring(0, 100) + '...',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error en /api/noticias:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

/**
 * Endpoint para una noticia específica
 */
app.get('/api/noticias/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        
        // Buscar en caché
        const noticia = noticiasCache.data.find(n => n.slug === slug);
        
        if (!noticia) {
            return res.status(404).json({
                success: false,
                error: 'Noticia no encontrada'
            });
        }

        // Registrar visita en memoria
        noticia.vistas += 1;

        res.json({
            success: true,
            noticia,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error en /api/noticias/:slug:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// ============================================================
// PÁGINAS LEGALES (NO MODIFICAR)
// ============================================================

app.get('/privacidad', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Política de Privacidad - El Farol al Día</title>
        <meta name="robots" content="index, follow">
        <link rel="canonical" href="https://elfarolaldia.com/privacidad">
        <style>body{font-family:Arial;max-width:800px;margin:40px auto;padding:20px;line-height:1.6}</style>
        </head>
        <body>
            <h1>Política de Privacidad</h1>
            <p>Última actualización: 19 de marzo de 2026</p>
            <p>En El Farol al Día, accesible desde https://elfarolaldia.com, una de nuestras prioridades es la privacidad de nuestros visitantes. Este documento de Política de Privacidad contiene los tipos de información que recopila y registra El Farol al Día y cómo la usamos.</p>
            <h2>Archivos de registro</h2>
            <p>El Farol al Día sigue un procedimiento estándar de uso de archivos de registro. Estos archivos registran a los visitantes cuando visitan sitios web. Todos las empresas de hosting hacen esto y es una parte del análisis de los servicios de hosting. La información recopilada por los archivos de registro incluye direcciones de protocolo de Internet (IP), tipo de navegador, proveedor de servicios de Internet (ISP), fecha y hora, páginas de referencia / salida y posiblemente el número de clics. Estos no están vinculados a ninguna información que sea personalmente identificable. El propósito de la información es analizar tendencias, administrar el sitio, rastrear el movimiento de los usuarios en el sitio web y recopilar información demográfica.</p>
            <h2>Cookies y balizas web</h2>
            <p>Como cualquier otro sitio web, El Farol al Día utiliza "cookies". Estas cookies se utilizan para almacenar información, incluidas las preferencias de los visitantes y las páginas del sitio web a las que el visitante accedió o visitó. La información se utiliza para optimizar la experiencia de los usuarios al personalizar el contenido de nuestra página web según el tipo de navegador de los visitantes u otra información.</p>
            <p>Para obtener más información general sobre las cookies, consulte el artículo sobre Cookies de Wikipedia.</p>
            <h2>Políticas de privacidad de socios publicitarios</h2>
            <p>Puede consultar esta lista para encontrar la Política de privacidad de cada uno de los socios publicitarios de El Farol al Día.</p>
            <p>Nuestro sitio utiliza Google AdSense, uno de los anunciantes de nuestro sitio. Puede consultar la Política de privacidad de Google en: https://policies.google.com/technologies/ads</p>
            <h2>Derechos de privacidad</h2>
            <p>Usted tiene derecho a acceder, corregir, eliminar sus datos personales. Para ejercer estos derechos, contáctenos a privacidad@elfarolaldia.com</p>
            <p><a href="/">Volver al inicio</a></p>
        </body>
        </html>
    `);
});

app.get('/terminos', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Términos y Condiciones - El Farol al Día</title>
        <meta name="robots" content="index, follow">
        <link rel="canonical" href="https://elfarolaldia.com/terminos">
        <style>body{font-family:Arial;max-width:800px;margin:40px auto;padding:20px;line-height:1.6}</style>
        </head>
        <body>
            <h1>Términos y Condiciones</h1>
            <p>Última actualización: 19 de marzo de 2026</p>
            <p>Al acceder a este sitio web, usted acepta cumplir con estos términos y condiciones de uso y acepta que es responsable del cumplimiento de las leyes locales aplicables. Si no está de acuerdo con alguno de estos términos, tiene prohibido usar o acceder a este sitio.</p>
            <h2>Licencia de uso</h2>
            <p>Se concede permiso para descargar temporalmente una copia de los materiales (información o software) en el sitio web de El Farol al Día solo para visualización transitoria personal y no comercial. Esta es la concesión de una licencia, no una transferencia de título, y bajo esta licencia usted no puede:</p>
            <ul>
                <li>Modificar o copiar los materiales;</li>
                <li>Usar los materiales para cualquier propósito comercial o para exhibición pública (comercial o no comercial);</li>
                <li>Intentar descompilar o aplicar ingeniería inversa a cualquier software contenido en el sitio web de El Farol al Día;</li>
                <li>Eliminar cualquier copyright u otras notaciones de propiedad de los materiales; o</li>
                <li>Transferir los materiales a otra persona o "reflejar" los materiales en cualquier otro servidor.</li>
            </ul>
            <p>Esta licencia terminará automáticamente si viola cualquiera de estas restricciones y puede ser terminada por El Farol al Día en cualquier momento. Al terminar su visualización de estos materiales o al terminar esta licencia, debe destruir cualquier material descargado en su posesión, ya sea en formato electrónico o impreso.</p>
            <h2>Exactitud de los materiales</h2>
            <p>Los materiales que aparecen en el sitio web de El Farol al Día podrían incluir errores técnicos, tipográficos o fotográficos. No garantizamos que los materiales en nuestro sitio web sean precisos, completos o actuales. Podemos realizar cambios en los materiales en cualquier momento sin previo aviso.</p>
            <p><a href="/">Volver al inicio</a></p>
        </body>
        </html>
    `);
});

app.get('/cookies', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Política de Cookies - El Farol al Día</title>
        <meta name="robots" content="index, follow">
        <link rel="canonical" href="https://elfarolaldia.com/cookies">
        <style>body{font-family:Arial;max-width:800px;margin:40px auto;padding:20px;line-height:1.6}</style>
        </head>
        <body>
            <h1>Política de Cookies</h1>
            <p>Última actualización: 19 de marzo de 2026</p>
            <p>En El Farol al Día, utilizamos cookies para mejorar su experiencia de navegación, analizar el tráfico del sitio y personalizar el contenido.</p>
            <h2>¿Qué son las cookies?</h2>
            <p>Las cookies son pequeños archivos de texto que se almacenan en su dispositivo cuando visita un sitio web. Se utilizan ampliamente para hacer que los sitios web funcionen de manera más eficiente y proporcionar información a los propietarios del sitio.</p>
            <h2>Cómo usamos las cookies</h2>
            <p>Utilizamos cookies de Google AdSense para mostrar anuncios relevantes y medir su rendimiento. Estas cookies pueden recopilar información sobre sus hábitos de navegación para mostrarle anuncios que sean relevantes para usted y sus intereses.</p>
            <h2>Control de cookies</h2>
            <p>Puede controlar y/o eliminar las cookies según desee. Puede eliminar todas las cookies que ya están en su computadora y puede configurar la mayoría de los navegadores para que no se acepten. Sin embargo, si hace esto, es posible que tenga que ajustar manualmente algunas preferencias cada vez que visite un sitio y que algunos servicios y funcionalidades no funcionen.</p>
            <p><a href="/">Volver al inicio</a></p>
        </body>
        </html>
    `);
});

app.get('/nosotros', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Sobre Nosotros - El Farol al Día</title>
        <meta name="robots" content="index, follow">
        <link rel="canonical" href="https://elfarolaldia.com/nosotros">
        <style>body{font-family:Arial;max-width:800px;margin:40px auto;padding:20px;line-height:1.6}</style>
        </head>
        <body>
            <h1>Sobre El Farol al Día</h1>
            <p>Fundado en Santo Domingo Este, República Dominicana, El Farol al Día es un periódico digital comprometido con la verdad, la precisión y el impacto social. Nuestra misión es informar con integridad, ofrecer análisis profundos y ser un faro de luz en el panorama informativo dominicano.</p>
            <p>Nuestro equipo combina periodismo tradicional con inteligencia artificial de última generación (Gemini, Claude, DeepSeek) para ofrecer noticias verificadas y relevantes 24/7.</p>
            <p><a href="/">Volver al inicio</a></p>
        </body>
        </html>
    `);
});

app.get('/contacto', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Contacto - El Farol al Día</title>
        <meta name="robots" content="index, follow">
        <link rel="canonical" href="https://elfarolaldia.com/contacto">
        <style>body{font-family:Arial;max-width:800px;margin:40px auto;padding:20px;line-height:1.6}</style>
        </head>
        <body>
            <h1>Contacto</h1>
            <p><strong>Email:</strong> info@elfarolaldia.com</p>
            <p><strong>Redacción:</strong> redaccion@elfarolaldia.com</p>
            <p><strong>Publicidad:</strong> ads@elfarolaldia.com</p>
            <p><strong>Dirección:</strong> Santo Domingo Este, República Dominicana</p>
            <p><a href="/">Volver al inicio</a></p>
        </body>
        </html>
    `);
});

// ============================================================
// 📡 API ENDPOINTS PARA PANEL DE REDACCIÓN (SUPABASE)
// ============================================================

// Middleware para validar PIN simple
function validarPin(req, res, next) {
    const pin = req.headers['x-pin'] || req.query.pin;
    
    if (pin !== '311') {
        return res.status(403).json({ 
            error: 'Acceso no autorizado',
            mensaje: 'PIN inválido'
        });
    }
    next();
}

/**
 * GET /api/admin/config
 * Obtiene la configuración actual (últimas reglas)
 */
app.get('/api/admin/config', validarPin, async (req, res) => {
    try {
        if (!supabase) {
            return res.json({ 
                ...obtenerReglasDefault(),
                offline: true,
                mensaje: 'Modo offline - usando reglas por defecto'
            });
        }

        // Buscar la configuración más reciente
        const { data, error } = await supabase
            .from('reglas_mxl')
            .select('*')
            .eq('usuario_id', 'director')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = no encontrado
            console.warn('⚠️ Error al obtener config:', error);
            return res.json(obtenerReglasDefault());
        }

        if (!data) {
            return res.json(obtenerReglasDefault());
        }

        // Mapear campos de la base de datos al formato del panel
        res.json({
            instruccion_principal: data.instruccion_principal || '',
            tono: data.tono || 'profesional',
            enfasis: data.enfasis || '',
            enfoque_geografico: data.enfoque_geografico || 'rd',
            evitar: data.evitar || '',
            palabras_clave: data.palabras_clave || '',
            ultima_actualizacion: data.updated_at || data.created_at
        });

    } catch (err) {
        console.warn('⚠️ Error en GET /api/admin/config:', err);
        res.json(obtenerReglasDefault());
    }
});

/**
 * POST /api/admin/config
 * Guarda nueva configuración en Supabase
 */
app.post('/api/admin/config', validarPin, async (req, res) => {
    try {
        const { instruccion, enfasis, tono } = req.body;

        if (!supabase) {
            return res.status(503).json({ 
                error: 'Supabase no disponible',
                mensaje: 'El sistema está en modo offline. Los cambios no se guardarán permanentemente.'
            });
        }

        // Validar datos mínimos
        if (!instruccion || !tono) {
            return res.status(400).json({
                error: 'Datos incompletos',
                mensaje: 'Instrucción y tono son requeridos'
            });
        }

        // Preparar objeto para guardar
        const nuevaConfig = {
            usuario_id: 'director',
            instruccion_principal: instruccion,
            enfasis: enfasis || '',
            tono: tono,
            enfoque_geografico: req.body.enfoque_geografico || 'rd',
            evitar: req.body.evitar || '',
            palabras_clave: req.body.palabras_clave || '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        // Insertar nueva configuración
        const { data, error } = await supabase
            .from('reglas_mxl')
            .insert([nuevaConfig])
            .select();

        if (error) {
            console.warn('⚠️ Error al guardar config:', error);
            return res.status(500).json({
                error: 'Error en base de datos',
                mensaje: error.message
            });
        }

        console.log('✅ Nueva configuración guardada en Supabase');
        res.json({
            success: true,
            mensaje: 'Configuración guardada exitosamente',
            data: data[0]
        });

    } catch (err) {
        console.warn('⚠️ Error en POST /api/admin/config:', err);
        res.status(500).json({
            error: 'Error interno',
            mensaje: err.message
        });
    }
});

/**
 * GET /api/memoria
 * Obtiene los últimos registros de memoria_ia
 */
app.get('/api/memoria', validarPin, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        if (!supabase) {
            return res.json({
                offline: true,
                mensaje: 'Modo offline - sin historial disponible',
                data: []
            });
        }

        // Obtener últimos registros de memoria
        const { data, error } = await supabase
            .from('memoria_ia')
            .select('*')
            .eq('usuario_id', 'director')
            .order('timestamp', { ascending: false })
            .limit(limit);

        if (error) {
            console.warn('⚠️ Error al obtener memoria:', error);
            return res.json({ 
                error: error.message,
                data: [] 
            });
        }

        // Formatear datos para el panel
        const memoriaFormateada = data.map(item => ({
            id: item.id,
            titulo: item.titulo,
            contenido: item.contenido,
            categoria: item.categoria,
            exitosa: item.exitosa,
            feedback: item.feedback,
            url: item.url_publicada,
            fecha: item.timestamp,
            tipo: item.exitosa ? 'publicación' : 'error'
        }));

        res.json({
            success: true,
            total: data.length,
            data: memoriaFormateada
        });

    } catch (err) {
        console.warn('⚠️ Error en GET /api/memoria:', err);
        res.json({ 
            error: err.message,
            data: [] 
        });
    }
});

/**
 * GET /api/admin/stats (opcional - para el panel)
 * Obtiene estadísticas de publicaciones
 */
app.get('/api/admin/stats', validarPin, async (req, res) => {
    try {
        if (!supabase) {
            return res.json({ offline: true });
        }

        const dias = parseInt(req.query.dias) || 7;
        const estadisticas = await obtenerEstadisticasMemoria('director', dias);
        
        res.json(estadisticas || { error: 'No hay datos suficientes' });

    } catch (err) {
        console.warn('⚠️ Error en GET /api/admin/stats:', err);
        res.json({ error: err.message });
    }
});

// Ruta para verificar que las APIs están activas
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        supabase: supabase ? 'conectado' : 'offline',
        apis: ['/api/admin/config', '/api/memoria', '/api/admin/stats']
    });
});

console.log('\n✅ APIs del Panel de Redacción configuradas');
console.log('   - GET  /api/admin/config  (obtener configuración)');
console.log('   - POST /api/admin/config  (guardar configuración)');
console.log('   - GET  /api/memoria        (historial de publicaciones)');
console.log('   - GET  /api/admin/stats    (estadísticas)');
console.log('   - GET  /api/health         (estado del servidor)\n');

// ============================================================
// SERVIDOR ESTÁTICO - SIEMPRE AL FINAL
// ============================================================

// Servir el index.html para todas las rutas no API (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
app.listen(PORT, () => {
    console.log(`
    🏮═══════════════════════════════════════════════════════════🏮
    
        EL FAROL AL DÍA - PERIÓDICO DIGITAL DOMINICANO
        Servidor corriendo en puerto: ${PORT}
        Modo: ${supabase ? '✅ Con Supabase' : '⚠️ Sin Supabase (offline)'}
        
        📊 Endpoints disponibles:
        • GET  /api/noticias          - Lista de noticias
        • GET  /api/noticias/:slug    - Noticia específica
        • GET  /api/admin/config      - Configuración (PIN 311)
        • POST /api/admin/config      - Guardar configuración (PIN 311)
        • GET  /api/memoria            - Historial (PIN 311)
        • GET  /api/admin/stats        - Estadísticas (PIN 311)
        • GET  /api/health             - Estado del servidor
        
        📄 Páginas legales:
        • /privacidad • /terminos • /cookies • /nosotros • /contacto
        
    🏮═══════════════════════════════════════════════════════════🏮
    `);
});
