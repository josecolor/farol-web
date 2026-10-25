'use strict';
/**
 * EL FAROL AL DÍA — Router de texto con Llama autohospedado (Fase 2)
 * Sin API keys: habla con un servicio Ollama propio (ver llama-service/). Motor por defecto: qwen2.5:1.5b.
 *
 *  generar(prompt, opts)      → texto
 *  generarJSON(prompt, opts)  → objeto (con reparación de JSON)
 *  llamarGemini(...)          → shim compatible con el server.js actual (misma firma)
 *  disponible()               → ¿circuito cerrado y servicio sano? (para los cron)
 */
const cache = require('./cache');

const BASE      = (process.env.LLM_BASE_URL || 'http://llama.railway.internal:11434').replace(/\/$/, '');
const MODELOS   = [process.env.LLM_MODEL || 'qwen2.5:1.5b', process.env.LLM_MODEL_FALLBACK || '']
                    .filter((m, i, a) => m && a.indexOf(m) === i);
const NUM_CTX   = parseInt(process.env.LLM_NUM_CTX || '8192');
const STALL_MS  = parseInt(process.env.LLM_STALL_MS || '180000');     // sin tokens en 3 min => abortar
const TOTAL_MS  = parseInt(process.env.LLM_TOTAL_MS || '1200000');    // tope duro 20 min
const MAX_COLA  = parseInt(process.env.LLM_MAX_COLA || '6');

const SISTEMA_DEFAULT =
 'Eres redactor del periódico digital "El Farol al Día" (Santo Domingo Este, República Dominicana). ' +
 'Escribes en español neutro claro, tono periodístico cercano. REGLAS: no inventes datos, cifras, nombres, ' +
 'declaraciones ni lugares; si el contexto no trae un dato, no lo menciones. Respeta EXACTAMENTE el formato que se te pida.';

// ── Cola FIFO de concurrencia 1 (CPU: dos generaciones a la vez se estorban) ──
let _ocupado = false; const _cola = [];
function _encolar(tarea) {
    if (_cola.length >= MAX_COLA) return Promise.reject(new Error('LLM_COLA_LLENA'));
    return new Promise((ok, ko) => { _cola.push({ tarea, ok, ko }); _siguiente(); });
}
async function _siguiente() {
    if (_ocupado || !_cola.length) return;
    _ocupado = true;
    const { tarea, ok, ko } = _cola.shift();
    try { ok(await tarea()); } catch (e) { ko(e); } finally { _ocupado = false; _siguiente(); }
}

// ── Circuit breaker ────────────────────────────────────────
const cb = { fallos: 0, abiertoHasta: 0, ultimoOk: 0, ultimoError: null, modeloActivo: null, generadas: 0 };
function disponible() { return Date.now() >= cb.abiertoHasta; }
function _fallo(e) {
    cb.fallos++; cb.ultimoError = e.message;
    if (cb.fallos >= 3) { cb.abiertoHasta = Date.now() + 2 * 60 * 1000; cb.fallos = 0;
        console.warn('⛔ [llm] circuito abierto 2 min:', e.message); }
}

