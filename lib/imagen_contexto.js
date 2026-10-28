'use strict';
/**
 * EL FAROL AL DÍA — Coherencia imagen ↔ noticia
 *
 * Envuelve a `obtenerImagenSegura` (lib/imagenes) SIN modificarlo:
 *   1) Le entrega siempre el titular ya limpio (sin corchetes ni instrucciones).
 *   2) Deduce el contexto real de la nota (lluvia/inundación, tránsito, energía, seguridad, salud, obras…) y el lugar (SDE, Charles de Gaulle…).
 *   3) Valida la foto devuelta contra ese contexto usando sus metadatos (nombre de archivo, URL, página fuente, crédito).
 *      Si no encaja, reintenta con una consulta orientada al contexto; si tampoco, usa la imagen de marca (IMAGEN_FALLBACK_URL)
 *      en vez de publicar una foto fuera de contexto.
 *
 *  Variables: IMAGEN_ESTRICTA (1 por defecto; 0 = solo registrar), IMAGEN_FALLBACK_URL (imagen de marca).
 */
const jefe = require('./jefe');

const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Cada tema: cómo se reconoce en la nota, qué buscar, qué DEBE reflejar la foto y qué la descalifica.
const TEMAS = [
    { id: 'lluvia', re: /\b(lluvias?|aguaceros?|inundaci\w+|vaguada|tormenta|huracan|onda tropical|chubascos?|anegad\w+|desbord\w+|crecida|temporal)\b/,
      consulta: 'heavy rain flooded street Dominican Republic lluvia calle inundada',
      aceptar: /(rain|lluvia|flood|inunda|storm|tormenta|wet|umbrella|paraguas|puddle|charco|street|calle|road|urban|city|traffic|asphalt|asfalto)/,
      rechazar: /(snow|nieve|desert|desierto|ski\b|autumn|otono|sunny beach|playa soleada)/ },
    { id: 'transito', re: /\b(transito|trafico|tapon|autopista|carreteras?|avenidas?|conductores|vehiculos?|accidente de transito|guaguas?|autobus|metro|motoconcho\w*)\b/,
      consulta: 'traffic avenue vehicles street Santo Domingo transito',
      aceptar: /(traffic|transito|street|calle|road|highway|avenue|avenida|bus|car\b|cars|vehicle|urban|city|santo domingo|motorcycle|moto)/,
      rechazar: /(airplane|avion|cruise|barco|forest|bosque|snow|nieve)/ },
    { id: 'energia', re: /\b(apagon\w*|energia|edeeste|edesur|edenorte|electric\w*|luz|transformador\w*|cableado|postes?)\b/,
      consulta: 'power outage electric poles cables city night apagon',
      aceptar: /(electric|power|energy|pole|poste|cable|outage|apagon|luz|blackout|grid|transformer|lineman|wire)/,
      rechazar: /(snow|nieve|solar farm|windmill|eolic)/ },
    { id: 'seguridad', re: /\b(policia|asalto|robo|atraco|balacera|homicidio|arrest\w*|detenid\w*|patrulla\w*|crimen|delincuen\w*|sospechos\w*)\b/,
      consulta: 'police patrol street night Dominican Republic policia',
      aceptar: /(police|policia|patrol|patrulla|crime|security|seguridad|arrest|officer|agente|investigation|cordon|tape)/,
      rechazar: /(soldier|war|guerra|tank|tanque|military parade)/ },
    { id: 'salud', re: /\b(hospital\w*|salud|dengue|vacuna\w*|medic\w*|pacientes?|clinica|sanitari\w*|enfermedad\w*)\b/,
      consulta: 'hospital health clinic doctors Dominican Republic salud',
      aceptar: /(hospital|health|salud|clinic|clinica|doctor|medic|nurse|enfermer|vaccine|vacuna|patient|paciente|mosquito)/,
      rechazar: /(spa\b|massage|masaje|cosmetic)/ },
    { id: 'educacion', re: /\b(escuelas?|clases|estudiantes|colegios?|liceos?|maestros?|educacion|universidad\w*|minerd)\b/,
      consulta: 'school students classroom Dominican Republic escuela',
      aceptar: /(school|escuela|student|estudiante|classroom|aula|class|teacher|maestro|education|educacion|university|universidad|liceo|colegio)/,
      rechazar: /(casino|nightclub|discoteca)/ },
    { id: 'obras', re: /\b(obras?|construccion|asfalt\w*|bacheo|puentes?|remodelacion|inauguran?|inauguracion|excavad\w*)\b/,
      consulta: 'road construction works street Santo Domingo obras',
      aceptar: /(construction|construccion|road|work|obra|bridge|puente|asphalt|asfalto|excavator|excavadora|worker|obrero|infrastructure|street|calle)/,
      rechazar: /(skyscraper|rascacielos|dubai|manhattan)/ },
    { id: 'economia', re: /\b(precios?|inflacion|dolar|economia|mercado|combustibles?|gasolina|gasoil|salarios?|bancos?|canasta|impuestos?|tasa)\b/,
      consulta: 'market prices supermarket Dominican pesos economia colmado',
      aceptar: /(market|mercado|price|precio|money|dinero|cash|peso|bank|banco|store|tienda|supermarket|colmado|fuel|gas station|economy|economia|coins|bill)/,
      rechazar: /(bitcoin|crypto|wall street|stock exchange new york)/ },
    { id: 'deporte', re: /\b(beisbol|pelota|liga|futbol|baloncesto|estadio|jugador\w*|campeonato|licey|aguilas|tigres|grandes ligas)\b/,
      consulta: 'baseball stadium players Dominican Republic beisbol',
      aceptar: /(baseball|beisbol|pelota|stadium|estadio|player|jugador|sport|deporte|soccer|futbol|football|basketball|game|juego|team|equipo|pitch)/,
      rechazar: /(chess|ajedrez|poker)/ },
    { id: 'incendio', re: /\b(incendi\w*|fuego|quema\w*|humo|bomberos?)\b/,
      consulta: 'fire smoke firefighters Dominican Republic incendio bomberos',
      aceptar: /(fire|fuego|smoke|humo|firefighter|bombero|flame|llama|burn|incendio)/,
      rechazar: /(campfire|fogata|fireplace|chimenea|fireworks|fuegos artificiales)/ },
    { id: 'gobierno', re: /\b(congreso|senado|diputad\w*|presidente|gobierno|ministerio|decreto|ley\b|alcaldia|palacio nacional|reforma)\b/,
      consulta: 'government building Santo Domingo palacio congreso',
      aceptar: /(government|gobierno|palace|palacio|congress|congreso|senate|senado|building|edificio|official|minister|ministerio|flag|bandera|santo domingo)/,
      rechazar: /(white house|capitol hill|parliament london|kremlin)/ },
    { id: 'tecnologia', re: /\b(tecnologia|inteligencia artificial|aplicacion|internet|celulares?|smartphones?|ciberseguridad|software|redes sociales)\b/,
      consulta: 'smartphone technology digital network users',
      aceptar: /(phone|smartphone|celular|computer|laptop|technology|tecnologia|digital|app\b|network|internet|data|code|screen|pantalla)/,
      rechazar: /(circuit board unrelated)/ },
];
const RE_LUGAR = /\b(charles de gaulle|los mina|invivienda|sabana perdida|ensanche ozama|villa mella|santo domingo este|sde|san isidro|los trinitarios|carretera mella|boca chica|santo domingo)\b/;

