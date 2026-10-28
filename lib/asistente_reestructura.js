'use strict';
/**
 * EL FAROL AL DÍA — Asistente Quirúrgico de Edición (reestructuración y calidad)
 *
 *  diagnosticar(noticia)                    → { palabras, flags[], causa, necesita }   (sin IA, determinista)
 *  reestructurarNoticia(noticia, causa, o)  → { titulo, contenido, seo_description, seo_keywords, redactor, ... }
 *
 * No toca la base de datos: devuelve los campos nuevos y el endpoint decide cómo persistirlos
 * (así el slug, las vistas, la fecha y el id nunca corren riesgo desde aquí).
 * Reutiliza el parser/depurador de jefe.js, la ampliación automática de redaccion.js y los roles de roles.js.
 */
const jefe      = require('./jefe');
const roles     = require('./roles');
const redaccion = require('./redaccion');

const PISO = () => redaccion.pisoPalabras();   // por debajo, la reestructuración se rechaza
const META = () => redaccion.metaPalabras();   // meta editorial (450 por pasos / 900 en modo completo)
const MAX_ORIGINAL = 7000;                                              // chars del original que se envían al modelo (ctx 8192)

// ── Utilidades ───────────────────────────────────────────────────────────
const contar = t => String(t || '').split(/\s+/).filter(w => w.length > 1).length;
const norm   = p => String(p || '').toLowerCase().replace(/[^a-záéíóúñ0-9]+/g, ' ').trim();
const claves = p => new Set(norm(p).split(' ').filter(w => w.length > 3));
const solapa = (a, b) => { if (!a.size || !b.size) return 0; let c = 0; for (const w of a) if (b.has(w)) c++; return c / Math.min(a.size, b.size); };
const parrafosDe = t => String(t || '').split(/\n\s*\n|\n/).map(p => p.trim()).filter(p => p.length > 20);
const oraciones  = p => (String(p).match(/[^.!?…]+[.!?…]+/g) || [String(p)]).filter(o => o.trim().length > 3);

// Muletillas de redacción fría/corporativa (las mismas que se prohíben en jefe.js)
const FRIAS = /\b(cabe destacar|cabe mencionar|cabe se[ñn]alar|es importante (se[ñn]alar|destacar|mencionar)|en este sentido|en el marco de|por otra parte|en conclusi[oó]n|a continuaci[oó]n|asimismo|en tal sentido|de esta manera|dicho lo anterior|resulta fundamental|es menester|en aras de)\b/gi;

