'use strict';
/**
 * EL FAROL AL DÍA — Curador autónomo de contenidos
 *
 *  1) FILTRO DE IMPACTO: puntúa cada noticia candidata (0-100) por conexión local (SDE), impacto social,
 *     economía cotidiana, seguridad, servicios e interés general. Descarta relleno y repetidos.
 *  2) CONTROL DE FRECUENCIA: intervalo dinámico entre publicaciones (más corto en horas pico, más largo
 *     en valle, topes por hora y por día, sin madrugada). Una sola publicación por vuelta: nunca ráfagas.
 *  3) TENDENCIAS + GSC: sube el puntaje de lo que la gente ya busca (consultas, oportunidades y ganadoras
 *     de Search Console), de lo que varias fuentes cubren a la vez y de lo que mejor rinde en el propio portal.
 *
 *  crearCurador(deps) → { tick, estado, refrescar }      (orquestador, usa la BD y el generador existentes)
 *  puntuarImpacto, evaluarFrecuencia, evaluarGenerada    (funciones puras, testeables)
 *
 *  Todo se ajusta con variables de entorno CURADOR_* (ver cfg()).
 */
const roles = require('./roles');

const TZ = 'America/Santo_Domingo';
const PICOS_DEFECTO = [7, 12, 18, 20];                     // hora local RD, solo mientras no hay datos propios

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const num = (k, d) => { const n = parseFloat(env(k, d)); return Number.isFinite(n) ? n : d; };
const cfg = () => ({
    activo:         env('CURADOR_ACTIVO', '1') !== '0',
    minScore:       num('CURADOR_MIN_SCORE', 35),           // umbral de impacto (±5 según pico/valle)
    intervaloBase:  num('CURADOR_INTERVALO_MIN', 40),       // minutos entre notas (se ajusta por hora y por impacto)
    maxDia:         num('CURADOR_MAX_DIA', 14),             // tope en 24 h móviles
    maxHora:        num('CURADOR_MAX_HORA', 2),             // tope en 60 min móviles
    horaInicio:     num('CURADOR_HORA_INICIO', 6),          // hora local RD (sin madrugada)
    horaFin:        num('CURADOR_HORA_FIN', 23),
    edadMaxH:       num('CURADOR_EDAD_MAX_H', 36),          // una nota de fuente más vieja se descarta
    refrescoMin:    num('CURADOR_REFRESCO_MIN', 30),        // cada cuánto se vuelven a leer los RSS
    libre:          env('CURADOR_GENERACION_LIBRE', '1') !== '0',   // generar sin fuente cuando no hay candidatas
    libreEsperaMin: num('CURADOR_LIBRE_ESPERA_MIN', 180),   // minutos sin publicar antes de recurrir a generación libre
    dbTz:           env('FECHA_DB_TZ', 'UTC'),              // zona en la que se guarda noticias.fecha
});

// ── Texto ────────────────────────────────────────────────────────────────
const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const STOP = new Set(('el la los las un una unos unas de del al y e o u a en con por para sobre entre desde hasta que se su sus es son fue ser ha han hay como mas pero sin este esta estos estas ese esa eso lo le les ya muy tras ante bajo segun tambien cuando donde quien cual cuyo asi solo nuevo nueva dice dijo ayer hoy mientras durante luego aunque porque ademas todos todas otro otra otros otras').split(' '));
const stem = w => (w.length > 5 && w.endsWith('es') ? w.slice(0, -2) : w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
const tokens = t => new Set(norm(t).replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w)).map(stem));
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const w of a) if (b.has(w)) i++; return i / (a.size + b.size - i); };
const contencion = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const w of a) if (b.has(w)) i++; return i / Math.min(a.size, b.size); };
const limpiarHTML = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&quot;|&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();

