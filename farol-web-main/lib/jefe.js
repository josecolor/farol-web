'use strict';
/**
 * EL FAROL AL DÍA — Jefe de Redacción Inteligente
 *
 *  1) bloqueSistema()   → módulo analítico que se INYECTA en el prompt de sistema del modelo
 *                          (clasifica Noticia Dura vs General, Virality Score, titulares SEO/redes).
 *  2) preevaluar()      → evaluación heurística determinista (red de seguridad: un modelo de 0.5B
 *                          no siempre clasifica/puntúa bien, así que el código tiene la última palabra).
 *  3) parsearRespuesta()→ PARSER INTELIGENTE: acepta texto libre o con etiquetas (TITULO_A, TITULO:, Título:, **Titular**…),
 *                          NUNCA lanza error por formato: siempre devuelve un título publicable.
 *  4) evaluarFinal()    → mezcla lo que dijo el modelo con la heurística y devuelve los metadatos a persistir en MongoDB.
 */

// ── 1. Prompt de sistema ────────────────────────────────────────────────
function bloqueSistema() {
    return [
        'MÓDULO JEFE DE REDACCIÓN (aplícalo siempre):',
        '1) CLASIFICA la noticia: NOTICIA DURA (hecho urgente o grave: accidentes, crimen, justicia, emergencias, decisiones de gobierno) ' +
            'o GENERAL (cultura, economía cotidiana, deportes, tecnología, servicios, historias del barrio).',
        '2) CALCULA un VIRALITY_SCORE de 0 a 100 según el impacto: cercanía a Santo Domingo Este, número de personas afectadas, ' +
            'urgencia, dinero involucrado y emoción. Un número solo, sin explicación.',
        '3) TITULAR: si es DURA, el hecho central directo, sin suavizar ni especular. Si es GENERAL, atractivo y con el beneficio o impacto local. ' +
            'Optimizado para SEO: máximo 65 caracteres, con el sector (Los Mina, Invivienda, SDE…) o el nombre real de la persona si aplica.',
        '4) TITULAR_SOCIAL: una versión que funcione como post de Facebook sin cambios (máx. 110 caracteres).',
        'Responde con estas líneas, una por línea, y después el cuerpo de la noticia:',
        'TIPO_NOTICIA: DURA o GENERAL',
        'VIRALITY_SCORE: número',
        'TITULO: titular SEO',
        'TITULAR_SOCIAL: titular para redes',
        'DESCRIPCION: meta descripción de 150 a 160 caracteres',
        'PALABRAS: cinco palabras clave separadas por comas',
        'SUBTEMA_LOCAL: un solo tema',
        'CONTENIDO:',
        'cuerpo de la noticia en párrafos cortos',
    ].join('\n');
}

// ── 2. Heurística determinista ──────────────────────────────────────────
const DURAS = /(muert|fallec|herid|accident|crimen|asesin|arrest|detenid|deteni[dó]|incendi|tirote|balacera|terremoto|huracán|huracan|tormenta|inundaci|emergencia|fiscal|juicio|condena|robo|atraco|secuestr)/i;

function clasificarNoticia(texto) {
    return DURAS.test(String(texto || '')) ? 'DURA' : 'GENERAL';
}

function calcularViralityScore(texto, categoria) {
    const t = String(texto || '').toLowerCase();
    let score = 40;
    if (/los mina|invivienda|santo domingo este|\bsde\b|sabana perdida|villa mella|charles de gaulle|ensanche ozama|los trinitarios/.test(t)) score += 20;
    if (/presidente|gobierno|polic[ií]a|militar|ministerio|alcald/.test(t)) score += 10;
    if (DURAS.test(t)) score += 15;
    if (/millones|pesos|dinero|precio|salario|subsidio|alza|baja/.test(t)) score += 10;
    if (/video|foto|viral|tendencia|redes/.test(t)) score += 5;
    if (/urgente|última hora|ultima hora|alerta/.test(t)) score += 5;
    if (['Nacionales', 'Deportes'].includes(categoria)) score += 5;
    return Math.max(0, Math.min(100, score));
}

/** Pre-evaluación sobre el contexto disponible ANTES de generar (puede venir vacío en noticias autogeneradas). */
function preevaluar(contexto, categoria) {
    return { tipo: clasificarNoticia(contexto), virality: calcularViralityScore(contexto, categoria) };
}