// ── 1. Diagnóstico determinista ──────────────────────────────────────────
function diagnosticar(n = {}) {
    const texto = String(n.contenido || '').trim();
    const palabras = contar(texto);
    const ps = parrafosDe(texto);
    const flags = [];

    if (palabras < 500) flags.push('texto_corto');
    else if (palabras < META()) flags.push('bajo_meta');

    if (texto && !/[.!?…"”»)]\s*$/.test(texto)) flags.push('texto_incompleto');

    const primera = oraciones(ps[0] || '')[0] || '';
    if (contar(primera) > 30 || /^(en (el|la|un|una|este|esta)\b|el d[ií]a de hoy|hoy en d[ií]a|santo domingo este\.?\s*[-—])/i.test(primera.trim())) flags.push('sin_gancho');

    if ((texto.match(FRIAS) || []).length >= 3) flags.push('redaccion_robotica');

    if (ps.length && ps.length < 4) flags.push('pocos_parrafos');
    if (ps.some(p => contar(p) > 90 || oraciones(p).length > 4)) flags.push('parrafos_largos');

    const k = ps.map(claves);
    let rep = false;
    for (let i = 0; i < k.length && !rep; i++) for (let j = i + 1; j < k.length; j++) if (solapa(k[i], k[j]) >= 0.7) { rep = true; break; }
    if (rep) flags.push('repeticion');

    const edadH = n.fecha ? (Date.now() - new Date(n.fecha).getTime()) / 3600000 : 0;
    if (Number(n.vistas || 0) < 5 && edadH > 72) flags.push('bajo_rendimiento');

    const TXT = { texto_corto: 'texto muy corto', bajo_meta: 'no llega a la meta de palabras', texto_incompleto: 'texto incompleto',
        sin_gancho: 'sin gancho', redaccion_robotica: 'redacción robótica', pocos_parrafos: 'mala estructura (pocos párrafos)',
        parrafos_largos: 'párrafos demasiado largos', repeticion: 'ideas repetidas', bajo_rendimiento: 'bajo rendimiento' };
    // "necesita" ignora el bajo rendimiento solo: sin fallo de redacción no hay nada que reestructurar
    const necesita = flags.some(f => f !== 'bajo_rendimiento') || (flags.includes('bajo_rendimiento') && flags.length > 1);
    return { palabras, flags, causa: flags.map(f => TXT[f]).join(', '), necesita };
}

// ── 2. Prompt de alta precisión ──────────────────────────────────────────
const INSTRUCCION_CENTRAL =
    'Eres el Asistente Quirúrgico de Edición de El Farol al Día. Esta noticia fue publicada con fallos. ' +
    'Tu trabajo es reestructurarla desde cero manteniendo los datos reales pero aplicando el formato Social-Web humanizado: ' +
    'gancho potente en la primera frase, párrafos cortos de 1-3 oraciones, dinamismo, cero lenguaje robótico/corporativo y mínimo 900 palabras. ' +
    'Elimina redundancias y mejora el titular SEO si es necesario.';

function promptReestructura({ noticia, causa, rol, diag }) {
    const original = String(noticia.contenido || '').slice(0, MAX_ORIGINAL);
    const truncado = String(noticia.contenido || '').length > MAX_ORIGINAL;
    return [
        roles.encabezado(rol).trim(),
        INSTRUCCION_CENTRAL,
        '',
        `FALLOS REPORTADOS: ${causa || 'revisión de calidad'}${diag.causa ? ` | DETECTADOS AUTOMÁTICAMENTE: ${diag.causa}` : ''}`,
        `SECCIÓN: ${noticia.seccion || 'Nacionales'}`,
        `TITULAR ACTUAL: ${noticia.titulo}`,
        noticia.seo_description ? `RESUMEN ACTUAL: ${noticia.seo_description}` : '',
        '',
        `TEXTO ORIGINAL${truncado ? ' (recortado)' : ''} — ÚNICA FUENTE DE HECHOS:`,
        '"""', original, '"""',
        '',
        'REGLAS DE LA REESTRUCTURA:',
        '1) Usa SOLO los hechos, nombres, lugares y cifras que están en el texto original. No agregues cifras, citas ni declaraciones nuevas.',
        '2) Si el original es corto, no inventes: profundiza con contexto explicativo (antecedentes, alcance para la comunidad, qué sigue) sin afirmar datos nuevos.',
        '3) No copies frases del original: reescribe todo con voz humana y ritmo de feed. Cada párrafo aporta algo nuevo.',
        '4) La primera frase es el gancho (máximo 25 palabras). Párrafos de 1 a 3 oraciones. Cierre que resuelve la duda abierta.',
        '5) El TITULO debe ser SEO (máximo 65 caracteres), concreto y fiel a los hechos; solo cámbialo si mejora al actual.',
        'Entrega la nota con el formato de etiquetas indicado (TIPO_NOTICIA … CONTENIDO) y nada más.',
    ].filter(l => l !== undefined).join('\n');
}

// ── 3. Validación posterior (parser de jefe.js ya aplicó depuración) ─────
const numeros = t => new Set((String(t || '').match(/\d[\d.,]*/g) || []).map(x => x.replace(/[.,]/g, '')).filter(x => x.length >= 2));

function validar({ parsed, titulo, palabras, noticia }) {
    const avisos = [];
    if (!titulo || titulo.length < 15) throw Object.assign(new Error('La reestructura no produjo un titular utilizable'), { code: 'REESTRUCTURA_TITULO' });
    if (palabras < PISO()) throw Object.assign(new Error(`La reestructura quedó en ${palabras} palabras (piso ${PISO()}); no se aplicó`), { code: 'REESTRUCTURA_CORTA' });
    if (palabras < META()) avisos.push(`bajo_meta_${palabras}_de_${META()}`);

    // Cifras que no existen en el original = posible dato inventado
    const base = numeros(`${noticia.titulo}\n${noticia.contenido}\n${noticia.seo_description || ''}`);
    const nuevas = [...numeros(`${titulo}\n${parsed.contenido}`)].filter(x => !base.has(x));
    if (nuevas.length > 2) throw Object.assign(new Error(`La reestructura introdujo cifras que no estaban en el original (${nuevas.slice(0, 5).join(', ')}); no se aplicó`), { code: 'REESTRUCTURA_CIFRAS', cifras: nuevas });
    if (nuevas.length) avisos.push(`cifras_nuevas_${nuevas.join('_')}`);

    const post = diagnosticar({ contenido: parsed.contenido, vistas: 999 });
    for (const f of ['redaccion_robotica', 'repeticion', 'texto_incompleto', 'sin_gancho']) if (post.flags.includes(f)) avisos.push(`persiste_${f}`);
    if (post.flags.includes('texto_incompleto')) throw Object.assign(new Error('La reestructura quedó cortada a mitad de frase; no se aplicó'), { code: 'REESTRUCTURA_INCOMPLETA' });
    return { avisos, diagnosticoPost: post };
}

// ── 4. Reestructuración ──────────────────────────────────────────────────
/**
 * @param noticia  fila de `noticias` (id, titulo, seccion, contenido, seo_description, …)
 * @param causa    texto libre: "redacción robótica", "texto muy corto", "sin gancho"…
 * @param opts     { generar(prompt,{system,temperature}) , minPalabras, rondasMax }  — por defecto usa lib/llm
 */
async function reestructurarNoticia(noticia, causa = '', opts = {}) {
    if (!noticia || !noticia.contenido || !noticia.titulo) throw Object.assign(new Error('Noticia sin título o contenido'), { code: 'REESTRUCTURA_ENTRADA' });
    const generar = opts.generar || (() => { const llm = require('./llm'); return (p, o) => llm.generarTexto(p, 3, 3500, o); })();

    const diag = diagnosticar(noticia);
    const asign = roles.asignarPeriodista({ categoria: noticia.seccion, texto: `${noticia.titulo}\n${noticia.contenido}` });
    const rol = asign.rol;
    const system = `${roles.systemDe(rol)}\n\n${INSTRUCCION_CENTRAL}\n\n${jefe.bloqueSistema()}`;
    const prompt = promptReestructura({ noticia, causa, rol, diag });

    const red = await redaccion.redactarAuto({
        generar, prompt, system, temperature: rol.temperature, categoria: asign.seccion, rol,
        minPalabras: opts.minPalabras || META(), rondasMax: opts.rondasMax || 3,
        fuenteTexto: noticia.contenido, tituloFuente: jefe.esTituloBasura(noticia.titulo) ? '' : noticia.titulo,      // modo por pasos: los hechos salen de la nota original
    });

    const parsed = red.parsed;
    const titulo = jefe.elegirTitular(parsed.tituloA, parsed.tituloB, parsed.contenido, asign.seccion);
    const { avisos, diagnosticoPost } = validar({ parsed, titulo, palabras: red.palabras, noticia });

    return {
        titulo: titulo.slice(0, 255),
        contenido: parsed.contenido.slice(0, 12000),
        seo_description: jefe.limpiarDescripcionEstricta(parsed.descripcion, parsed.contenido).slice(0, 160),
        seo_keywords: String(parsed.palabras || '').slice(0, 255),
        redactor: rol.nombre.slice(0, 100),
        palabras: red.palabras,
        ampliaciones: red.ampliaciones,
        alcanzo_meta: red.alcanzoMinimo,
        modo_parser: parsed.modo,
        avisos,
        diagnostico_previo: diag,
        diagnostico_posterior: diagnosticoPost,
    };
}

module.exports = { reestructurarNoticia, diagnosticar, promptReestructura, INSTRUCCION_CENTRAL };