// ── Léxico de impacto (sobre texto sin acentos y en minúscula) ───────────
const RE = {
    local:    /\b(santo domingo este|sde|los mina|invivienda|ensanche ozama|sabana perdida|villa mella|charles de gaulle|los trinitarios|carretera mella|san isidro|mendoza|el almirante|boca chica|guerra|ciudad juan bosch|autopista las americas|san vicente de paul|ozama)\b/g,
    rd:       /\b(republica dominicana|dominican[oa]s?|santo domingo|distrito nacional|dgii|edeeste|edesur|edenorte|inapa|caasd|intrant|metro de santo domingo|senasa|pasaporte|coe|indomet|onamet|lidom|licey|aguilas cibaenas|estrellas orientales|gigantes del cibao|toros del este|leones del escogido|seleccion dominicana)\b/g,
    seguridad:/\b(policia|asalto|robo|atraco|homicidio|asesin\w*|muert[eo]s?|fallec\w*|herid\w*|accidente|incendio|balacera|arrest\w*|detenid\w*|alerta|emergencia|banda|secuestr\w*|feminicidio|choque|ahogad\w*)\b/g,
    economia: /\b(precios?|combustibles?|gasolina|gasoil|glp|dolar|tasa|tasas|inflacion|salarios?|empleos?|desempleo|canasta|alquileres?|prestamos?|impuestos?|subsidio|pensiones?|tarifas?|arroz|pollo|huevos|banco central|politica monetaria|remesas|aranceles|dgii|presupuesto)\b/g,
    servicios:/\b(agua|apagon\w*|energia|transito|trafico|carreteras?|puentes?|obras?|escuelas?|clases|hospital\w*|salud|vacuna\w*|dengue|lluvias?|huracan|tormenta|vaguada|onda tropical|basura|desalojo|viviendas?)\b/g,
    gobierno: /\b(ley|decreto|congreso|senado|diputados|gobierno|presidente|ministerio|resolucion|reforma|alcaldia|tribunal|fiscal\w*)\b/g,
    deporte:  /\b(beisbol|liga|grandes ligas|seleccion|campeonato|final|clasifico|gano|olimpic\w*|medalla)\b/g,
    frontera: /\b(haiti|haitian\w*|frontera|estados unidos|eeuu|venezuela|deportacion\w*|visas?|migracion|migrantes?)\b/g,
    urgencia: /\b(urgente|ultima hora|alerta|confirman?|anuncia\w*|oficial\w*)\b/g,
    afectados:/\b(familias|personas|ciudadanos|residentes|usuarios|estudiantes|trabajadores|comunitarios)\b/g,
    liviano:  /\b(chisme\w*|farandula|influencer\w*|tiktoker\w*|reality|miss universo|quiniela\w*|celebridad\w*|viral(es)?|polemica)\b/g,
    efemeride:/\b(dia (mundial|internacional) de|efemeride\w*|cumpleanos de)\b/g,
    basura:   /\b(horoscopo|signos? del zodiaco|patrocinado|publirreportaje|cupon\w*|descuento|oferta especial|sorteo|loteria|casino|apuesta\w*|bono de bienvenida)\b/g,
};
const cuenta = (re, t) => (t.match(re) || []).length;

// ── Puntuación de impacto ────────────────────────────────────────────────
const BASE_CAT = { Nacionales: 14, 'Economía': 14, Deportes: 10, Internacionales: 6, 'Tecnología': 6, 'Espectáculos': 6 };

/**
 * @param item { titulo, resumen, categoria, oficial?, edadH?, convergencia? }
 * @param ctx  { recientes:[{titulo,tokens,seccion,min}], gsc:{consultas:[{query,impresiones,ctr}], oportunidades:Set, ganadoras:Set},
 *               topPropios:Set(tokens), ultimasCategorias:[…] }
 * @returns    { score, razones[], descartar: null | 'relleno'|'repetida'|'vieja', similar?, gsc? }
 */
