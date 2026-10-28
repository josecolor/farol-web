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
        'ESTILO SOCIAL-WEB (obligatorio; lectura rápida en móvil, como un feed):',
        '- La PRIMERA frase es el gancho: el dato más fuerte o la tensión del hecho, máximo 25 palabras, sin saludo ni preámbulo.',
        '- Frases cortas (8 a 18 palabras), una idea por párrafo, 1 a 3 oraciones. Tras una frase larga, una corta e incisiva.',
        '- Retención: abre una duda legítima en el primer párrafo y respóndela más abajo; cada 2 o 3 párrafos entra un dato, giro o contraste nuevo ' +
            '(lo que se sabe / lo que falta / lo que viene). Una sola pregunta retórica en toda la nota, como máximo.',
        '- Titular: promesa concreta que el texto cumple. PROHIBIDO el clickbait engañoso, "no vas a creer", MAYÚSCULAS gritadas y signos repetidos.',
        '- Prohibidas las muletillas robóticas: "cabe destacar", "es importante señalar", "en este sentido", "en el marco de", "por otra parte", ' +
            '"en conclusión". No empieces dos párrafos seguidos con la misma palabra ni repitas ideas o frases: cada párrafo aporta algo nuevo.',
        '- Voz humana: verbos activos, sujeto concreto, detalle local cuando el contexto lo traiga; español neutro que se entienda en cualquier país, sin jerga ni modismos cerrados.',
        '- Valor real para el lector: explica qué cambia para él. Atribuye cada dato a su fuente. No inventes cifras, citas ni nombres.',
        '- Cierre: el último párrafo resuelve la duda abierta y deja una idea final. Sin despedida y sin preguntas al lector.',
        'ESTRUCTURA DE LA NOTA: titular, bajada de dos oraciones, cuerpo desarrollado (mínimo 900 palabras en párrafos cortos) y cierre.',
        'Responde con estas líneas, una por línea, y después el cuerpo de la noticia:',
        'TIPO_NOTICIA: DURA o GENERAL',
        'VIRALITY_SCORE: número',
        'TITULO: titular SEO',
        'TITULAR_SOCIAL: titular para redes',
        'DESCRIPCION: resumen de 120 a 155 caracteres que invite a leer, sin repetir el titular ni terminar en puntos suspensivos',
        'PALABRAS: cinco palabras clave separadas por comas',
        'SUBTEMA_LOCAL: un solo tema',
        'BAJADA: copete de dos oraciones que resume lo esencial',
        'CONTENIDO:',
        'cuerpo desarrollado de la noticia en párrafos cortos y, como último párrafo, la conclusión',
        'PROHIBIDO ABSOLUTO: saludos, preguntas, notas aclaratorias, disculpas u opciones para elegir. ' +
            'Entrega solo el texto periodístico final, listo para insertarse en la base de datos.',
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
    [/^(bajada|copete|entradilla|sumario|lead)$/, 'bajada'],
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
// ══════════════════════════════════════════════════════════
// 🧹 FILTRO ESTRICTO DE TÍTULOS (V43) — ningún flujo publica un titular con corchetes, instrucciones o menos de 10 caracteres
// ══════════════════════════════════════════════════════════
const _n = s => quitarAcentos(String(s || '')).toLowerCase();
// Texto de instrucciones/plantillas que un modelo pequeño copia literal en vez de escribir la noticia
const RE_INSTRUCCION = [
    /\b(opcion|titulo|titular)\s*(?:[ab12]|uno|dos)\b/,                                   // "Opción 1", "Título A"
    /\b\d{2,3}\s*chars?\b|\bcaracteres?\b.{0,30}\b(maximo|max|usa|entre)\b|\bmaximo\s*\d+\s*(caracteres|palabras)/,
    /\b(minimo|maximo)\s*\d+\s*palabras\b|\bextension\s*[:=]|\b\d{3,4}\s*palabras\b/,       // "MÍNIMO 900 PALABRAS", "EXTENSIÓN: 300 palabras"
    /\bpalabras?\s*clave\b|\bgsc\b|search console/,
    /\b(cuerpo|texto|contenido|titular|titulo)\b.{0,25}\baqui\b|\baqui\b.{0,12}\b(cuerpo|texto|contenido|titular)\b|\bcuerpo completo\b/,
    /\btipos?\s+de\s+noticias?\b/,
    /^\W*(dura|general)\s*[:\-]/, /\b(tipo_noticia|virality|titular_social|subtema_local)\b/,
    /\b(escribe|redacta|genera|inserta|coloca)\b.{0,40}\b(titular|titulo|noticia|parrafos?|cuerpo)\b/,
    /\b(titular|titulo)\s+(seo|de la noticia)\b|\b(lorem ipsum|placeholder|texto de prueba|sin titulo)\b/,
    /^\W*(texto|cuerpo|titulo|titular|noticia|contenido|bajada|resumen|descripcion)\W*$/,    // una palabra suelta
];
const _limpiaCrudo = s => String(s || '').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim();
/** ¿Es un titular inservible? (corchetes/llaves, instrucciones, <10 caracteres). Evalúa el texto CRUDO: los corchetes no se "limpian", se condenan. */
function esTituloBasura(t) {
    const s = _limpiaCrudo(t);
    if (!s) return true;
    if (/[\[\]{}]/.test(s)) return true;
    const n = _n(s);
    if (n.replace(/[^a-z0-9ñ]/g, '').length < 10) return true;
    if (RE_INSTRUCCION.some(re => re.test(n))) return true;
    // Lista de barrios sin hecho ("Los Mina, Invivienda y Charles de Gaulle"): no es un titular
    const resto = n.replace(/\b(los mina|invivienda|charles de gaulle|ensanche ozama|sabana perdida|sabana larga|villa mella|el almirante|carretera mella|los trinitarios|santo domingo este|santo domingo|san isidro|mendoza|boca chica|av\.? venezuela|sde|rd|republica dominicana)\b/g, ' ')
        .replace(/\b(y|e|de|del|la|el|en|con|a|o|u)\b/g, ' ').replace(/[^a-z0-9ñ]+/g, ' ').trim();
    return resto.split(' ').filter(Boolean).length < 2;
}
const esPlaceholder = esTituloBasura;                          // compatibilidad con el parser