// ── Llamada a Ollama con streaming (detecta cuelgues sin matar generaciones lentas) ──
async function _chat(modelo, mensajes, { maxTokens, temperature, json }) {
    const ctrl = new AbortController();
    const tTotal = setTimeout(() => ctrl.abort(new Error('LLM_TIMEOUT_TOTAL')), TOTAL_MS);
    let tStall = setTimeout(() => ctrl.abort(new Error('LLM_STALL')), STALL_MS);
    const rearmar = () => { clearTimeout(tStall); tStall = setTimeout(() => ctrl.abort(new Error('LLM_STALL')), STALL_MS); };
    try {
        const res = await fetch(`${BASE}/api/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
            body: JSON.stringify({
                model: modelo, messages: mensajes, stream: true, keep_alive: '24h',
                ...(json ? { format: 'json' } : {}),
                options: { temperature, top_p: 0.9, repeat_penalty: 1.1, num_ctx: NUM_CTX, num_predict: maxTokens },
            }),
        });
        if (!res.ok) throw new Error(`LLM_HTTP_${res.status}: ${(await res.text()).slice(0, 200)}`);
        const dec = new TextDecoder(); let buf = '', texto = '';
        for await (const trozo of res.body) {
            rearmar();
            buf += dec.decode(trozo, { stream: true });
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const linea = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
                if (!linea) continue;
                const o = JSON.parse(linea);
                if (o.error) throw new Error(`LLM_ERR: ${o.error}`);
                texto += o.message?.content || '';
            }
        }
        if (!texto.trim()) throw new Error('LLM_VACIO');
        return texto.trim();
    } catch (e) {
        throw ctrl.signal.aborted && ctrl.signal.reason ? ctrl.signal.reason : e;
    } finally { clearTimeout(tTotal); clearTimeout(tStall); }
}

async function generar(prompt, { maxTokens = 2500, temperature = 0.7, system = SISTEMA_DEFAULT, json = false, retries = 2 } = {}) {
    if (!disponible()) throw new Error('LLM_CIRCUITO_ABIERTO');
    const mensajes = [{ role: 'system', content: system }, { role: 'user', content: prompt }];
    return _encolar(async () => {
        let ultimo;
        for (const modelo of MODELOS) {
            for (let i = 0; i < Math.max(1, retries); i++) {
                try {
                    const t0 = Date.now();
                    console.log(`   🦙 [llm] ${modelo} (intento ${i + 1}) ...`);
                    const txt = await _chat(modelo, mensajes, { maxTokens, temperature, json });
                    cb.fallos = 0; cb.ultimoOk = Date.now(); cb.modeloActivo = modelo; cb.generadas++;
                    console.log(`   ✅ [llm] ${txt.length} chars en ${Math.round((Date.now() - t0) / 1000)}s`);
                    return txt;
                } catch (e) {
                    ultimo = e; console.warn(`   ⚠️ [llm] ${modelo}: ${e.message}`);
                    if (/fetch failed|ECONNREFUSED|ENOTFOUND/.test(e.message)) break;   // servicio caído: no reintentar este modelo
                    await new Promise(r => setTimeout(r, 3000));
                }
            }
        }
        _fallo(ultimo); throw new Error(`Llama falló: ${ultimo?.message}`);
    });
}

// ── JSON robusto (Llama a veces envuelve en ``` o deja comas) ──
function _repararJSON(t) {
    let s = t.replace(/```json|```/gi, '').trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    s = s.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(s);
}
async function generarJSON(prompt, { cacheSeg = 0, ...opts } = {}) {
    const ejecutar = async () => {
        const t = await generar(prompt, { maxTokens: 600, temperature: 0.2, ...opts, json: true });
        return _repararJSON(t);
    };
    if (!cacheSeg) return ejecutar();
    const k = require('crypto').createHash('md5').update(prompt).digest('hex');
    return cache.wrap('llm', k, cacheSeg, ejecutar);
}

// ── Shim: mismo contrato que llamarGemini(prompt, reintentos, maxTokens) ──
async function llamarGemini(prompt, reintentos = 2, maxTokens = 8000, opts = {}) {
    // Tope de ~3500 tokens: suficiente para un artículo de ~800 palabras. opts: { system, temperature } del rol.
    return generar(prompt, { retries: reintentos, maxTokens: Math.min(maxTokens, 3500), ...opts });
}

// ── Sanidad / arranque ─────────────────────────────────────
async function estado() {
    const base = { servicio: BASE, modelos: MODELOS, cola: _cola.length, ocupado: _ocupado,
        circuito: disponible() ? 'cerrado' : 'ABIERTO', generadas: cb.generadas,
        modelo_activo: cb.modeloActivo, ultimo_ok: cb.ultimoOk ? new Date(cb.ultimoOk).toISOString() : null, ultimo_error: cb.ultimoError };
    try {
        const r = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(4000) });
        const j = await r.json();
        return { ...base, servicio_vivo: true, precalentado: _calentado, instalados: (j.models || []).map(m => m.name) };
    } catch (e) { return { ...base, servicio_vivo: false, error: e.message, diagnostico: await _diagnostico(e), precalentado: _calentado }; }
}
// ── Diagnóstico: "fetch failed" no dice nada; la causa real vive en err.cause ──
async function _diagnostico(err) {
    const code = err?.cause?.code || err?.code || '';
    let host = ''; try { host = new URL(BASE).hostname; } catch {}
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
        return `DNS no resuelve "${host}" → el nombre del servicio en LLM_BASE_URL no coincide con el servicio de Railway (revisa Settings → Networking → Private Networking).`;
    if (code === 'ECONNREFUSED')
        return `"${host}" resuelve pero rechaza la conexión → Ollama aún arrancando/descargando modelos, puerto distinto a 11434, o escucha solo en IPv4 (usa OLLAMA_HOST=[::]:11434).`;
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'EHOSTUNREACH')
        return `Sin ruta hacia "${host}" → ambos servicios deben estar en el mismo proyecto y entorno de Railway.`;
    return `${err?.message || err}${code ? ` (${code})` : ''}`;
}

