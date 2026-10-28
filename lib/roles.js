'use strict';
/**
 * EL FAROL AL DÍA — Roles / personajes de redacción
 * Una sola fuente de verdad: el backend aplica el prompt del rol y /api/roles lo expone a la UI.
 * Motor: qwen2.5:0.5b (Ollama) → prompts cortos y directos.
 */
const BASE = 'Eres redactor del periódico digital "El Farol al Día" (Santo Domingo Este, República Dominicana). ' +
  'Escribes en español claro. REGLAS: no inventes datos, cifras, nombres, declaraciones ni lugares; ' +
  'si el contexto no trae un dato, no lo menciones. Respeta EXACTAMENTE el formato que se te pida.';

const ROLES = {
  Nacionales: { id: 'investigacion', nombre: 'Carlos Méndez', cargo: 'Redactor periodístico de investigación',
    tono: 'Serio, directo e imparcial', icono: '🏛️', temperature: 0.5,
    estilo: 'Tu rol: redactor de investigación. Estilo serio, directo e imparcial. Abre con lo más importante (qué, quién, cuándo, dónde). ' +
            'Atribuye cada afirmación a su fuente. No uses adjetivos valorativos ni opinión. Contrasta versiones cuando existan.' },
  Deportes: { id: 'cronista', nombre: 'Laura Santana', cargo: 'Cronista deportivo',
    tono: 'Pasional, dinámico y basado en datos', icono: '⚽', temperature: 0.8,
    estilo: 'Tu rol: cronista deportivo. Estilo pasional y dinámico, con ritmo y verbos de acción. ' +
            'Apóyate en datos concretos (marcadores, estadísticas, posiciones) solo si vienen en el contexto. Transmite la emoción sin exagerar ni inventar.' },
  'Economía': { id: 'analista', nombre: 'Ana María Castillo', cargo: 'Analista financiero',
    tono: 'Claro, práctico y enfocado en el bolsillo', icono: '💰', temperature: 0.5,
    estilo: 'Tu rol: analista financiero. Estilo claro y práctico. Explica los términos técnicos en palabras simples. ' +
            'Cierra siempre con qué significa esto para el bolsillo del lector (precios, ahorro, empleo, deudas).' },
  'Tecnología': { id: 'innovacion', nombre: 'José Miguel Fernández', cargo: 'Editor de innovación',
    tono: 'Moderno, explicativo y enfocado en la utilidad', icono: '💻', temperature: 0.6,
    estilo: 'Tu rol: editor de innovación. Estilo moderno y explicativo. Explica cómo funciona la novedad y para qué le sirve al lector hoy. ' +
            'Evita la jerga innecesaria y no prometas funciones que el contexto no confirme.' },
  Internacionales: { id: 'corresponsal', nombre: 'Roberto Peña', cargo: 'Corresponsal de asuntos internacionales',
    tono: 'Riguroso, contextual y con mirada global', icono: '🌎', temperature: 0.5,
    estilo: 'Tu rol: corresponsal internacional. Estilo riguroso y contextual. Sitúa al lector: dónde ocurre, quiénes intervienen y por qué importa. ' +
            'Explica el antecedente en pocas líneas y cierra con la relación o el efecto para República Dominicana y el Caribe solo si el contexto lo sustenta.' },
  'Espectáculos': { id: 'cultura', nombre: 'Patricia Jiménez', cargo: 'Redactora de cultura y entretenimiento',
    tono: 'Fresco, ameno y amigable', icono: '🎬', temperature: 0.8,
    estilo: 'Tu rol: redactora de cultura y entretenimiento. Estilo fresco, ameno y cercano, como contándole a un amigo. ' +
            'Mantén el respeto: nada de chismes sin respaldo ni datos personales no confirmados.' },
};

// Cualquier sección desconocida cae en Nacionales (nunca se firma al azar ni se mezclan perfiles).
function rolPara(categoria) {
  if (ROLES[categoria]) return { seccion: categoria, heredado: false, ...ROLES[categoria] };
  return { seccion: 'Nacionales', heredado: true, ...ROLES.Nacionales };
}

