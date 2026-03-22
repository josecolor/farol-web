/**
 * 🤖 EL FAROL AL DÍA — BOT DE INGENIERÍA
 * 
 * Bot Telegram independiente que monitorea el servidor 24/7
 * Corre SEPARADO del server.js — en otro proceso/servicio Railway
 * 
 * COMANDOS:
 *   /status   — estado completo del servidor
 *   /noticias — cuántas publicadas y últimas 5
 *   /rss      — procesar RSS ahora
 *   /fotos    — regenerar fotos feas ahora
 *   /salud    — diagnóstico de salud del sistema
 *   /reset    — resetear toda la BD (pide confirmación)
 *   /ayuda    — lista de comandos
 *
 * VARIABLES RAILWAY (servicio bot):
 *   BOT_TOKEN       = token del bot de Telegram
 *   CHAT_ID         = tu chat ID personal
 *   SERVER_URL      = https://elfarolaldia.com
 *   SERVER_PIN      = 311
 *   CHECK_INTERVAL  = 300000 (5 min, por defecto)
 */

'use strict';

const BOT_TOKEN      = process.env.BOT_TOKEN;
const CHAT_ID        = process.env.CHAT_ID;
const SERVER_URL     = (process.env.SERVER_URL || 'https://elfarolaldia.com').replace(/\/$/, '');
const SERVER_PIN     = process.env.SERVER_PIN || '311';
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || '300000'); // 5 min

if (!BOT_TOKEN) { console.error('[FATAL] BOT_TOKEN requerido'); process.exit(1); }
if (!CHAT_ID)   { console.error('[FATAL] CHAT_ID requerido');   process.exit(1); }

// ─── ESTADO INTERNO ───────────────────────────────────────────────────────────
const ESTADO = {
    ultimoOffset:       0,
    servidorCaido:      false,
    versionAnterior:    null,
    noticiasAnterior:   0,
    ultimaAlerta:       {},       // { tipo: timestamp } — evitar spam
    esperandoConfirm:   null,     // comando pendiente de confirmación
    arranque:           Date.now(),
};

// ─── TELEGRAM API ─────────────────────────────────────────────────────────────
async function tg(method, body = {}) {
    try {
        const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
        });
        return await r.json();
    } catch (e) {
        console.error(`[TG] Error en ${method}: ${e.message}`);
        return null;
    }
}

async function enviar(texto, extra = {}) {
    return tg('sendMessage', {
        chat_id:    CHAT_ID,
        text:       texto,
        parse_mode: 'Markdown',
        ...extra,
    });
}

async function enviarAlerta(tipo, mensaje, cooldownMin = 30) {
    const ahora    = Date.now();
    const ultimaVez = ESTADO.ultimaAlerta[tipo] || 0;
    const cooldown  = cooldownMin * 60 * 1000;

    if (ahora - ultimaVez < cooldown) return; // no spamear
    ESTADO.ultimaAlerta[tipo] = ahora;
    await enviar(`⚠️ *ALERTA — EL FAROL AL DÍA*\n\n${mensaje}`);
}

// ─── LLAMADAS AL SERVIDOR ─────────────────────────────────────────────────────
async function llamarServidor(endpoint, method = 'GET', body = null) {
    try {
        const opts = {
            method,
            headers: {
                'Content-Type':  'application/json',
                'Authorization': 'Basic ' + Buffer.from(`director:${SERVER_PIN}`).toString('base64'),
            },
        };
        if (body) opts.body = JSON.stringify(body);

        const ctrl = new AbortController();
        const tm   = setTimeout(() => ctrl.abort(), 10000);
        const r    = await fetch(`${SERVER_URL}${endpoint}`, { ...opts, signal: ctrl.signal })
                          .finally(() => clearTimeout(tm));
        return await r.json();
    } catch (e) {
        return { error: e.message, success: false };
    }
}