// ── 3. Parser inteligente ───────────────────────────────────────────────
const quitarAcentos = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// Etiquetas aceptadas → clave interna. Se comparan sin acentos, sin mayúsculas, sin ** ni #.
const ETIQUETAS = [
    [/^(titulo[\s_-]*a|titulo[\s_-]*1|titular[\s_-]*a|opcion[\s_-]*1)$/, 'tituloA'],
    [/^(titulo[\s_-]*b|titulo[\s_-]*2|titular[\s_-]*b|opcion[\s_-]*2)$/, 'tituloB'],
    [/^(titulo|titular|titulo[\s_-]*seo|titular[\s_-]*seo|headline|title)$/, 'tituloA'],
    [/^(titular[\s_-]*social|titulo[\s_-]*social|titular[\s_-]*redes|social)$/, 'social'],
    [/^(descripcion|meta[\s_-]*descripcion|description|resumen)$/, 'descripcion'],
    [/^(palabras|palabras[\s_-]*clave|keywords|tags)$/, 'palabras'],
    [/^(subtema[\s_-]*local|subtema|tema)$/, 'subtema'],
    [/^(tipo[\s_-]*noticia|tipo|clasificacion)$/, 'tipo'],
    [/^(virality[\s_-]*score|virality|score[\s_-]*viral|puntaje)$/, 'virality'],
    [/^(contenido|cuerpo|noticia|texto|body|articulo)$/, 'contenido'],
];