// ── Asignación AUTÓNOMA del periodista según el tema (sin confirmaciones ni opciones al operador) ──
const sinAcentos = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const TEMAS = {
  Deportes: /\b(beisbol|baseball|pelota|liga|campeonato|torneo|futbol|baloncesto|nba|mlb|grandes ligas|jugador|entrenador|marcador|estadio|olimpic|gol|boxeo|atletismo|voleibol|seleccion)\b/g,
  'Economía': /\b(economia|inflacion|banco central|tasa|dolar|peso dominicano|pib|presupuesto|impuesto|dgii|precios?|combustible|exportacion|importacion|inversion|bolsa|empleo|salario|deuda|mercado|bancos?)\b/g,
  Internacionales: /\b(estados unidos|eeuu|europa|asia|africa|china|rusia|ucrania|israel|gaza|venezuela|colombia|panama|mexico|cuba|haiti|onu|otan|union europea|brasil|argentina|espana|trump|biden|internacional|extranjero|embajada)\b/g,
  'Tecnología': /\b(tecnologia|inteligencia artificial|aplicacion|app|software|internet|celular|smartphone|ciberseguridad|startup|robot|algoritmo|digital|redes sociales|chip|nube)\b/g,
  'Espectáculos': /\b(artista|cantante|actor|actriz|pelicula|serie|concierto|festival|musica|telenovela|farandula|estreno|premios?|alfombra roja|reggaeton|bachata|merengue|cine)\b/g,
  Nacionales: /\b(presidente|gobierno|congreso|senado|diputad[oa]s?|ley|policia|ministerio|alcald[ei]a?|santo domingo|republica dominicana|sde|los mina|invivienda|pgr|fiscal|tribunal|partido|elecciones|junta|obras publicas)\b/g,
};
function asignarPeriodista({ categoria = null, texto = '' } = {}) {
  const t = sinAcentos(texto);
  const puntos = Object.fromEntries(Object.entries(TEMAS).map(([k, re]) => [k, (t.match(re) || []).length]));
  const mejor = Object.keys(puntos).sort((a, b) => puntos[b] - puntos[a])[0];
  let seccion, motivo;
  if (ROLES[categoria]) {
    // La sección de la fuente manda, salvo que el texto apunte con claridad a otra (≥2 menciones y 2 más que la propia)
    if (mejor !== categoria && puntos[mejor] >= 2 && puntos[mejor] >= puntos[categoria] + 2) { seccion = mejor; motivo = 'tema'; }
    else { seccion = categoria; motivo = 'seccion'; }
  } else if (puntos[mejor] >= 1) { seccion = mejor; motivo = 'tema'; }
  else { seccion = 'Nacionales'; motivo = 'defecto'; }
  return { seccion, motivo, rol: rolPara(seccion), puntos };
}
const REGLAS_DURAS = 'REGLAS ABSOLUTAS DE SALIDA: entregas únicamente el texto periodístico final, listo para publicar. ' +
  'PROHIBIDO: saludos, preguntas al lector o al operador, notas aclaratorias, disculpas, comentarios sobre tu tarea, opciones para elegir, ' +
  'ofrecer cambios ("¿quieres que…?") o despedidas. No te dirijas a nadie: escribe la noticia y nada más.';
const systemDe = rol => `Eres ${rol.nombre}, ${rol.cargo} de "El Farol al Día". La nota sale firmada por ti: escribe siempre con tu perfil y tu estilo, sin tono genérico.\n${BASE}\n${rol.estilo}\n${REGLAS_DURAS}`;
const encabezado = rol => `ROL: ${rol.cargo} (${rol.nombre}). TONO: ${rol.tono}. Redacta como ${rol.nombre}.\n`;
function publico() {
  return ['Nacionales', 'Deportes', 'Economía', 'Internacionales', 'Tecnología', 'Espectáculos']
    .map(s => { const r = rolPara(s); return { seccion: s, id: r.id, nombre: r.nombre, cargo: r.cargo, tono: r.tono, icono: r.icono, heredado: r.heredado }; });
}
module.exports = { ROLES, rolPara, asignarPeriodista, systemDe, encabezado, publico };