// ── Contexto de la nota ──────────────────────────────────────────────────
const args_enlace = a => String((a && a.enlaceFuente) || '');
function contextoImagen({ titulo, contenido = '', categoria = 'Nacionales' } = {}) {
    const tituloLimpio = jefe.limpiarTituloEstricto(titulo, { contenido, categoria });      // JAMÁS llega basura al buscador
    const txt = norm(`${tituloLimpio} ${String(contenido).slice(0, 500)}`);
    const tit = norm(tituloLimpio);
    // El tema gobernante es el que más aparece; el titular pesa el doble
    let mejor = null, mejorN = 0;
    for (const t of TEMAS) {
        const n = (txt.match(new RegExp(t.re.source, 'g')) || []).length + (tit.match(new RegExp(t.re.source, 'g')) || []).length;
        if (n > mejorN) { mejor = t; mejorN = n; }
    }
    const lugar = (txt.match(RE_LUGAR) || [])[0] || null;
    const consulta = [mejor?.consulta, lugar ? `${lugar} Dominican Republic` : null].filter(Boolean).join(' ').trim()
        || `${tituloLimpio} Santo Domingo Dominican Republic`;
    let fuenteHost = ''; try { fuenteHost = new URL(args_enlace(arguments[0])).hostname.replace(/^www\./, ''); } catch {}
    return { tituloLimpio, tema: mejor, lugar, consulta, fuenteHost };
}