function _etiqueta(linea) {
    // "**TITULO_A:** algo", "## Título: algo", "- Titular - algo" (solo con ':')
    const m = linea.match(/^[\s*_#>\-–•]*([A-Za-zÁÉÍÓÚáéíóúÑñ_ 0-9-]{3,30}?)[\s*_]*:\s*[*_]*\s*(.*)$/);
    if (!m) return null;
    const nombre = quitarAcentos(m[1]).toLowerCase().trim();
    for (const [re, clave] of ETIQUETAS) if (re.test(nombre)) return { clave, valor: m[2].trim() };
    return null;
}

const limpiarTitulo = s => String(s || '')
    .replace(/[*_#`]/g, '').replace(/^["'“”«»\s]+|["'“”«»\s]+$/g, '')
    .replace(/^\[|\]$/g, '').replace(/\s+/g, ' ').trim();
const esPlaceholder = s => !s || /^\[?\s*(opci[oó]n|titular|titulo|t[ií]tulo|escribe|tu |aqu[ií]|65 ?chars)/i.test(s) || s.length < 8;

function parsearRespuesta(texto, { categoria = 'Nacionales' } = {}) {
    const bruto = String(texto || '').replace(/\r/g, '');
    const out = { tituloA: '', tituloB: '', social: '', descripcion: '', palabras: '', subtema: '', tipoModelo: null, viralityModelo: null,
                  contenido: '', modo: 'etiquetas' };
    const cuerpo = [];
    let enCuerpo = false, vistoEtiqueta = false;

    for (const crudo of bruto.split('\n')) {
        const linea = crudo.trim();
        if (!linea) { if (enCuerpo) cuerpo.push(''); continue; }
        const et = !enCuerpo || /^[\s*_#]*contenido/i.test(quitarAcentos(linea)) ? _etiqueta(linea) : null;
        if (et) {
            vistoEtiqueta = true;
            if (et.clave === 'contenido') { enCuerpo = true; if (et.valor) cuerpo.push(et.valor); continue; }
            if (enCuerpo) { cuerpo.push(linea); continue; }
            if (et.clave === 'tipo') { const v = quitarAcentos(et.valor).toUpperCase(); out.tipoModelo = /DURA/.test(v) ? 'DURA' : /GENERAL/.test(v) ? 'GENERAL' : null; }
            else if (et.clave === 'virality') { const n = parseInt((et.valor.match(/\d{1,3}/) || [])[0], 10); out.viralityModelo = Number.isFinite(n) ? Math.min(100, n) : null; }
            else if (et.clave === 'tituloA' && out.tituloA) { /* ya hay uno: el segundo etiquetado "titulo" queda como alternativo */ if (!out.tituloB) out.tituloB = et.valor; }
            else out[et.clave] = et.valor;
            continue;
        }
        if (enCuerpo) cuerpo.push(linea);
        else if (!vistoEtiqueta) cuerpo.push(linea);           // texto libre antes de cualquier etiqueta: candidato a título/cuerpo
        else cuerpo.push(linea);                                // línea suelta tras las etiquetas: es cuerpo
    }

    // Texto libre (sin etiqueta de CONTENIDO): lo suelto es el artículo y la primera línea corta es el título
    let lineas = cuerpo;
    if (!enCuerpo) {
        out.modo = vistoEtiqueta ? 'etiquetas-parciales' : 'libre';
        lineas = cuerpo.filter(l => !/^(aqu[ií] (tienes|est[aá])|claro|por supuesto|entendido|¡?hola)/i.test(quitarAcentos(l)));
        const i = lineas.findIndex(l => l.trim());
        if (!out.tituloA && !out.tituloB && i >= 0 && lineas[i].length <= 160) { out.tituloA = lineas[i]; lineas = lineas.slice(i + 1); }
    }

    // Contenido: párrafos separados por línea en blanco; limpia markdown residual
    out.contenido = lineas
        .map(l => l.replace(/^[\s]*[*#>]+\s*/, '').replace(/\*\*/g, '').replace(/^_+|_+$/g, '').trim())
        .reduce((acc, l) => { if (!l) { if (acc.length && acc[acc.length - 1] !== '') acc.push(''); } else acc.push(l); return acc; }, [])
        .join('\n').split(/\n{1,}/).map(p => p.trim()).filter(Boolean).join('\n\n');

    // Un modelo pequeño a veces devuelve un bloque único: se reparte en párrafos de ~3 oraciones (lectura móvil)
    if (out.contenido && !out.contenido.includes('\n\n') && out.contenido.length > 500) {
        const oraciones = out.contenido.match(/[^.!?…]+[.!?…]+["”»)]*\s*|[^.!?…]+$/g) || [out.contenido];
        const ps = []; for (let i = 0; i < oraciones.length; i += 3) ps.push(oraciones.slice(i, i + 3).join('').trim());
        out.contenido = ps.filter(Boolean).join('\n\n');
    }

    // Título: limpio, sin placeholders; si no hay ninguno usable, se deriva del cuerpo
    out.tituloA = limpiarTitulo(out.tituloA); out.tituloB = limpiarTitulo(out.tituloB); out.social = limpiarTitulo(out.social);
    if (esPlaceholder(out.tituloA)) out.tituloA = '';
    if (esPlaceholder(out.tituloB)) out.tituloB = '';
    if (!out.tituloA && !out.tituloB) {
        const primera = (out.contenido.split('\n\n')[0] || '').replace(/\s+/g, ' ');
        const corte = primera.length > 70 ? primera.slice(0, 70).replace(/\s+\S*$/, '') : primera;
        out.tituloA = limpiarTitulo(corte.replace(/[.,;:]+$/, '')) || `Última hora en ${categoria}: Santo Domingo Este`;
        out.modo += '+titulo-derivado';
    }
    out.descripcion = String(out.descripcion || '').replace(/[*_#`]/g, '').trim();
    if (!out.descripcion) out.descripcion = (out.contenido.split('\n\n')[0] || '').slice(0, 157).replace(/\s+\S*$/, '') + (out.contenido.length > 157 ? '…' : '');
    out.palabras = String(out.palabras || '').replace(/[\[\]*_#`]/g, '').trim();
    out.subtema = quitarAcentos(out.subtema).toLowerCase().replace(/[^a-z-]/g, ' ').trim().split(/\s+/)[0] || '';
    return out;
}

/** Elige el mejor titular entre A y B (puntaje SEO simple) y recorta a longitud publicable. */
function elegirTitular(a, b) {
    const t = [a, b].filter(Boolean);
    if (t.length < 2) return recortar(t[0] || '');
    const score = s => [/\d/.test(s), /[¿?]/.test(s), /mina|invivienda|gaulle|ozama|mella|sde|santo domingo/i.test(s), s.length >= 40 && s.length <= 70].filter(Boolean).length;
    return recortar(score(b) > score(a) ? b : a);
}
function recortar(s, max = 110) {
    s = limpiarTitulo(s);
    return s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, '').replace(/[,:;\-–]+$/, '');
}

// ── 4. Evaluación final → metadatos para Mongo ──────────────────────────
function evaluarFinal({ parsed, titulo, contenido, categoria, contexto }) {
    const base = `${titulo}\n${contenido}\n${contexto || ''}`;
    const tipoHeur = clasificarNoticia(base);
    const viralHeur = calcularViralityScore(base, categoria);
    // Una noticia con vocabulario de hecho grave es DURA aunque el modelo diga lo contrario; si no, se respeta al modelo.
    const tipo = tipoHeur === 'DURA' ? 'DURA' : (parsed.tipoModelo || tipoHeur);
    const virality = parsed.viralityModelo == null ? viralHeur : Math.round(viralHeur * 0.6 + parsed.viralityModelo * 0.4);
    return {
        tipo_noticia: tipo,
        virality_score: Math.max(0, Math.min(100, virality)),
        virality_heuristico: viralHeur,
        virality_modelo: parsed.viralityModelo,
        tipo_modelo: parsed.tipoModelo,
        titular_social: recortar(parsed.social || titulo, 110),
    };
}

module.exports = { bloqueSistema, preevaluar, clasificarNoticia, calcularViralityScore, parsearRespuesta, elegirTitular, evaluarFinal };
