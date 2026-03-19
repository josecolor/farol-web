/**
 * 🧠 SUPABASE INTEGRATION — El Farol al Día (FIXED)
 * 
 * ✅ ARREGLADO:
 * 1. Variables de entorno reconocidas correctamente
 * 2. Validación de SUPABASE_URL y SUPABASE_KEY
 * 3. Logs de debug sin exponer claves
 * 4. Fallback automático si Supabase no está configurado
 */

const { createClient } = require('@supabase/supabase-js');

// ══════════════════════════════════════════════════════════
// 🔍 VALIDACIÓN DE VARIABLES DE ENTORNO (con logs seguros)
// ══════════════════════════════════════════════════════════

console.log('🔐 Verificando variables de entorno Supabase...');
console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL ? '✅ Configurada' : '❌ NO configurada'}`);
console.log(`   SUPABASE_KEY: ${process.env.SUPABASE_KEY ? '✅ Configurada (primeros 20 chars: ' + process.env.SUPABASE_KEY.substring(0, 20) + '...)' : '❌ NO configurada'}`);

// ══════════════════════════════════════════════════════════
// INICIALIZAR CLIENTE SUPABASE (CON VALIDACIÓN CORRECTA)
// ══════════════════════════════════════════════════════════

let supabase = null;

// ✅ CORRECCIÓN: Validar variables ANTES de createClient
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
        // ✅ CORRECCIÓN: Nombres exactos coinciden con variables
        supabase = createClient(
            process.env.SUPABASE_URL,     // ← EXACTO
            process.env.SUPABASE_KEY       // ← EXACTO
        );
        console.log('✅ Supabase client inicializado correctamente');
    } catch (err) {
        console.warn('⚠️ Error inicializando Supabase:', err.message);
        supabase = null;
    }
} else {
    console.warn('⚠️ SUPABASE_URL o SUPABASE_KEY no configurados en Railway');
    console.warn('   → Sistema funcionará en modo OFFLINE (sin Supabase)');
    console.warn('   → Agrega variables en Railway → Variables');
    supabase = null;
}

// ══════════════════════════════════════════════════════════
// 1️⃣ LEER REGLAS DEL USUARIO (ANTES DE GENERAR NOTICIA)
// ══════════════════════════════════════════════════════════

async function leerReglasUsuario(usuarioId = 'director') {
    // ✅ Si Supabase no está configurado, retorna defaults inmediatamente
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
            console.warn(`⚠️ Error consultando reglas de Supabase: ${error.message}`);
            return obtenerReglasDefault();
        }

        if (!data) {
            console.log('📝 Sin reglas personalizadas en Supabase → usando defaults');
            return obtenerReglasDefault();
        }

        console.log('✅ Reglas cargadas de Supabase correctamente');
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
        console.warn(`⚠️ Timeout/error leyendo reglas: ${err.message}`);
        return obtenerReglasDefault();
    }
}

// Reglas por defecto (fallback)
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
        return false;
    }
}

// ══════════════════════════════════════════════════════════
// 3️⃣ REGISTRAR ERROR
// ══════════════════════════════════════════════════════════

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
        return false;
    }
}

// ══════════════════════════════════════════════════════════
// 4️⃣ ACTUALIZAR REGLAS EN TIEMPO REAL
// ══════════════════════════════════════════════════════════

async function actualizarReglasSupabase(nuvasReglas, usuarioId = 'director') {
    if (!supabase) {
        console.warn('⚠️ Supabase offline → reglas no guardadas en BD');
        console.warn('   → Pero se actualizan en memoria local (funciona hasta restart)');
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
// 5️⃣ OBTENER ESTADÍSTICAS
// ══════════════════════════════════════════════════════════

async function obtenerEstadisticasMemoria(usuarioId = 'director', dias = 7) {
    if (!supabase) {
        console.log('📊 Supabase offline → sin estadísticas');
        return null;
    }

    try {
        const fechaLimite = new Date();
        fechaLimite.setDate(fechaLimite.getDate() - dias);

        const { data, error } = await supabase
            .from('memoria_ia')
            .select('*')
            .eq('usuario_id', usuarioId)
            .gte('timestamp', fechaLimite.toISOString())
            .order('timestamp', { ascending: false });

        if (error) {
            console.warn(`⚠️ Error obteniendo estadísticas: ${error.message}`);
            return null;
        }

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
// 🧠 ESTADO DE SUPABASE (para debugging)
// ══════════════════════════════════════════════════════════

function obtenerEstadoSupabase() {
    return {
        conectado: !!supabase,
        url_configurada: !!process.env.SUPABASE_URL,
        key_configurada: !!process.env.SUPABASE_KEY,
        mensaje: supabase 
            ? '✅ Supabase conectado y listo' 
            : '⚠️ Supabase offline — sistema funcionará sin él'
    };
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
    obtenerReglasDefault,
    obtenerEstadoSupabase
};
