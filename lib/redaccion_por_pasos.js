'use strict';
/**
 * EL FAROL AL DÍA — Redactor por pasos (pensado para modelos pequeños: qwen2.5:0.5b/1.5b/3b)
 *
 * Un modelo de 0.5B no sostiene una nota de 900 palabras con formato, voz y SEO en una sola respuesta:
 * copia plantillas, se repite, se corta e inventa. Aquí el trabajo se parte en tareas pequeñas y verificables:
 *
 *   1. HECHOS  (código)  → se extraen del texto fuente; sin hechos no hay nota (jamás se inventa).
 *   2. TITULAR (modelo)  → 1 tarea corta con ejemplos; validada con el filtro estricto; si falla, se reconstruye por código.
 *   3. PÁRRAFOS (modelo) → 1 llamada por párrafo (gancho, hecho, detalle, contexto, impacto local, lo que falta, qué sigue, cierre).
 *                          Cada uno se valida: longitud, sin corchetes/plantillas, sin cifras ajenas a los hechos, sin repetir los previos.
 *   4. METADATOS (código)→ descripción, palabras clave, subtema, tipo y virality sin pedirle nada al modelo.
 *
 * Devuelve la misma forma que redaccion.redactar(): { parsed, palabras, ampliaciones, alcanzoMinimo }.
 */
const jefe  = require('./jefe');
const roles = require('./roles');

const contarPalabras = t => String(t || '').split(/\s+/).filter(w => w.length > 1).length;
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const claves = p => new Set(norm(p).replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter(w => w.length > 3));
const solapa = (a, b) => { if (!a.size || !b.size) return 0; let c = 0; for (const w of a) if (b.has(w)) c++; return c / Math.min(a.size, b.size); };
const numeros = t => new Set((String(t || '').match(/\d[\d.,]*/g) || []).map(x => x.replace(/[.,]/g, '')).filter(x => x.length >= 2));

// Metas del modo: por pasos se publica una nota CORTA y fundamentada; en modo "completo" se mantiene el comportamiento anterior.
const modo = () => (process.env.REDACCION_MODO === 'completo' ? 'completo' : 'pasos');
const metaPalabras = () => parseInt(process.env.PALABRAS_MIN || (modo() === 'completo' ? '900' : '450'), 10);
const pisoPalabras = () => parseInt(process.env.PALABRAS_PISO || (modo() === 'completo' ? '350' : '250'), 10);