function puntuarImpacto(item, ctx = {}, c = cfg()) {
    const razones = [];
    const texto = norm(`${item.titulo} ${item.resumen || ''}`);
    const tTit = tokens(item.titulo);
    const salida = (score, descartar = null, extra = {}) => ({ score: Math.max(0, Math.min(100, Math.round(score))), razones, descartar, ...extra });

    if (cuenta(RE.basura, texto)) { razones.push('relleno comercial/azar'); return salida(0, 'relleno'); }
    if (item.edadH != null && item.edadH > c.edadMaxH) { razones.push(`fuente de hace ${Math.round(item.edadH)} h`); return salida(0, 'vieja'); }

    // Repetición contra lo ya publicado (48 h)
    let maxSim = 0, parecido = null;
    for (const r of ctx.recientes || []) {
        const sim = Math.max(jaccard(tTit, r.tokens), contencion(tTit, r.tokens) >= 0.75 && tTit.size >= 4 ? 0.6 : 0);
        if (sim > maxSim) { maxSim = sim; parecido = r.titulo; }
    }
    if (maxSim >= 0.5) { razones.push(`repite "${String(parecido).slice(0, 50)}"`); return salida(0, 'repetida', { similar: parecido }); }

    let s = BASE_CAT[item.categoria] ?? 8;

    // 1) Conexión local
    const nLocal = Math.min(2, cuenta(RE.local, texto));
    if (nLocal) { s += 14 + 8 * nLocal; razones.push(`SDE/local ×${nLocal}`); }
    else if (cuenta(RE.rd, texto)) { s += 8; razones.push('República Dominicana'); }

    // 2) Impacto social (cada grupo suma una vez)
    const grupos = [['seguridad', 15, 'seguridad'], ['economia', 15, 'economía cotidiana'], ['servicios', 15, 'servicios/clima'],
                    ['gobierno', 8, 'decisión pública'], ['frontera', 10, 'frontera/migración/EE.UU.'], ['deporte', 6, 'deporte']];
    let impacto = 0;
    for (const [k, pts, nom] of grupos) if (cuenta(RE[k], texto)) { impacto += pts; razones.push(nom); }
    s += Math.min(32, impacto);
    if (cuenta(RE.urgencia, texto)) { s += 5; razones.push('urgencia'); }
    if (cuenta(RE.afectados, texto)) { s += 4; razones.push('afecta a personas'); }
    if (/\d/.test(texto)) s += 3;
    if (item.oficial) { s += 6; razones.push('fuente oficial'); }

    // 3) Search Console: lo que ya se busca
    const gsc = ctx.gsc || { consultas: [] };
    const tRes = tokens(item.resumen || '');
    let pg = 0; const hits = [];
    for (const q of gsc.consultas || []) {
        const tq = tokens(q.query); if (!tq.size) continue;
        let inter = 0; for (const w of tq) if (tTit.has(w) || tRes.has(w)) inter++;
        const ratio = inter / tq.size;
        const ok = (tq.size >= 2 && ratio >= 0.66) || (tq.size === 1 && inter === 1 && [...tq][0].length >= 6);
        if (!ok) continue;
        const peso = Math.min(1, Math.log10((q.impresiones || 0) + 1) / 2);
        pg += 8 + 8 * peso + (gsc.oportunidades?.has(q.query) ? 4 : 0) + (gsc.ganadoras?.has(q.query) ? 3 : 0);
        hits.push(q.query);
    }
    if (pg) { s += Math.min(25, pg); razones.push(`GSC: "${hits.slice(0, 2).join('", "')}"`); }

    // 4) Tendencias: varias fuentes cubren lo mismo + lo que mejor rinde en el portal
    if (item.convergencia > 1) { s += Math.min(14, 6 * (item.convergencia - 1)); razones.push(`${item.convergencia} fuentes cubren el tema`); }
    if (ctx.topPropios?.size) { let k = 0; for (const w of tTit) if (ctx.topPropios.has(w)) k++; if (k >= 2) { s += 6; razones.push('tema que rinde en el portal'); } }

    // 5) Penalizaciones
    if (cuenta(RE.liviano, texto)) { s -= 15; razones.push('contenido liviano'); }
    if (cuenta(RE.efemeride, texto)) { s -= 10; razones.push('efeméride'); }
    if (maxSim >= 0.35) { s -= 12; razones.push('tema cercano a uno reciente'); }
    if (String(item.resumen || '').length < 40) { s -= 10; razones.push('contexto escaso'); }
    if (item.edadH != null) { if (item.edadH > 18) { s -= 10; razones.push('fuente de más de 18 h'); } else if (item.edadH < 3) s += 5; }

    // 6) Variedad de portada
    const ult = ctx.ultimasCategorias || [];
    if (ult.length >= 2 && ult[0] === item.categoria && ult[1] === item.categoria) { s -= 8; razones.push('3.ª seguida de la sección'); }
    else if (ult.length >= 4 && !ult.slice(0, 4).includes(item.categoria)) { s += 4; razones.push('sección sin cubrir hace rato'); }

    return salida(s, null, { gsc: hits });
}