let _calentando = false, _calentado = false;
/**
 * Pre-carga Llama en RAM SIN bloquear ni tumbar el arranque.
 * Reintenta en segundo plano con backoff (Ollama puede tardar minutos la 1.ª vez por la descarga de modelos).
 * Nunca lanza excepción; solo deja UNA línea de resumen si agota los intentos.
 */
async function calentar({ intentos = parseInt(process.env.LLM_WARM_INTENTOS || '12'), baseMs = parseInt(process.env.LLM_WARM_BASE_MS || '10000') } = {}) {
    if (_calentando || _calentado) return;
    _calentando = true;
    if (!process.env.LLM_BASE_URL) console.warn(`🦙 [llm] LLM_BASE_URL no definida → usando por defecto ${BASE}. Defínela en Railway con el nombre real del servicio.`);
    else console.log(`🦙 [llm] destino: ${BASE}`);
    let ultimo = null;
    try {
        for (let n = 1; n <= intentos; n++) {
            try {
                // 1) ¿Está vivo y qué modelos tiene? (barato, no carga nada en RAM)
                const t = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(8000) });
                if (!t.ok) throw new Error(`HTTP ${t.status} en /api/tags`);
                const instalados = ((await t.json()).models || []).map(m => m.name);
                // 2) Elegir el primer modelo ya descargado (si el principal sigue bajándose, calentamos el de respaldo)
                const modelo = MODELOS.find(m => instalados.some(i => i === m || i === `${m}:latest`));
                if (!modelo) throw new Error(`modelos aún no descargados (instalados: ${instalados.join(', ') || 'ninguno'}; esperados: ${MODELOS.join(', ')})`);
                // 3) Cargar en RAM
                const r = await fetch(`${BASE}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: modelo, prompt: '', keep_alive: '24h' }), signal: AbortSignal.timeout(300000) });
                if (!r.ok) throw new Error(`HTTP ${r.status} al cargar ${modelo}`);
                await r.arrayBuffer();
                _calentado = true; cb.fallos = 0; cb.ultimoOk = Date.now(); cb.modeloActivo = modelo;
                console.log(`🦙 [llm] ${modelo} cargado en memoria (intento ${n})`);
                return;
            } catch (e) {
                ultimo = e;
                const espera = Math.min(baseMs * 2 ** (n - 1), 120000);
                if (n === 1 || n % 4 === 0) console.log(`🦙 [llm] Llama aún no responde (intento ${n}/${intentos}): ${await _diagnostico(e)} — reintento en ${Math.round(espera / 1000)}s`);
                if (n < intentos) await new Promise(r => setTimeout(r, espera));
            }
        }
        console.warn(`🦙 [llm] No se pudo precalentar tras ${intentos} intentos: ${await _diagnostico(ultimo)}. La web sigue activa; Llama se cargará en la primera generación.`);
    } catch (e) {
        console.warn('🦙 [llm] calentamiento abortado:', e.message);          // red de seguridad final: jamás propagar
    } finally { _calentando = false; }
}

module.exports = { generar, generarJSON, llamarGemini, disponible, estado, calentar };
