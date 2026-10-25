# El Farol al Día — Fase 2

| Archivo | Función |
|---|---|
| `lib/cache.js` | Redis (REDIS_URL) con fallback a memoria: cache-aside, stale-while-revalidate, anti-estampida, caché de páginas HTML, vistas por lotes, rate-limit |
| `lib/llm.js` | Router a Llama (Ollama) sin API key: cola, streaming, fallback 8B→3B, circuit breaker, JSON robusto, shim `llamarGemini` |
| `lib/imagenes/` | buscador (Commons + Openverse) → depurador (licencia, anti-SSRF, contenido, duplicados) → marca (watermark) → almacén (Mongo GridFS) |
| `llama-service/` | Dockerfile + entrypoint del servicio Ollama (servicio nuevo en Railway) |
| `server.js` | Tu server.js con la Fase 2 integrada (`fase2-server.patch` = solo los cambios) |
| `test/fase2.test.js` | 45 comprobaciones (`npm test`) |

## Despliegue en Railway
1. **Servicio Llama**: servicio nuevo con `llama-service/` como Root Directory + Volume en `/root/.ollama`. **Sin dominio público.** ≥ 10 GB RAM para el 8B.
2. **Servicio web**: reemplaza archivos, `npm install`, añade las variables de `.env.example`.
3. Sube tu `static/watermark.png` real (el del repo pesaba 2 bytes; aquí va uno derivado del farolito).
4. Verifica `/health`, `/api/llm/status?pin=…`, `/api/cache/status?pin=…`.