// Línea de plantilla/instrucción copiada dentro de la respuesta (para sacarla del cuerpo y de las etiquetas)
const RE_ECO = /(minimo\s*\d+\s*palabras|extension\s*[:=]|\b\d{2,3}\s*chars?\b|cuerpo completo|tipos?\s+de\s+noticias?|usa palabras clave reales|\buno de\b.{0,20}politica-gobierno|titulo_[ab]\b)/;
function esLineaEco(linea) {
    const t = String(linea || '').trim();
    if (!t || t.length > 220) return false;
    const n = _n(t);
    if (/^[\s*_#>\-–•]*\[[^\]]{3,}\]\s*$/.test(t)) return true;                       // línea que es solo "[ … ]"
    if (/[\[\]]/.test(t) && RE_INSTRUCCION.some(re => re.test(n))) return true;          // corchetes + instrucción
    return RE_ECO.test(n);
}

const _CORTAS = new Set('de del la las el los un una unos unas y e o u a en con por para que al su sus se lo como mas pero sin sobre entre'.split(' '));
function _frases(texto) { return String(texto || '').match(/[^.!?…]+[.!?…]*/g) || []; }

/** Titular SEO (≤65) armado con la primera oración REAL del cuerpo. '' si el cuerpo no sirve. */
function reconstruirTitulo(contenido, max = 65) {
    for (const p of String(contenido || '').split(/\n+/)) {
        const par = _limpiaCrudo(p);
        if (par.length < 25 || esLineaEco(par)) continue;
        for (const f of _frases(par)) {
            let t = f.replace(/^[\s"'“«¿¡\-–—•]+/, '').replace(/["”»]+\s*$/, '').replace(/[.!?…:;,\s]+$/, '').trim();
            if (t.split(' ').length < 4 || t.length < 20 || esTituloBasura(t)) continue;
            if (t.length > max) { t = t.slice(0, max + 1); const i = t.lastIndexOf(' '); t = i > 20 ? t.slice(0, i) : t.slice(0, max); }
            const w = t.split(' '); while (w.length > 3 && (_CORTAS.has(_n(w[w.length - 1])) || (/^\d+$/.test(w[w.length - 1]) && _CORTAS.has(_n(w[w.length - 2]))))) w.pop();
            t = w.join(' ').replace(/[,:;\-–]+$/, '').trim();
            if (t.length >= 10) return t.charAt(0).toUpperCase() + t.slice(1);
        }
    }
    return '';
}

/**
 * Filtro obligatorio. Devuelve SIEMPRE un titular publicable:
 *  - limpio y válido → se conserva (recortado a `max`)
 *  - con corchetes / instrucciones / <10 caracteres → se descarta y se reconstruye con la primera oración real del cuerpo (≤65)
 */
function limpiarTituloEstricto(titulo, { contenido = '', categoria = 'Nacionales', max = 110 } = {}) {
    const crudo = _limpiaCrudo(titulo);
    if (!esTituloBasura(crudo)) {
        const t = crudo.replace(/^["'“”«»\s]+|["'“”«»\s]+$/g, '').replace(/[:;,\-–\s]+$/, '').replace(/…+$/, '').trim();
        if (t.length >= 10) return t.length <= max ? t : t.slice(0, max).replace(/\s+\S*$/, '').replace(/[,:;\-–]+$/, '');
    }
    return reconstruirTitulo(contenido) || `Última hora en ${categoria}: Santo Domingo Este`;
}

/** Descripción SEO limpia (≥30 caracteres, sin corchetes ni instrucciones); si no sirve, sale del cuerpo. */
function esDescripcionBasura(d) {
    const s = _limpiaCrudo(d);
    return !s || s.length < 30 || /[\[\]{}]/.test(s) || RE_INSTRUCCION.slice(0, 7).some(re => re.test(_n(s))) || /^\W*(texto|descripcion|resumen|bajada)\b/.test(_n(s));
}
function limpiarDescripcionEstricta(desc, contenido = '', max = 155) {
    const s = _limpiaCrudo(desc);
    if (!esDescripcionBasura(s)) return s.length <= 160 ? s : s.slice(0, 157).replace(/\s+\S*$/, '') + '…';
    let acc = '';
    for (const p of String(contenido || '').split(/\n+/)) {
        const par = _limpiaCrudo(p);
        if (par.length < 25 || esLineaEco(par)) continue;
        for (const f of _frases(par)) { const t = f.trim(); if (!t) continue; if ((acc + ' ' + t).trim().length > max) break; acc = (acc + ' ' + t).trim(); }
        if (acc) break;
    }
    if (!acc) { const par = _limpiaCrudo(String(contenido || '').split(/\n+/).find(x => x.trim().length > 40 && !esLineaEco(x)) || ''); acc = par.length > max ? par.slice(0, max).replace(/\s+\S*$/, '').replace(/[,;:\-–]+$/, '') + '.' : par; }
    return acc;
}

// ── Sin ruido conversacional: la salida del modelo nunca debe llevar saludos, preguntas al operador ni notas ──
const PREAMBULO = /^[\s*_#>-]*(claro|por supuesto|entendido|perfecto|desde luego|de acuerdo|excelente|hola|buen[oa]s|aqu[ií] (tienes|est[aá]|te dejo|va)|a continuaci[oó]n|con gusto|listo[,.:!])/i;
const DIRIGIDO = /(¿\s*(quieres|necesitas|deseas|prefieres|te gustar[ií]a|le gustar[ií]a|puedo|hay algo|quisieras|desea)|\bsi (quieres|necesitas|deseas|prefieres|requieres)\b|espero que (te|esto|le)|no dudes en|h[aá]zmelo saber|d[ií]game si|d[ií]me si|estoy a tu disposici[oó]n|quedo atento|como (modelo de lenguaje|ia\b|inteligencia artificial)|^[\s*_#>-]*nota( aclaratoria| del redactor| de la ia)?\s*:|^[\s*_#>-]*(opci[oó]n|versi[oó]n alternativa)\s*(\d|[ab]\b)|cualquier (otra )?(duda|cambio|ajuste))/i;
function depurarSalida(texto) {
    const lineas = String(texto || '').replace(/\r/g, '').split('\n');
    const out = []; let removidas = 0, vistoContenido = false;
    for (const l of lineas) {
        const t = l.trim();
        if (!t) { out.push(l); continue; }
        if (!vistoContenido && PREAMBULO.test(t) && t.length < 140) { removidas++; continue; }          // saludo/preámbulo inicial
        vistoContenido = true;
        if (/^[-_*=]{3,}$/.test(t)) { removidas++; continue; }                                             // separadores
        if (DIRIGIDO.test(t) && t.length < 260) { removidas++; continue; }                                 // frases dirigidas al operador
        if (esLineaEco(t)) { removidas++; continue; }                                                      // plantilla copiada: "[EL CUERPO COMPLETO AQUÍ…]", "[Opción 1 | 65 chars…]"
        out.push(l);
    }
    return { texto: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), removidas };
}
/** Continuaciones del modelo (sin etiquetas de formato): párrafos limpios listos para anexar. */
function limpiarContinuacion(texto) {
    const { texto: t } = depurarSalida(texto);
    return t.split('\n').map(l => l.replace(/^[\s]*[*#>]+\s*/, '').replace(/\*\*/g, '').replace(/^(conclusi[oó]n|contenido|cuerpo|continuaci[oó]n)\s*:\s*/i, '').trim())
        .reduce((acc, l) => { if (!l) { if (acc.length && acc[acc.length - 1] !== '') acc.push(''); } else acc.push(l); return acc; }, [])
        .join('\n').split(/\n{1,}/).map(p => p.trim()).filter(Boolean).join('\n\n');
}

function parsearRespuesta(texto, { categoria = 'Nacionales' } = {}) {
    const dep = depurarSalida(texto);
    const bruto = dep.texto;
    const out = { tituloA: '', tituloB: '', social: '', bajada: '', descripcion: '', palabras: '', subtema: '', tipoModelo: null, viralityModelo: null,
                  contenido: '', modo: 'etiquetas', depuradas: dep.removidas };
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
        .map(l => l.replace(/^[\s]*[*#>]+\s*/, '').replace(/\*\*/g, '').replace(/^_+|_+$/g, '').replace(/^(conclusi[oó]n|cierre)\s*:\s*/i, '').trim())
        .reduce((acc, l) => { if (!l) { if (acc.length && acc[acc.length - 1] !== '') acc.push(''); } else acc.push(l); return acc; }, [])
        .join('\n').split(/\n{1,}/).map(p => p.trim()).filter(Boolean).join('\n\n');

    // Un modelo pequeño a veces devuelve un bloque único: se reparte en párrafos de ~3 oraciones (lectura móvil)
    if (out.contenido && !out.contenido.includes('\n\n') && out.contenido.length > 500) {
        const oraciones = out.contenido.match(/[^.!?…]+[.!?…]+["”»)]*\s*|[^.!?…]+$/g) || [out.contenido];
        const ps = []; for (let i = 0; i < oraciones.length; i += 3) ps.push(oraciones.slice(i, i + 3).join('').trim());
        out.contenido = ps.filter(Boolean).join('\n\n');
    }

    // Título: limpio, sin placeholders; si no hay ninguno usable, se deriva del cuerpo
    for (const k of ['tituloA', 'tituloB', 'social']) {
        const crudo = _limpiaCrudo(out[k]);
        out[k] = esTituloBasura(crudo) ? '' : limpiarTitulo(crudo);          // corchetes/instrucciones/<10 car. → se descarta
    }
    if (!out.tituloA && !out.tituloB) {
        out.tituloA = reconstruirTitulo(out.contenido) || `Última hora en ${categoria}: Santo Domingo Este`;
        out.modo += '+titulo-derivado';
    }
    out.bajada = String(out.bajada || '').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim();
    if (out.bajada.length > 20 && !out.contenido.startsWith(out.bajada)) out.contenido = `${out.bajada}\n\n${out.contenido}`.trim();   // copete = primer párrafo (se muestra destacado)
    out.descripcion = limpiarDescripcionEstricta(out.descripcion || out.bajada, out.contenido);
    out.palabras = String(out.palabras || '').replace(/[\[\]*_#`]/g, '').trim();
    out.subtema = quitarAcentos(out.subtema).toLowerCase().replace(/[^a-z-]/g, ' ').trim().split(/\s+/)[0] || '';
    return out;
}

/** Elige el mejor titular entre A y B (puntaje SEO simple) y recorta a longitud publicable. */
function elegirTitular(a, b, contenido = '', categoria = 'Nacionales') {
    const t = [a, b].filter(x => x && !esTituloBasura(x));
    if (!t.length) return limpiarTituloEstricto('', { contenido, categoria });          // todo era basura → se reconstruye del cuerpo
    const score = s => [/\d/.test(s), /[¿?]/.test(s), /mina|invivienda|gaulle|ozama|mella|sde|santo domingo/i.test(s), s.length >= 40 && s.length <= 70].filter(Boolean).length;
    const mejor = t.length < 2 ? t[0] : (score(t[1]) > score(t[0]) ? t[1] : t[0]);
    return limpiarTituloEstricto(recortar(mejor), { contenido, categoria });
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

module.exports = { limpiarTituloEstricto, esTituloBasura, esDescripcionBasura, limpiarDescripcionEstricta, reconstruirTitulo, esLineaEco, depurarSalida, limpiarContinuacion, bloqueSistema, preevaluar, clasificarNoticia, calcularViralityScore, parsearRespuesta, elegirTitular, evaluarFinal };