// ── Frecuencia ───────────────────────────────────────────────────────────
function horaLocal(ahora = new Date()) {
    return parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: TZ }).format(ahora), 10) % 24;
}
function minutosHastaInicio(ahora, horaInicio) {
    const h = horaLocal(ahora), m = parseInt(new Intl.DateTimeFormat('en-US', { minute: 'numeric', timeZone: TZ }).format(ahora), 10);
    return ((horaInicio - h + 24) % 24) * 60 - m;
}

function evaluarFrecuencia({ ahora = new Date(), minDesdeUltima = Infinity, publicadas24h = 0, publicadas60m = 0, picos = PICOS_DEFECTO, scoreTop = 50 } = {}, c = cfg()) {
    const hora = horaLocal(ahora);
    if (hora < c.horaInicio || hora > c.horaFin) return { permitido: false, motivo: 'fuera_de_horario', esperarMin: Math.max(1, minutosHastaInicio(ahora, c.horaInicio)), hora };
    if (publicadas24h >= c.maxDia) return { permitido: false, motivo: 'tope_diario', esperarMin: 60, hora };
    if (publicadas60m >= c.maxHora) return { permitido: false, motivo: 'tope_horario', esperarMin: 30, hora };
    const pico = picos.includes(hora);
    let intervalo = c.intervaloBase * (pico ? 0.65 : 1.25);
    intervalo *= scoreTop >= 85 ? 0.5 : scoreTop >= 70 ? 0.75 : scoreTop < 50 ? 1.2 : 1;      // lo urgente sale antes, lo flojo espera
    intervalo = Math.max(12, Math.min(180, Math.round(intervalo)));
    if (minDesdeUltima < intervalo) return { permitido: false, motivo: 'intervalo', esperarMin: Math.ceil(intervalo - minDesdeUltima), intervalo, pico, hora };
    return { permitido: true, intervalo, pico, hora };
}

/** Umbral de impacto: en pico se acepta algo más; en valle solo lo mejor. */
const umbral = (c, pico) => c.minScore + (pico ? -5 : 5);

// ── Revisión de una nota ya redactada (antes de insertar) ────────────────
function evaluarGenerada({ titulo, contenido, categoria, libre }, ctx = {}, c = cfg()) {
    const r = puntuarImpacto({ titulo, resumen: String(contenido || '').slice(0, 700), categoria }, ctx, c);
    if (r.descartar === 'repetida') return { publicar: false, motivo: `repetida: ${r.razones[0]}`, score: r.score };
    if (libre && r.score < c.minScore - 10) return { publicar: false, motivo: `impacto bajo en nota libre (${r.score})`, score: r.score };
    return { publicar: true, score: r.score };
}

// ── Orquestador ──────────────────────────────────────────────────────────
/**
 * deps: { pool, fuentes, parser, generarNoticia, videoDe, llm, configIA:()=>CONFIG_IA, cats:()=>CATS, log? }
 */