// ─── MONITOREO AUTOMÁTICO ─────────────────────────────────────────────────────
async function monitorear() {
    try {
        const status = await llamarServidor('/status');

        // Servidor caído
        if (status.error || !status.version) {
            if (!ESTADO.servidorCaido) {
                ESTADO.servidorCaido = true;
                await enviarAlerta('servidor_caido',
                    `🔴 *Servidor caído o sin respuesta*\n\`${SERVER_URL}/status\`\nError: ${status.error || 'Sin respuesta'}`
                , 15);
            }
            return;
        }

        // Servidor recuperado
        if (ESTADO.servidorCaido) {
            ESTADO.servidorCaido = false;
            await enviar(`✅ *Servidor recuperado*\nV${status.version} — ${status.noticias} noticias`);
        }

        // Nueva versión desplegada
        if (ESTADO.versionAnterior && ESTADO.versionAnterior !== status.version) {
            await enviar(`🚀 *Nueva versión desplegada*\n${ESTADO.versionAnterior} → *V${status.version}*`);
        }
        ESTADO.versionAnterior = status.version;

        // Salud del sistema
        const salud = status.salud || {};

        // Gemini con errores
        if (salud.errores_gemini >= 3) {
            await enviarAlerta('gemini_errores',
                `🤖 *Gemini con ${salud.errores_gemini} errores seguidos*\nEl sistema intentará resetear las keys automáticamente.`
            , 60);
        }

        // Sin publicar hace mucho
        if (salud.min_sin_publicar > 90) {
            await enviarAlerta('sin_publicar',
                `📰 *Sin publicar hace ${salud.min_sin_publicar} minutos*\nEl sistema intentará forzar un ciclo RSS.`
            , 60);
        }

        // Pocas noticias — puede que se hayan borrado
        if (status.noticias < 5 && ESTADO.noticiasAnterior > 10) {
            await enviarAlerta('pocas_noticias',
                `📉 *Solo ${status.noticias} noticias en la BD*\nAntes había ${ESTADO.noticiasAnterior}. ¿Se borró algo?`
            , 120);
        }
        ESTADO.noticiasAnterior = status.noticias;

        // Fotos feas detectadas por el auto-diagnóstico
        if (salud.ciclos_rss_vacios >= 4) {
            await enviarAlerta('rss_vacio',
                `📡 *RSS vacío ${salud.ciclos_rss_vacios} ciclos seguidos*\nPosible bloqueo de fuentes RSS.`
            , 120);
        }

        console.log(`[Monitor] ✅ V${status.version} — ${status.noticias} noticias — Gemini: ${salud.errores_gemini || 0} err — Sin publicar: ${salud.min_sin_publicar || 0}min`);

    } catch (e) {
        console.error('[Monitor] Error:', e.message);
    }
}