// ── 1. Hechos ────────────────────────────────────────────────────────────
function extraerHechos(texto, { titulo = '', max = 14 } = {}) {
    let tit = titulo, fuente = '';
    const resto = [];
    for (const l of String(texto || '').replace(/\r/g, '').split('\n')) {
        const m = l.match(/^\s*(T[IÍ]TULO|RESUMEN|FUENTE|ENLACE)\s*:\s*(.*)$/i);
        if (!m) { resto.push(l); continue; }
        const k = norm(m[1]);
        if (k === 'titulo') tit = tit || m[2].trim(); else if (k === 'fuente') fuente = m[2].trim(); else if (k === 'resumen') resto.push(m[2]);
    }
    const limpio = resto.join(' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&quot;|&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
    const vistos = new Set(), hechos = [];
    if (tit && !jefe.esTituloBasura(tit)) { hechos.push(tit.replace(/[.\s]+$/, '')); vistos.add(norm(tit)); }
    for (const f of limpio.split(/(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡"“])/)) {
        const s = f.trim();
        if (s.length < 30 || s.length > 320 || jefe.esLineaEco(s) || /[\[\]{}]/.test(s) || vistos.has(norm(s))) continue;
        vistos.add(norm(s)); hechos.push(s);
        if (hechos.length >= max) break;
    }
    return { titulo: tit, fuente, hechos, chars: hechos.join(' ').length };
}

// ── 2. Párrafos ──────────────────────────────────────────────────────────
const SECCIONES = {
    gancho:    'abre la nota con el dato más fuerte, directo, sin saludo ni preámbulo',
    hecho:     'cuenta qué pasó, quién, cuándo y dónde, usando solo los hechos dados',
    detalle:   'añade los detalles concretos que aparecen en los hechos (nombres, lugares, cifras exactas)',
    contexto:  'explica el antecedente o por qué importa, en palabras simples y sin afirmar datos nuevos',
    impacto:   'explica cómo puede afectar a los vecinos de Santo Domingo Este y a la gente común, sin inventar cifras',
    saber:     'resume lo que ya se sabe y lo que todavía falta por confirmar',
    siguiente: 'indica qué viene después o qué puede hacer el lector, sin prometer nada que no esté en los hechos',
    cierre:    'cierra con una idea final clara, sin preguntas ni despedida',
};
const PLAN_CORTO = ['gancho', 'hecho', 'contexto', 'impacto', 'siguiente', 'cierre'];                         // pocos hechos
const PLAN_LARGO = ['gancho', 'hecho', 'detalle', 'contexto', 'impacto', 'saber', 'siguiente', 'cierre'];      // hechos suficientes
const RE_FRIA = /\b(cabe destacar|cabe mencionar|es importante (se[ñn]alar|destacar|mencionar)|en este sentido|en el marco de|por otra parte|en conclusi[oó]n|en el d[ií]a de hoy|asimismo)\b/i;

function promptParrafo({ seccion, hechos, fuente, previo, categoria }) {
    return [
        'HECHOS (usa SOLO estos datos):',
        ...hechos.map((h, i) => `${i + 1}. ${h}`),
        '',
        `TAREA: escribe UN párrafo de 2 a 4 oraciones (40 a 75 palabras) que ${SECCIONES[seccion]}.`,
        seccion === 'hecho' && fuente ? `Menciona que la información proviene de ${fuente}.` : '',
        `Sección del periódico: ${categoria}.`,
        'REGLAS: oraciones de máximo 20 palabras; voz activa; no inventes cifras, nombres ni declaraciones; sin títulos, sin viñetas, sin saludos, sin preguntas.',
        previo ? `El párrafo anterior dice: "${previo.slice(-220)}". No repitas esas ideas ni empieces con las mismas palabras.` : '',
        'Responde solo con el párrafo.',
    ].filter(Boolean).join('\n');
}

function limpiarParrafo(t) {
    let x = jefe.limpiarContinuacion(t).replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    x = x.replace(/^(p[aá]rrafo(\s*\d+)?|respuesta)\s*[:\-]\s*/i, '').replace(/^\d+[.)]\s+/, '').replace(/^["“«]+|["”»]+$/g, '').trim();
    const oraciones = x.match(/[^.!?…]+[.!?…]+["”»)]*/g) || [];
    if (oraciones.length) x = oraciones.slice(0, 4).join(' ').trim();                 // sin cola cortada a mitad de frase
    return x;
}

function validarParrafo(p, { previos, hechosTxt, seccion }) {
    const n = contarPalabras(p);
    if (n < 22) return 'muy_corto';
    if (n > 110) return 'muy_largo';
    if (/[\[\]{}]/.test(p) || jefe.esLineaEco(p)) return 'plantilla';
    if (!/[.!?…"”»)]$/.test(p)) return 'incompleto';
    if (RE_FRIA.test(p)) return 'muletilla';
    if (seccion === 'cierre' && /[¿?]/.test(p)) return 'pregunta_en_cierre';
    const ajenas = [...numeros(p)].filter(x => !hechosTxt.has(x));
    if (ajenas.length) return `cifra_ajena_${ajenas[0]}`;
    const k = claves(p);
    for (const q of previos) if (solapa(k, claves(q)) >= 0.6) return 'repite_previo';
    const ini = norm(p).split(' ').slice(0, 2).join(' ');
    if (previos.length && norm(previos[previos.length - 1]).split(' ').slice(0, 2).join(' ') === ini) return 'mismo_inicio';
    return null;
}

// ── 3. Titular ───────────────────────────────────────────────────────────
const EJEMPLOS_TITULAR = ['Cierran un carril de la Autopista Duarte por trabajos de asfaltado', 'Familias de Sabana Perdida reciben títulos de propiedad', 'Suben los precios del pollo en los mercados de la capital'];
async function generarTitular({ generar, system, hechos, fuente, categoria }) {
    const prompt = [
        'HECHOS:', ...hechos.slice(0, 5).map((h, i) => `${i + 1}. ${h}`), '',
        'TAREA: escribe UN titular periodístico con tus propias palabras, de 8 a 12 palabras (máximo 65 caracteres), directo y con el dato central. Sin comillas, sin etiquetas, sin punto final.',
        'Ejemplos de ESTILO (no los copies, el tema es otro):', ...EJEMPLOS_TITULAR.map(e => `- ${e}`), '',
        'Responde solo con el titular.',
    ].join('\n');
    for (const temperature of [0.4, 0.6, 0.8]) {
        let t = '';
        try { t = await generar(prompt, { system, temperature, maxTokens: 60 }); } catch { continue; }
        t = jefe.limpiarContinuacion(t).split('\n')[0].replace(/^(titular|t[ií]tulo)\s*[:\-]\s*/i, '').replace(/^["“«]+|["”»]+$/g, '').replace(/[.\s]+$/, '').trim();
        if (!jefe.esTituloBasura(t) && t.length <= 85 && !EJEMPLOS_TITULAR.some(e => solapa(claves(t), claves(e)) >= 0.7)) return t;
    }
    return '';
}
async function generarDescripcion({ generar, system, hechos }) {
    const prompt = ['HECHOS:', ...hechos.slice(0, 4).map((h, i) => `${i + 1}. ${h}`), '',
        'TAREA: escribe UNA sola oración de 110 a 150 caracteres que resuma la noticia e invite a leerla. Sin comillas, sin etiquetas, sin puntos suspensivos.', 'Responde solo con la oración.'].join('\n');
    for (const temperature of [0.4, 0.6]) {
        let d = '';
        try { d = await generar(prompt, { system, temperature, maxTokens: 90 }); } catch { continue; }
        d = jefe.limpiarContinuacion(d).split('\n')[0].replace(/^(descripci[oó]n|resumen)\s*[:\-]\s*/i, '').replace(/^["“«]+|["”»]+$/g, '').trim();
        if (!jefe.esDescripcionBasura(d) && d.length >= 90 && d.length <= 165 && !/…$/.test(d)) return d;
    }
    return '';
}

// ── 4. Metadatos por código ──────────────────────────────────────────────
const SUBTEMAS = [
    [/\b(policia|asalto|robo|atraco|balacera|homicidio|arrest\w*|detenid\w*|crimen)\b/, 'seguridad-policia'],
    [/\b(precios?|inflacion|dolar|mercado|combustibles?|salarios?|banco|canasta|impuestos?)\b/, 'economia-mercado'],
    [/\b(beisbol|pelota|liga|grandes ligas|licey|aguilas|tigres)\b/, 'deporte-beisbol'],
    [/\b(futbol|baloncesto|voleibol|atletismo|boxeo)\b/, 'deporte-general'],
    [/\b(hospital\w*|salud|dengue|vacuna\w*|medic\w*)\b/, 'salud-medicina'],
    [/\b(escuelas?|clases|estudiantes|educacion|universidad\w*)\b/, 'educacion'],
    [/\b(viviendas?|invivienda|titulos? de propiedad|desalojo)\b/, 'vivienda-social'],
    [/\b(transito|trafico|autopista|carreteras?|metro|guaguas?|puentes?)\b/, 'transporte-vial'],
    [/\b(obras?|asfalt\w*|drenaje|infraestructura|apagon\w*|agua)\b/, 'infraestructura'],
    [/\b(tecnologia|inteligencia artificial|aplicacion|internet|celulares?)\b/, 'tecnologia'],
    [/\b(musica|concierto|artista|festival|cine|pelicula)\b/, 'cultura-musica'],
    [/\b(gobierno|congreso|senado|presidente|ley|decreto|ministerio)\b/, 'politica-gobierno'],
];
const subtemaDe = t => { const n = norm(t); for (const [re, s] of SUBTEMAS) if (re.test(n)) return s; return ''; };
const palabrasClave = (titulo, categoria) => {
    const w = [...new Set(String(titulo).toLowerCase().replace(/[^a-záéíóúñü0-9 ]+/g, ' ').split(/\s+/).filter(x => x.length >= 5))].slice(0, 4);
    return [...w, 'Santo Domingo Este', categoria].join(', ');
};

// ── Orquestación ─────────────────────────────────────────────────────────
/**
 * @param generar      async (prompt,{system,temperature,maxTokens}) → texto
 * @param fuenteTexto  texto con los hechos (comunicado RSS con TÍTULO/RESUMEN/FUENTE, o el cuerpo de la nota a reestructurar)
 * @param tituloFuente opcional: titular de la fuente
 */
async function redactarPorPasos({ generar, fuenteTexto, tituloFuente = '', categoria = 'Nacionales', rol, minPalabras }) {
    const meta = minPalabras || metaPalabras();
    const fx = extraerHechos(fuenteTexto, { titulo: tituloFuente });
    if (fx.hechos.length < 2 || fx.chars < 120) {
        throw Object.assign(new Error('Sin hechos suficientes en la fuente: no se redacta (no se inventa)'), { code: 'SIN_HECHOS' });
    }
    const hechosTxt = numeros(`${fx.titulo} ${fx.hechos.join(' ')}`);
    const system = `Eres ${rol.nombre}, ${rol.cargo} de "El Farol al Día" (Santo Domingo Este). Escribes en español claro y neutro, con frases cortas y verbos activos. ` +
                   'No inventas datos. Respondes solo con el texto pedido: sin saludos, sin notas, sin preguntas.';
    const plan = fx.hechos.length <= 3 ? PLAN_CORTO : PLAN_LARGO;

    const parrafos = [], descartes = [];
    for (const seccion of plan) {
        let ok = null, motivo = '';
        for (const temperature of [Math.min(0.9, rol.temperature), Math.min(0.9, rol.temperature + 0.1), Math.min(0.95, rol.temperature + 0.2)]) {
            let crudo = '';
            try { crudo = await generar(promptParrafo({ seccion, hechos: fx.hechos, fuente: fx.fuente, previo: parrafos[parrafos.length - 1], categoria }), { system, temperature, maxTokens: 300 }); }
            catch (e) { motivo = e.message; if (/LLM_CIRCUITO_ABIERTO|COLA_LLENA/.test(e.message)) throw e; continue; }
            const p = limpiarParrafo(crudo);
            motivo = validarParrafo(p, { previos: parrafos, hechosTxt, seccion });
            if (!motivo) { ok = p; break; }
        }
        if (ok) parrafos.push(ok); else descartes.push(`${seccion}:${motivo}`);
    }
    if (parrafos.length < 4) throw Object.assign(new Error(`Redacción por pasos insuficiente (${parrafos.length} párrafos válidos; descartes: ${descartes.join(', ')})`), { code: 'PASOS_INSUFICIENTES' });

    const contenido = parrafos.join('\n\n');
    let titulo = await generarTitular({ generar, system, hechos: fx.hechos, fuente: fx.fuente, categoria });
    if (!titulo) titulo = jefe.reconstruirTitulo(parrafos[0]) || jefe.reconstruirTitulo(fx.hechos.join('. '));
    titulo = jefe.limpiarTituloEstricto(titulo, { contenido, categoria });
    let descripcion = await generarDescripcion({ generar, system, hechos: fx.hechos });
    if (!descripcion) descripcion = jefe.limpiarDescripcionEstricta('', contenido);

    const base = `${titulo}\n${contenido}`;
    const palabras = contarPalabras(contenido);
    return {
        parsed: {
            tituloA: titulo, tituloB: '', social: titulo.slice(0, 110), bajada: '', descripcion, palabras: palabrasClave(titulo, categoria),
            subtema: subtemaDe(base), tipoModelo: null, viralityModelo: null, contenido, modo: 'pasos', depuradas: 0,
        },
        palabras, ampliaciones: 0, alcanzoMinimo: palabras >= meta,
        pasos: { parrafos: parrafos.length, plan: plan.length, descartes, hechos: fx.hechos.length },
    };
}

module.exports = { redactarPorPasos, extraerHechos, validarParrafo, promptParrafo, metaPalabras, pisoPalabras, modo };