// ── Validación de la foto devuelta ───────────────────────────────────────
function metadatosDe(img = {}) {
    const crudo = [img.nombre, img.urlOriginal, img.paginaFuente, img.credito, img.contextoGeo, img.descripcion, img.alt, img.fuente]
        .filter(Boolean).map(String).join(' ');
    let dec = crudo; try { dec = decodeURIComponent(crudo); } catch {}
    return norm(dec).replace(/[_\-/.+%?=&]+/g, ' ').replace(/\s+/g, ' ');
}

function validarImagen(img, ctx) {
    const meta = metadatosDe(img);
    if (!img || !(img.urlFinal || img.url)) return { ok: false, motivo: 'sin_imagen', puntos: 0 };
    // La foto que viene de la propia página de la noticia (og:image del enlace fuente) es coherente por definición
    if (ctx.fuenteHost && norm(`${img.paginaFuente || ''} ${img.urlOriginal || ''}`).includes(ctx.fuenteHost.toLowerCase())) return { ok: true, motivo: 'imagen_de_la_fuente', puntos: 5, tema: ctx.tema?.id || null };
    if (!ctx.tema) {                                                   // sin tema claro: exige al menos geografía RD o una palabra del titular
        const toks = norm(ctx.tituloLimpio).split(/\W+/).filter(w => w.length >= 5);
        const k = toks.filter(w => meta.includes(w)).length;
        const geo = /(dominican|dominicana|santo domingo|caribe|caribbean)/.test(meta);
        return { ok: k >= 1 || geo, motivo: k || geo ? 'coincide' : 'sin_coincidencia_ni_geografia', puntos: k + (geo ? 2 : 0), tema: null };
    }
    if (ctx.tema.rechazar.test(meta)) return { ok: false, motivo: `contradice_${ctx.tema.id}`, puntos: 0, tema: ctx.tema.id };
    const acepta = ctx.tema.aceptar.test(meta);
    const geo = /(dominican|dominicana|santo domingo|caribe|caribbean)/.test(meta);
    if (meta.length < 15) return { ok: false, motivo: 'metadatos_insuficientes', puntos: 0, tema: ctx.tema.id };   // no verificable → no se publica a ciegas
    return { ok: acepta, motivo: acepta ? 'coincide' : `no_refleja_${ctx.tema.id}`, puntos: (acepta ? 2 : 0) + (geo ? 1 : 0), tema: ctx.tema.id };
}

// ── Orquestación ─────────────────────────────────────────────────────────
/**
 * @param obtener  la función obtenerImagenSegura de lib/imagenes
 * @param args     { titulo, contenido, categoria, subtema, personaQuery, enlaceFuente, comunicado }
 */
async function obtenerImagenContextual(obtener, args = {}) {
    const estricta = process.env.IMAGEN_ESTRICTA !== '0';
    const ctx = contextoImagen(args);
    const intentos = [{ ...args, titulo: ctx.tituloLimpio }];
    // 2.º intento: titular reemplazado por una consulta orientada al contexto (solo para BUSCAR; el titular publicado no cambia)
    if (!args.personaQuery) intentos.push({ ...args, titulo: ctx.consulta, comunicado: '', enlaceFuente: '' });

    let mejor = null, ultimoError = null;
    for (const [i, a] of intentos.entries()) {
        try {
            const img = await obtener(a);
            const v = validarImagen(img, ctx);
            if (!mejor || v.puntos > mejor.v.puntos) mejor = { img, v };
            if (v.ok || args.personaQuery) {                           // retratos de personas ya vienen por búsqueda dirigida
                return { ...img, validacion: { ...v, intento: i + 1, tema: ctx.tema?.id || null, lugar: ctx.lugar } };
            }
            console.warn(`🖼️ [imagen] intento ${i + 1} fuera de contexto (${v.motivo}) para "${ctx.tituloLimpio.slice(0, 60)}"`);
        } catch (e) { ultimoError = e; console.warn(`🖼️ [imagen] intento ${i + 1} falló: ${e.message}`); }
    }
    const fallback = process.env.IMAGEN_FALLBACK_URL;
    if (estricta && fallback) {
        return { urlFinal: fallback, urlOriginal: fallback, nombre: 'imagen-de-marca', fuente: 'marca', licencia: null, credito: 'El Farol al Día', paginaFuente: null,
                 validacion: { ok: false, motivo: 'fuera_de_contexto_usa_marca', tema: ctx.tema?.id || null, lugar: ctx.lugar } };
    }
    if (mejor) return { ...mejor.img, validacion: { ...mejor.v, tema: ctx.tema?.id || null, lugar: ctx.lugar, advertencia: 'sin_coincidencia_de_contexto' } };
    throw ultimoError || new Error('No se obtuvo imagen');
}

module.exports = { obtenerImagenContextual, contextoImagen, validarImagen };