function crearCurador(deps) {
    const { pool, fuentes, parser, generarNoticia, videoDe, llm } = deps;
    const estadoInt = { ocupado: false, ranking: [], candidatos: [], ultimoRefresco: 0, decisiones: [], ctx: null, fallos: new Map(), ultimoTick: null };

    const registrar = (accion, detalle = '') => {
        const e = { t: new Date().toISOString(), accion, detalle: String(detalle).slice(0, 300) };
        estadoInt.decisiones.unshift(e); estadoInt.decisiones.length = Math.min(estadoInt.decisiones.length, 60);
        console.log(`🎯 [curador] ${accion}${detalle ? ' — ' + e.detalle : ''}`);
    };

    async function contexto() {
        const c = cfg();
        const [rec, gscR, topR, picosR, cats30] = await Promise.all([
            pool.query(`SELECT titulo,seccion,EXTRACT(EPOCH FROM (NOW()-fecha))/60 AS min FROM noticias WHERE estado IN ('publicada','archivada') AND fecha>NOW()-INTERVAL '48 hours' ORDER BY fecha DESC LIMIT 150`).catch(() => ({ rows: [] })),
            pool.query(`SELECT valor FROM memoria_ia WHERE tipo='gsc_metricas' AND categoria='sistema' ORDER BY ultima_vez DESC LIMIT 1`).catch(() => ({ rows: [] })),
            pool.query(`SELECT titulo FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '7 days' ORDER BY vistas DESC LIMIT 10`).catch(() => ({ rows: [] })),
            pool.query(`SELECT EXTRACT(HOUR FROM ((fecha AT TIME ZONE $1::text) AT TIME ZONE '${TZ}'))::int AS h, ROUND(AVG(vistas)) AS p FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '14 days' GROUP BY h HAVING COUNT(*)>=2 ORDER BY p DESC LIMIT 4`, [c.dbTz]).catch(() => ({ rows: [] })),
            pool.query(`SELECT seccion,ROUND(AVG(vistas)) AS p FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '30 days' GROUP BY seccion`).catch(() => ({ rows: [] })),
        ]);
        const recientes = rec.rows.map(r => ({ titulo: r.titulo, seccion: r.seccion, min: Number(r.min), tokens: tokens(r.titulo) }));
        let gsc = { consultas: [], oportunidades: new Set(), ganadoras: new Set() };
        try {
            const d = JSON.parse(gscR.rows[0]?.valor || '{}');
            const vistos = new Set();
            for (const q of [...(d.top_consultas || []), ...(d.oportunidades || []), ...(d.ganadoras || [])]) if (q?.query && !vistos.has(q.query)) { vistos.add(q.query); gsc.consultas.push(q); }
            gsc.oportunidades = new Set((d.oportunidades || []).map(q => q.query));
            gsc.ganadoras = new Set((d.ganadoras || []).map(q => q.query));
        } catch {}
        const topPropios = new Set(); for (const r of topR.rows) for (const w of tokens(r.titulo)) topPropios.add(w);
        const propios = picosR.rows.map(r => r.h);
        const picos = propios.length >= 3 ? propios : [...new Set([...propios, ...PICOS_DEFECTO])].slice(0, 5);
        return {
            recientes, gsc, topPropios, picos,
            ultimasCategorias: recientes.slice(0, 4).map(r => r.seccion),
            minDesdeUltima: recientes.length ? recientes[0].min : Infinity,
            publicadas60m: recientes.filter(r => r.min <= 60).length,
            publicadas24h: recientes.filter(r => r.min <= 1440).length,
            vistasPorCat: Object.fromEntries(cats30.rows.map(r => [r.seccion, Number(r.p) || 0])),
        };
    }

    async function refrescar(c = cfg()) {
        const crudos = [];
        const lotes = []; for (let i = 0; i < fuentes.length; i += 6) lotes.push(fuentes.slice(i, i + 6));
        for (const lote of lotes) {
            const res = await Promise.all(lote.map(f => parser.parseURL(f.url).then(feed => ({ f, feed })).catch(() => null)));
            for (const r of res) {
                if (!r?.feed?.items?.length) continue;
                for (const item of r.feed.items.slice(0, 6)) {
                    const guid = String(item.guid || item.link || item.title || '').slice(0, 500);
                    if (!guid || !item.title) continue;
                    const resumen = limpiarHTML(item.contentSnippet || item.content || item.summary || '').slice(0, 600);
                    const pub = item.isoDate || item.pubDate ? new Date(item.isoDate || item.pubDate) : null;
                    crudos.push({
                        guid, fuente: r.f.nombre, categoria: r.f.categoria, titulo: limpiarHTML(item.title), resumen, link: item.link || '',
                        edadH: pub && !isNaN(pub) ? (Date.now() - pub.getTime()) / 3600000 : null,
                        oficial: /\.gob\.do|bancentral/i.test(r.f.url), video: videoDe ? videoDe(item) : null,
                        comunicado: [`TÍTULO: ${limpiarHTML(item.title)}`, resumen ? `RESUMEN: ${resumen}` : '', `FUENTE: ${r.f.nombre}`, item.link ? `ENLACE: ${item.link}` : ''].filter(Boolean).join('\n'),
                    });
                }
            }
        }
        // Fuera lo ya procesado o descartado
        let procesados = new Set();
        if (crudos.length) {
            const r = await pool.query('SELECT item_guid FROM rss_procesados WHERE item_guid = ANY($1)', [crudos.map(x => x.guid)]).catch(() => ({ rows: [] }));
            procesados = new Set(r.rows.map(x => x.item_guid));
        }
        estadoInt.candidatos = crudos.filter(x => !procesados.has(x.guid));
        estadoInt.ultimoRefresco = Date.now();
        return estadoInt.candidatos.length;
    }

    /** Puntúa todos los candidatos con el contexto actual; persiste los descartes duros. */
    async function evaluarTodos(ctx, c) {
        const tit = estadoInt.candidatos.map(x => tokens(x.titulo));
        const evaluados = estadoInt.candidatos.map((x, i) => {
            // convergencia: cuántas FUENTES DISTINTAS tratan el mismo hecho
            const otras = new Set([x.fuente]);
            estadoInt.candidatos.forEach((y, j) => { if (j !== i && y.fuente !== x.fuente && jaccard(tit[i], tit[j]) >= 0.35) otras.add(y.fuente); });
            const r = puntuarImpacto({ ...x, convergencia: otras.size }, ctx, c);
            return { ...x, score: r.score, razones: r.razones, descartar: r.descartar, convergencia: otras.size };
        });
        const duros = evaluados.filter(x => x.descartar);
        if (duros.length) {
            await Promise.all(duros.map(x => pool.query('INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING', [x.guid, `DESCARTADA:${x.descartar}:${x.fuente}`.slice(0, 100)]).catch(() => {})));
            estadoInt.candidatos = estadoInt.candidatos.filter(x => !duros.some(d => d.guid === x.guid));
            registrar('descartadas', `${duros.length} (${[...new Set(duros.map(d => d.descartar))].join(', ')})`);
        }
        const ranking = evaluados.filter(x => !x.descartar).sort((a, b) => b.score - a.score);
        estadoInt.ranking = ranking.slice(0, 15).map(x => ({ titulo: x.titulo, fuente: x.fuente, categoria: x.categoria, score: x.score, razones: x.razones }));
        return ranking;
    }

    function categoriaLibre(ctx) {
        const cats = deps.cats();
        const gscTxt = ctx.gsc.consultas.map(q => q.query).join(' ');
        const pts = roles.asignarPeriodista({ texto: gscTxt }).puntos;
        const maxP = Math.max(1, ...Object.values(ctx.vistasPorCat)), maxG = Math.max(1, ...cats.map(k => pts[k] || 0));
        const recientes2 = ctx.ultimasCategorias.slice(0, 2);
        return cats.map(k => ({ k, s: 50 * ((ctx.vistasPorCat[k] || 0) / maxP) + 50 * ((pts[k] || 0) / maxG) - (recientes2.includes(k) ? 40 : 0) }))
                   .sort((a, b) => b.s - a.s)[0].k;
    }

    /** Hook que generarNoticia ejecuta con la nota ya redactada, antes de insertarla. */
    async function evaluarAntes(nota) {
        const ctx = await contexto();
        const ev = evaluarGenerada(nota, ctx, cfg());
        if (!ev.publicar) registrar('nota_descartada', `"${String(nota.titulo).slice(0, 60)}" — ${ev.motivo}`);
        return ev;
    }

    async function tick({ forzar = false } = {}) {
        const c = cfg();
        estadoInt.ultimoTick = new Date().toISOString();
        if (!c.activo) return { accion: 'curador_desactivado' };
        if (!deps.configIA().enabled) return { accion: 'ia_desactivada' };
        if (estadoInt.ocupado) return { accion: 'ocupado' };
        if (!llm.disponible()) { registrar('espera', 'Ollama no disponible (circuito abierto)'); return { accion: 'llm_no_disponible' }; }
        estadoInt.ocupado = true;
        try {
            const ctx = await contexto(); estadoInt.ctx = ctx;
            // Barrera barata antes de tocar la red: horario, topes e intervalo mínimo absoluto
            const previo = evaluarFrecuencia({ minDesdeUltima: ctx.minDesdeUltima, publicadas24h: ctx.publicadas24h, publicadas60m: ctx.publicadas60m, picos: ctx.picos, scoreTop: 85 }, c);
            if (!forzar && !previo.permitido) return { accion: 'espera', motivo: previo.motivo, esperarMin: previo.esperarMin };

            if (forzar || !estadoInt.candidatos.length || Date.now() - estadoInt.ultimoRefresco > c.refrescoMin * 60000) {
                const n = await refrescar(c); registrar('rss_leido', `${n} candidatas nuevas`);
            }
            const ranking = await evaluarTodos(ctx, c);
            const top = ranking[0];
            const pico = ctx.picos.includes(horaLocal());
            const frec = evaluarFrecuencia({ minDesdeUltima: ctx.minDesdeUltima, publicadas24h: ctx.publicadas24h, publicadas60m: ctx.publicadas60m, picos: ctx.picos, scoreTop: top?.score ?? 50 }, c);
            if (!forzar && !frec.permitido) return { accion: 'espera', motivo: frec.motivo, esperarMin: frec.esperarMin, intervalo: frec.intervalo };

            if (top && top.score >= umbral(c, pico)) {
                registrar('publicar', `[${top.score}] ${top.titulo.slice(0, 70)} — ${top.fuente} — ${top.razones.slice(0, 4).join(', ')}`);
                const r = await generarNoticia(top.categoria, top.comunicado, 1, { videoUrl: top.video, videoFuente: top.fuente, evaluarAntes });
                if (r?.success) {
                    await pool.query('INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING', [top.guid, top.fuente]).catch(() => {});
                    estadoInt.candidatos = estadoInt.candidatos.filter(x => x.guid !== top.guid);
                    return { accion: 'publicada', fuente: top.fuente, score: top.score, titulo: top.titulo };
                }
                const n = (estadoInt.fallos.get(top.guid) || 0) + 1; estadoInt.fallos.set(top.guid, n);
                if (r?.descartada || n >= 2) {
                    await pool.query('INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING', [top.guid, `DESCARTADA:${r?.descartada ? 'curador' : 'fallo_generacion'}:${top.fuente}`.slice(0, 100)]).catch(() => {});
                    estadoInt.candidatos = estadoInt.candidatos.filter(x => x.guid !== top.guid);
                }
                return { accion: 'fallo_generacion', error: r?.error };
            }

            // Sin candidata con impacto suficiente: nada de relleno. Solo tras una larga sequía se genera tema propio guiado por GSC.
            if (c.libre && ctx.minDesdeUltima >= c.libreEsperaMin) {
                const cat = categoriaLibre(ctx);
                registrar('generacion_libre', `${Math.round(ctx.minDesdeUltima)} min sin publicar → ${cat}`);
                const r = await generarNoticia(cat, null, 1, { evaluarAntes: n => evaluarAntes({ ...n, libre: true }) });
                return { accion: r?.success ? 'publicada_libre' : 'fallo_generacion', categoria: cat, error: r?.error };
            }
            registrar('sin_candidata', top ? `mejor puntaje ${top.score} < umbral ${umbral(c, pico)}` : 'sin candidatas nuevas');
            return { accion: 'sin_candidata', mejor: top ? { titulo: top.titulo, score: top.score } : null };
        } catch (e) {
            registrar('error', e.message); return { accion: 'error', error: e.message };
        } finally { estadoInt.ocupado = false; }
    }

    function estado() {
        const c = cfg(), ctx = estadoInt.ctx;
        return {
            config: c, ocupado: estadoInt.ocupado, ultimo_tick: estadoInt.ultimoTick,
            ultimo_refresco: estadoInt.ultimoRefresco ? new Date(estadoInt.ultimoRefresco).toISOString() : null,
            cadencia: ctx ? { min_desde_ultima: Math.round(ctx.minDesdeUltima), publicadas_60m: ctx.publicadas60m, publicadas_24h: ctx.publicadas24h, horas_pico_rd: ctx.picos, hora_rd: horaLocal() } : null,
            gsc_consultas: ctx ? ctx.gsc.consultas.length : null,
            candidatos: estadoInt.candidatos.length,
            ranking: estadoInt.ranking,
            decisiones: estadoInt.decisiones,
        };
    }

    return { tick, estado, refrescar, evaluarAntes };
}

module.exports = { crearCurador, puntuarImpacto, evaluarFrecuencia, evaluarGenerada, umbral, horaLocal, tokens, cfg };