// ─── PROCESADOR DE COMANDOS ───────────────────────────────────────────────────
async function procesarComando(msg) {
    const texto = msg.text?.trim() || '';
    const chat  = msg.chat?.id?.toString();

    if (chat !== CHAT_ID) return; // Solo tú puedes controlarlo

    console.log(`[Cmd] ${texto}`);

    // Confirmación de reset
    if (ESTADO.esperandoConfirm === 'reset') {
        ESTADO.esperandoConfirm = null;
        if (texto.toLowerCase() === 'si') {
            await enviar('⏳ Reseteando BD...');
            const r = await llamarServidor('/api/resetear-todo', 'POST', { pin: SERVER_PIN });
            await enviar(r.success
                ? '✅ *BD reseteada completamente*\nEl servidor publicará noticias nuevas en el próximo ciclo.'
                : `❌ Error: ${r.error}`
            );
        } else {
            await enviar('❌ Reset cancelado.');
        }
        return;
    }

    const cmd = texto.split(' ')[0].toLowerCase();

    switch (cmd) {

        case '/status':
        case '/s': {
            const d = await llamarServidor('/status');
            if (d.error) { await enviar(`❌ Servidor no responde: ${d.error}`); break; }
            const salud = d.salud || {};
            const uptime = Math.round((Date.now() - ESTADO.arranque) / 3600000);
            await enviar(
                `🏮 *EL FAROL AL DÍA — V${d.version}*\n\n` +
                `📰 Noticias: *${d.noticias}*\n` +
                `📡 RSS procesados: ${d.rss_procesados}\n` +
                `🤖 Modelo: ${d.modelo_gemini}\n` +
                `🔑 Gemini keys: ${d.gemini_keys}\n` +
                `🖼️ Watermark: ${d.marca_de_agua?.includes('Activa') ? '✅' : '⚠️'}\n` +
                `🌐 Google CSE: ${d.google_cse === 'Activo' ? '✅' : '⏳ Pendiente'}\n` +
                `⚙️ IA activa: ${d.ia_activa ? '✅' : '❌'}\n` +
                `📊 RSS en proceso: ${d.rss_en_proceso ? '⏳' : '✅ Libre'}\n\n` +
                `*SALUD:*\n` +
                `├ Errores Gemini: ${salud.errores_gemini || 0}\n` +
                `├ Errores imagen: ${salud.errores_imagen || 0}\n` +
                `├ RSS vacíos: ${salud.ciclos_rss_vacios || 0}\n` +
                `└ Sin publicar: ${salud.min_sin_publicar || 0} min\n\n` +
                `🤖 Bot uptime: ${uptime}h`
            );
            break;
        }

        case '/noticias':
        case '/n': {
            const est = await llamarServidor('/api/estadisticas');
            const not = await llamarServidor('/api/noticias');
            if (!not.noticias) { await enviar('❌ No se pudo obtener noticias'); break; }
            const ultimas = not.noticias.slice(0, 5);
            let txt = `📰 *${est.totalNoticias} noticias | ${est.totalVistas} vistas*\n\n*Últimas 5:*\n`;
            ultimas.forEach((n, i) => {
                const fecha = new Date(n.fecha).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
                txt += `${i+1}. [${n.titulo.substring(0,45)}](${SERVER_URL}/noticia/${n.slug})\n   _${n.seccion} · ${fecha}_\n`;
            });
            await enviar(txt);
            break;
        }

        case '/rss':
        case '/r': {
            await enviar('📡 Iniciando ciclo RSS...');
            const r = await llamarServidor('/api/procesar-rss', 'POST', { pin: SERVER_PIN });
            await enviar(r.success ? '✅ RSS procesándose en background' : `❌ ${r.error}`);
            break;
        }

        case '/fotos':
        case '/f': {
            await enviar('🖼️ Iniciando regeneración de fotos feas...');
            const r = await llamarServidor('/api/regenerar-fotos', 'POST', { pin: SERVER_PIN });
            await enviar(r.success ? '✅ Regeneración iniciada en background' : `❌ ${r.mensaje || r.error}`);
            break;
        }

        case '/generar':
        case '/g': {
            const cat = texto.split(' ')[1] || 'Nacionales';
            const cats = ['Nacionales','Deportes','Internacionales','Economia','Tecnologia','Espectaculos'];
            if (!cats.includes(cat)) {
                await enviar(`❌ Categoría inválida\nOpciones: ${cats.join(', ')}`);
                break;
            }
            await enviar(`🚀 Generando noticia de *${cat}*...`);
            const r = await llamarServidor('/api/generar-noticia', 'POST', { categoria: cat });
            await enviar(r.success
                ? `✅ *Publicada:* ${r.titulo}\n[Ver noticia](${SERVER_URL}/noticia/${r.slug})`
                : `❌ ${r.error}`
            );
            break;
        }

        case '/salud':
        case '/dx': {
            const d = await llamarServidor('/status');
            if (!d.salud) { await enviar('❌ Sin datos de salud'); break; }
            const s = d.salud;
            const items = [
                s.errores_gemini > 0     ? `⚠️ Gemini: ${s.errores_gemini} errores` : '✅ Gemini OK',
                s.errores_imagen > 0     ? `⚠️ Imágenes: ${s.errores_imagen} fallos` : '✅ Imágenes OK',
                s.ciclos_rss_vacios > 0  ? `⚠️ RSS vacío: ${s.ciclos_rss_vacios} ciclos` : '✅ RSS OK',
                s.min_sin_publicar > 60  ? `⚠️ Sin publicar: ${s.min_sin_publicar}min` : '✅ Publicando OK',
            ];
            await enviar(`🩺 *Diagnóstico del sistema:*\n\n${items.join('\n')}`);
            break;
        }

        case '/reset': {
            ESTADO.esperandoConfirm = 'reset';
            await enviar(
                `⚠️ *¿Confirmas RESETEAR toda la BD?*\n\n` +
                `Esto borrará:\n• Todas las noticias\n• Todos los RSS procesados\n• Todos los comentarios\n\n` +
                `Escribe *si* para confirmar o cualquier otra cosa para cancelar.`
            );
            break;
        }

        case '/ia': {
            const accion = texto.split(' ')[1];
            if (accion === 'on' || accion === 'off') {
                const r = await llamarServidor('/api/admin/config', 'POST', {
                    pin: SERVER_PIN, enabled: accion === 'on'
                });
                await enviar(r.success
                    ? `✅ IA ${accion === 'on' ? 'activada' : 'desactivada'}`
                    : `❌ ${r.error}`
                );
            } else {
                await enviar('Uso: /ia on | /ia off');
            }
            break;
        }

        case '/ayuda':
        case '/help':
        case '/h': {
            await enviar(
                `🤖 *BOT DE INGENIERÍA — EL FAROL AL DÍA*\n\n` +
                `*Monitoreo:*\n` +
                `/status — estado completo del servidor\n` +
                `/salud — diagnóstico de salud\n` +
                `/noticias — últimas 5 publicadas\n\n` +
                `*Acciones:*\n` +
                `/rss — procesar RSS ahora\n` +
                `/fotos — regenerar fotos feas\n` +
                `/generar [cat] — publicar noticia\n` +
                `/ia on|off — activar/desactivar IA\n\n` +
                `*Peligroso:*\n` +
                `/reset — borrar toda la BD\n\n` +
                `_Alertas automáticas cada ${Math.round(CHECK_INTERVAL/60000)} min_`
            );
            break;
        }

        default: {
            if (texto.startsWith('/')) {
                await enviar(`❓ Comando desconocido. Usa /ayuda para ver los disponibles.`);
            }
        }
    }
}

