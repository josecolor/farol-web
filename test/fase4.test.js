'use strict';
/** Plan Maestro Autónomo: periodistas, redacción sin ruido, ≥900 palabras por ampliación, imagen con respaldo silencioso. */
process.env.IMG_DIR = '/tmp/efd-test-fase4'; process.env.MONGO_URL = ''; process.env.IMG_TIMEOUT_MS = '1';
process.env.LLM_BASE_URL = 'http://127.0.0.1:1'; process.env.LLM_RETRY_MS = '1';
let n = 0, fallos = 0;
const ok = (c, m) => { n++; if (c) console.log('  ✓ ' + m); else { fallos++; console.log('  ✗ ' + m); } };

(async () => {
    console.log('\nPerfiles de periodistas y asignación autónoma');
    const roles = require('../lib/roles');
    const pub = roles.publico();
    ok(new Set(pub.map(r => r.nombre)).size === pub.length && pub.every(r => !r.heredado), 'cada sección tiene periodista con nombre propio, sin perfiles heredados ni mezclados');
    ok(roles.rolPara('Internacionales').nombre === 'Roberto Peña' && roles.rolPara('Internacionales').id !== roles.rolPara('Nacionales').id, 'Internacionales tiene su propio perfil y estilo (Roberto Peña)');
    const a1 = roles.asignarPeriodista({ categoria: 'Nacionales', texto: 'El Banco Central subió la tasa; la inflación y el precio del dólar presionan el mercado y los bancos' });
    ok(a1.seccion === 'Economía' && a1.rol.nombre === 'Ana María Castillo' && a1.motivo === 'tema', 'tema económico en una fuente de Nacionales → firma la analista de Economía');
    const a2 = roles.asignarPeriodista({ categoria: 'Nacionales', texto: 'El presidente firmó la ley y el Congreso la aprobó en Santo Domingo' });
    ok(a2.seccion === 'Nacionales' && a2.rol.nombre === 'Carlos Méndez', 'tema político → Carlos Méndez');
    ok(roles.asignarPeriodista({ categoria: 'Deportes', texto: 'Mencionó al presidente una vez' }).seccion === 'Deportes', 'un solo cruce temático NO cambia la sección de la fuente');
    ok(roles.asignarPeriodista({ texto: 'Venezuela y Colombia firman acuerdo; Estados Unidos y la ONU observan' }).seccion === 'Internacionales', 'sin sección: el tema decide (Internacionales)');
    ok(roles.asignarPeriodista({}).seccion === 'Nacionales', 'sin sección ni tema → Nacionales, sin preguntar');
    const sis = roles.systemDe(roles.rolPara('Deportes'));
    ok(sis.includes('Laura Santana') && /PROHIBIDO/.test(sis) && /preguntas/.test(sis), 'el prompt de sistema asume el nombre del periodista y prohíbe preguntas/notas/saludos');

    console.log('\nRedacción sin ruido conversacional');
    const jefe = require('../lib/jefe');
    ok(/900 palabras/.test(jefe.bloqueSistema()) && /BAJADA/.test(jefe.bloqueSistema()) && /conclusi/i.test(jefe.bloqueSistema()), 'el módulo exige titular, bajada, cuerpo de 900+ palabras y conclusión');
    const sucio = 'Claro, aquí tienes la nota:\n\nTITULO: Nuevo plan de aceras en Los Mina\nBAJADA: El plan inicia en marzo. Beneficia a tres barrios del sector.\nCONTENIDO:\nPrimer párrafo con el hecho principal de la jornada.\n\nCONCLUSIÓN: Los vecinos esperan que la obra concluya pronto.\n\n---\nNota: puedo ajustar el tono si lo prefieres.\n¿Quieres que lo acorte?\nEspero que te sirva.';
    const p = jefe.parsearRespuesta(sucio);
    ok(!/claro|aqu[ií] tienes|¿quieres|espero que|nota:|puedo ajustar/i.test(p.contenido + p.tituloA), 'saludos, notas, ofertas y preguntas al operador se eliminan');
    ok(p.tituloA === 'Nuevo plan de aceras en Los Mina' && p.contenido.startsWith('El plan inicia en marzo.') && /Los vecinos esperan/.test(p.contenido) && !/CONCLUSI/i.test(p.contenido), 'bajada como copete (primer párrafo) y conclusión integrada sin rótulos');
    ok(jefe.depurarSalida('¿Por qué sube el dólar? Es la pregunta que se hacen los comerciantes en Los Mina.').texto.includes('¿Por qué sube'), 'una pregunta retórica propia de la nota NO se borra');

    console.log('\nMínimo de 900 palabras por ampliación automática');
    const { redactar, contarPalabras } = require('../lib/redaccion');
    const parrafo = i => `Párrafo ${i}: ` + 'vecinos y autoridades del sector comentaron el avance de la obra y sus efectos en la comunidad '.repeat(8);
    const base = 'TITULO: Obra vial avanza en Invivienda\nBAJADA: La obra avanza. Mejora el tránsito.\nCONTENIDO:\n' + [1, 2, 3].map(parrafo).join('\n\n');
    let llamadas = 0; const prompts = [];
    const gen = async (prompt) => { prompts.push(prompt); llamadas++; return llamadas === 1 ? base : [10 + llamadas * 3, 11 + llamadas * 3, 12 + llamadas * 3, 13 + llamadas * 3, 14 + llamadas * 3, 15 + llamadas * 3].map(parrafo).join('\n\n') + '\n\n¿Quieres que continúe?'; };
    const rol = roles.rolPara('Nacionales');
    const r = await redactar({ generar: gen, prompt: 'x', system: 's', temperature: 0.5, categoria: 'Nacionales', rol, minPalabras: 900 });
    ok(r.alcanzoMinimo && r.palabras >= 900 && r.ampliaciones >= 1 && r.ampliaciones <= 3, `una respuesta corta se amplía sola hasta ${r.palabras} palabras (${r.ampliaciones} ampliaciones)`);
    ok(!/¿Quieres/.test(r.parsed.contenido), 'las ampliaciones también salen limpias');
    ok(prompts.slice(1).every(pr => /Eres Carlos Méndez/.test(pr) && /sin saludos, sin preguntas/.test(pr)), 'las ampliaciones conservan la identidad del periodista y la prohibición');
    let k = 0; const gen2 = async () => { k++; if (k === 1) return base; throw new Error('motor caído'); };
    const r2 = await redactar({ generar: gen2, prompt: 'x', system: 's', temperature: 0.5, categoria: 'Nacionales', rol, minPalabras: 900 });
    ok(r2.palabras === contarPalabras(r2.parsed.contenido) && r2.alcanzoMinimo === false, 'si el motor falla en la ampliación NO lanza: devuelve lo redactado');

    console.log('\nImagen: respaldo silencioso');
    const { obtenerImagenSegura } = require('../lib/imagenes');
    let img, lanzo = false;
    try { img = await obtenerImagenSegura({ titulo: 'Prueba de timeout', contenido: 'x', categoria: 'Nacionales' }); } catch { lanzo = true; }
    ok(!lanzo && img && /^https?:\/\//.test(img.urlFinal) && ['marca-farol', 'respaldo-estatico'].includes(img.fuente), `timeout de imagen → respaldo por defecto sin error (${img && img.fuente})`);

    console.log(`\n${fallos ? '❌ ' + fallos + ' fallos' : '✅ ' + n + ' comprobaciones OK (plan autónomo)'}`);
    process.exit(fallos ? 1 : 0);
})();
