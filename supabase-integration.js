/**
 * 🧠 SUPABASE INTEGRATION — El Farol al Día
 * 
 * Conecta con Supabase para:
 * 1. Leer reglas/instrucciones del usuario (tabla: reglas_mxl)
 * 2. Guardar memoria de publicaciones (tabla: memoria_ia)
 * 3. Retroalimentación y aprendizaje del sistema
 * 
 * Resiliencia: Si Supabase falla, funciona con defaults
 */

const { createClient } = require('@supabase/supabase-js');

// Validar credenciales
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.warn('⚠️ SUPABASE_URL o SUPABASE_KEY no configurados');
    console.warn('   Funcionando en modo OFFLINE (sin Supabase)');
}

// Inicializar cliente Supabase (null-safe)
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
    : null;

// ══════════════════════════════════════════════════════════
// 1️⃣ LEER REGLAS DEL USUARIO (ANTES DE GENERAR NOTICIA)
// ══════════════════════════════════════════════════════════

/**
 * Consulta Supabase tabla 'reglas_mxl' para obtener:
 * - Instrucciones personalizadas del usuario
 * - Enfoque (RD, Caribe, Internacional)
 * - Estilo de redacción (profesional, directo, etc)
 * - Palabras clave que debe incluir
 * - Temas a evitar
 * 
 * RETORNA: objeto con reglas O {} si Supabase no responde
 * NUNCA BLOQUEA LA GENERACIÓN DE NOTICIA
 */
async function leerReglasUsuario(usuarioId = 'director') {
    if (!supabase) {
        console.log('📝 Supabase offline → usando reglas por defecto');
        return obtenerReglasDefault();
    }

    try {
        const ctrl = new AbortController();
        const tm = setTimeout(() => ctrl.abort(), 5000); // timeout 5s

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
            enfoque_geografico: data.enfoque_geografico || 'rd', // 'rd', 'caribe', 'internacional'
            ultima_actualizacion: data.updated_at
        };

    } catch (err) {
        console.warn(`⚠️ Supabase timeout/error: ${err.message}`);
        return obtenerReglasDefault();
    }
}

// Reglas por defecto (si Supabase no responde)
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

// ══════════════════════════════════════════════════════════
// 2️⃣ GUARDAR MEMORIA DESPUÉS DE PUBLICAR
// ══════════════════════════════════════════════════════════

/**
 * Inserta en tabla 'memoria_ia' después de publicar noticia:
 * - Título generado
 * - Contenido (primeros 500 chars)
 * - Categoría
 * - Feedback del usuario (opcional)
 * - Timestamp
 * 
 * El sistema APRENDE: próxima vez que leas reglas, 
 * el usuario puede ver qué funcionó bien
 */
async function guardarMemoriaPublicacion(noticia, feedback = null) {
    if (!supabase) {
        console.log('📚 Supabase offline → memoria no guardada (es OK)');
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
        console.warn(`⚠️ Error guardando memoria (timeout): ${err.message}`);
        return false; // No bloquea
    }
}

// ══════════════════════════════════════════════════════════
// 3️⃣ REGISTRAR ERROR (PARA APRENDER QUÉ NO FUNCIONÓ)
// ══════════════════════════════════════════════════════════

/**
 * Guarda errores en tabla 'memoria_ia' con tipo='error'
 * El usuario puede ver patrones: qué temas fallan, por qué
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

        if (error) {
            console.warn(`⚠️ Error registrando fallo: ${error.message}`);
            return false;
        }

        return true;
    } catch (err) {
        return false; // Silent fail
    }
}

// ══════════════════════════════════════════════════════════
// 4️⃣ ACTUALIZAR REGLAS EN TIEMPO REAL (API)
// Endpoint: POST /api/actualizar-reglas (requiere PIN 311)
// ══════════════════════════════════════════════════════════

async function actualizarReglasSupabase(nuvasReglas, usuarioId = 'director') {
    if (!supabase) {
        console.warn('⚠️ Supabase offline → reglas no guardadas');
        return false;
    }

    try {
        const { data: dataBuscar } = await supabase
            .from('reglas_mxl')
            .select('id')
            .eq('usuario_id', usuarioId)
            .single();

        if (dataBuscar?.id) {
            // Actualizar existente
            const { error } = await supabase
                .from('reglas_mxl')
                .update({
                    ...nuvasReglas,
                    updated_at: new Date().toISOString()
                })
                .eq('id', dataBuscar.id);

            if (error) throw error;
            console.log('✅ Reglas actualizadas en Supabase');
            return true;

        } else {
            // Crear nueva
            const { error } = await supabase
                .from('reglas_mxl')
                .insert([{
                    usuario_id: usuarioId,
                    ...nuvasReglas,
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

// ══════════════════════════════════════════════════════════
// 5️⃣ OBTENER ESTADÍSTICAS DE PUBLICACIONES
// Para dashboard del usuario
// ══════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════
// EXPORTAR
// ══════════════════════════════════════════════════════════

module.exports = {
    supabase,
    leerReglasUsuario,
    guardarMemoriaPublicacion,
    registrarErrorPublicacion,
    actualizarReglasSupabase,
    obtenerEstadisticasMemoria,
    obtenerReglasDefault
};