// ─── POLLING DE TELEGRAM ──────────────────────────────────────────────────────
async function polling() {
    try {
        const r = await tg('getUpdates', {
            offset:          ESTADO.ultimoOffset + 1,
            timeout:         30,
            allowed_updates: ['message'],
        });

        if (r?.result?.length) {
            for (const update of r.result) {
                ESTADO.ultimoOffset = update.update_id;
                if (update.message) {
                    await procesarComando(update.message).catch(e =>
                        console.error('[Cmd] Error:', e.message)
                    );
                }
            }
        }
    } catch (e) {
        console.error('[Polling] Error:', e.message);
    }

    // Continuar polling
    setTimeout(polling, 1000);
}

// ─── ARRANQUE ─────────────────────────────────────────────────────────────────
async function iniciar() {
    console.log(`
╔══════════════════════════════════════════╗
║  🤖  BOT DE INGENIERÍA — EL FAROL AL DÍA ║
╠══════════════════════════════════════════╣
║  Server : ${SERVER_URL.padEnd(30)}║
║  Monitor: cada ${String(Math.round(CHECK_INTERVAL/60000)+' min').padEnd(25)}║
╚══════════════════════════════════════════╝`);

    // Mensaje de inicio
    await enviar(
        `🤖 *Bot de Ingeniería iniciado*\n\n` +
        `📡 Monitoreando: ${SERVER_URL}\n` +
        `⏱️ Intervalo: cada ${Math.round(CHECK_INTERVAL/60000)} minutos\n\n` +
        `Usa /ayuda para ver los comandos disponibles.`
    );

    // Primer chequeo inmediato
    await monitorear();

    // Monitoreo periódico
    setInterval(monitorear, CHECK_INTERVAL);

    // Polling de comandos
    polling();
}

iniciar().catch(e => {
    console.error('[FATAL]', e.message);
    process.exit(1);
});
