🏮 EL FAROL AL DÍA — MANUAL COMPLETO DEL SISTEMA

Todo lo que necesitas saber para operar sin ayuda externa

¿QUÉ ES ESTE SISTEMA?

El Farol al Día es un periódico digital dominicano que funciona solo, sin intervención humana.

Cada 10 minutos durante el día:

El servidor busca noticias en 22 fuentes RSS dominicanas e internacionales

La IA (Gemini) reescribe la noticia con voz propia y SEO profesional

Se descarga la foto, se verifica que sea buena, se le pone el watermark

Se publica en elfarolaldia.com automáticamente

Tú solo necesitas revisar el monitor de vez en cuando.

ACCESOS IMPORTANTES

Sitio web: https://elfarolaldia.com Panel de redacción: elfarolaldia.com/redaccion Monitor técnico: elfarolaldia.com/monitor GitHub: github.com/josecolor/farol-web Railway: railway.app → proyecto ideal-reverence Usuario panel: director Contraseña: 311 

EL MONITOR — TU TABLERO DE CONTROL

Entra a elfarolaldia.com/monitor con usuario director y contraseña 311.

Qué significa cada cosa:

🟢 Sistema operando bien Todo funciona. No necesitas hacer nada.

🟡 Sistema con alertas Hay algo que revisar pero el servidor sigue publicando. El sistema intentará corregirlo solo en 30 minutos.

🔴 Servidor no responde El servidor está caído. Ve a Railway y revisa los logs.

Las métricas:

Noticias — cuántas están publicadas en total

Vistas — cuántas personas han leído

Sin publicar — minutos desde la última noticia (normal hasta 60 min en madrugada)

Gemini Keys — cuántas keys de IA están activas (necesitas al menos 1)

Los checks de salud:

Gemini IA — si dice OK, la IA está funcionando

Publicación — si dice "Publicando OK", está publicando noticias

RSS — las fuentes de noticias están respondiendo

Imágenes — las fotos se están descargando bien

Watermark — la marca de agua está activa

Google CSE — búsqueda de fotos HD activa

IA — la inteligencia artificial está activada

AdSense — tu ID de monetización está configurado

Los botones de acción:

Procesar RSS — fuerza buscar noticias ahora mismo

Regenerar Fotos — reemplaza fotos feas por fotos buenas

Generar Noticia — publica una noticia de Nacionales ahora

Resetear BD — ⚠️ BORRA TODO — solo en emergencia extrema

HORARIOS DE PUBLICACIÓN

El sistema publica automáticamente según la hora:

6:00am – 8:00pm → cada 10 minutos (hora pico, máximo tráfico) 8:00pm – 12:00am → cada 30 minutos (noche tranquila) 12:00am – 6:00am → cada hora (madrugada, la gente duerme) 

En las horas pico publica hasta 6 noticias por hora. En la madrugada publica 1 por hora para que haya contenido fresco al amanecer.

SISTEMA DE IMÁGENES — CÓMO FUNCIONA

El sistema tiene 4 niveles para conseguir fotos:

NIVEL 1: Foto del periódico original (Listín, Diario Libre, N Digital) → Se verifica: ¿tiene más de 400 píxeles? ¿sin logo ajeno? → Si pasa: se usa esa foto NIVEL 2: Google CSE busca la foto por el título de la noticia → Busca fotos HD relacionadas al tema → Si encuentra una buena: se usa NIVEL 3: Banco local de 170 fotos verificadas por categoría → Fotos reales por tema: política, deportes, economía, etc. → Siempre nítidas, nunca pixeladas NIVEL 4: Si todo falla → se publica sin foto antes que publicar una foto mala 

Después de conseguir la foto:

Sharp la procesa y optimiza

Se le pone el watermark "EL FAROL AL DÍA" en la esquina

Se guarda como foto propia del sitio

La URL queda como elfarolaldia.com/img/efd-...jpg

SISTEMA DE APRENDIZAJE — CÓMO LA IA APRENDE

Cada 4 horas el sistema analiza qué noticias tuvieron más vistas y aprende:

Palabras que generan tráfico — si "gasolina" aparece en títulos muy vistos, el sistema le da más puntos a noticias futuras que la mencionen

Categorías que rinden más — si Economía siempre tiene más vistas que Espectáculos, el sistema publica más Economía automáticamente

Estilo de títulos — los títulos más vistos se le pasan a Gemini como ejemplo para que escriba igual

Con el tiempo el sistema se vuelve más inteligente y publica lo que más le gusta a tu audiencia.

AUTO-DIAGNÓSTICO — CÓMO EL SISTEMA SE REPARA SOLO

Cada 30 minutos el sistema se revisa a sí mismo. Si encuentra problemas los corrige:

Problema detectadoQué hace soloGemini con 3+ errores seguidosResetea todas las keys automáticamenteMás de 2 horas sin publicarFuerza un ciclo RSS manualRSS vacío 5 ciclos seguidosLimpia el historial para reprocesarFotos feas sin watermark propioInicia regeneración automáticaFotos rotas en discoInicia regeneración automáticaTítulos duplicadosBorra los duplicados conservando el más recienteCache viejaLa invalida para servir datos frescosNoticias de más de 8 díasLas elimina para mantener el sitio fresco 

GEMINI — LA INTELIGENCIA ARTIFICIAL

Gemini es el modelo de Google que escribe las noticias.

Keys configuradas en Railway:

GEMINI_API_KEY — Key 1

GEMINI_API_KEY2 — Key 2

GEMINI_API_KEY3 — Key 3

GEMINI_API_KEY4 — Key 4

Cómo rotan:

Key 1 publica → descansa 60 segundos

Key 2 publica → descansa 60 segundos

Key 3 publica → descansa 60 segundos

Key 4 publica → descansa 60 segundos

Vuelve a Key 1

Si una key da error 429 (límite): El sistema la pone en cooldown y pasa a la siguiente automáticamente.

Si necesitas agregar más keys:

Ir a aistudio.google.com con otra cuenta Google (gratis)

Crear API Key

En Railway agregar GEMINI_API_KEY5 con el valor

ADSENSE — LA MONETIZACIÓN

Tu ID de AdSense: pub-5280872495839888

Estado actual: En revisión (enviado el 20 de marzo 2026) Tiempo esperado: 3 a 14 días

Cuando se apruebe:

Google mostrará anuncios automáticamente en las páginas

Recibirás dinero por cada clic en los anuncios

Las categorías con mayor ganancia por clic son: Economía, Internacionales, Nacionales

Para verificar el estado: Entrar a adsense.google.com con tu cuenta Google

GOOGLE CSE — FOTOS HD

Tu motor de búsqueda: 3214c7fe814ec4c47 Tu API Key: configurada en Railway como GOOGLE_CSE_KEY

Para qué sirve: Cuando una foto del RSS viene pixelada o fea, el sistema le pide a Google que busque una foto HD del mismo tema usando el título de la noticia.

Límite gratuito: 100 búsquedas por día Si necesitas más: console.developers.google.com → Custom Search API → habilitar facturación

RAILWAY — EL SERVIDOR

Railway es donde corre el servidor. URL: railway.app

Para entrar:

railway.app → Login con GitHub

Proyecto: ideal-reverence

Servicio: farol-web

Si el servidor se cae:

Ir a Railway → farol-web → Deploy

Ver los logs — buscar el error en rojo

Si dice FATAL → revisar las variables de entorno

Si dice npm error → revisar el package.json en GitHub

Como último recurso: Settings → Redeploy

Variables de entorno críticas:

DATABASE_URL ← si falta esto el servidor no arranca GEMINI_API_KEY ← si no hay ninguna key el servidor no arranca BASE_URL ← debe ser https://elfarolaldia.com 

GITHUB — EL CÓDIGO

github.com/josecolor/farol-web

Archivos principales:

server.js ← El cerebro del sistema — NUNCA subir sin probar client/ index.html ← La portada del sitio noticia.html ← La página de cada noticia redaccion.html ← El panel de administración monitor.html ← El panel de monitoreo técnico static/ WATERMARK(1).png ← La marca de agua — NO borrar package.json ← Las dependencias de Node.js 

Cómo actualizar el servidor:

Editar el archivo en GitHub

Hacer commit

Railway detecta el cambio y redespliega automáticamente (2-3 minutos)

BASE DE DATOS PostgreSQL

La base de datos guarda todas las noticias, comentarios y el aprendizaje de la IA.

Tablas:

noticias — todas las noticias publicadas

rss_procesados — registro de RSS ya procesados (evita duplicados)

memoria_ia — el aprendizaje acumulado del sistema

comentarios — comentarios de lectores

Limpieza automática (3am diario):

Noticias de más de 7 días → se borran

RSS procesados de más de 3 días → se borran

Fotos de más de 7 días en /tmp → se borran

PROBLEMAS COMUNES Y SOLUCIONES

❌ El sitio no carga

Revisar Railway → farol-web → debe decir "Online"

Si dice "Crashed" → ver Deploy Logs → buscar el error

Solución más común: revisar que DATABASE_URL esté configurada

❌ No se publican noticias

Entrar al monitor → revisar "Sin publicar" (minutos)

Si lleva más de 2 horas → el auto-diagnóstico debería haberlo corregido

Manual: en el monitor clic en "Procesar RSS"

Si sigue sin publicar → en el monitor clic en "Generar Noticia"

❌ Las fotos salen pixeladas

En el monitor clic en "Regenerar Fotos"

El sistema procesará 3 fotos cada 8 segundos

Esperar 10-15 minutos para ver resultados

❌ Todas las noticias tienen la misma foto

Es el banco local funcionando como fallback

En el monitor clic en "Regenerar Fotos"

Asegurarse que GOOGLE_CSE_KEY y GOOGLE_CSE_ID estén en Railway

❌ Gemini no responde / errores 429

El sistema lo corrige solo en el próximo ciclo de auto-diagnóstico (30 min)

Si persiste: agregar una key nueva en Railway (GEMINI_API_KEY5)

Las keys gratuitas tienen límite de 15 req/min por cuenta

❌ El servidor crashea al arrancar

Revisar que estas variables existan en Railway:

DATABASE_URL ← obligatoria

Al menos una GEMINI_API_KEY ← obligatoria

BASE_URL ← obligatoria

❌ AdSense no aparece en el sitio

Verificar que ads.txt esté en el repositorio con: google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0

Verificar que el script de AdSense esté en index.html y noticia.html

AdSense puede tardar hasta 24h en mostrar anuncios después de aprobarse

CÓMO MIGRAR A OTRA PLATAFORMA (si Railway falla)

Opción 1 — Render.com (gratis)

1. render.com → New Web Service 2. Conectar github.com/josecolor/farol-web 3. Build Command: npm install 4. Start Command: node server.js 5. Agregar PostgreSQL: New PostgreSQL → copiar la URL 6. Agregar todas las variables de entorno 7. Deploy 

Opción 2 — Fly.io (recomendado)

1. fly.io → crear cuenta 2. fly launch (en la carpeta del repo) 3. fly postgres create 4. fly secrets set DATABASE_URL=... 5. fly secrets set GEMINI_API_KEY=... 6. fly deploy 

Opción 3 — VPS propio (más control)

# En el servidor (Ubuntu): curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - sudo apt-get install -y nodejs postgresql git clone https://github.com/josecolor/farol-web cd farol-web npm install # Crear archivo .env con todas las variables # Correr con PM2 para que nunca se apague: npm install -g pm2 pm2 start server.js --name farol pm2 save pm2 startup 

RESUMEN DE VARIABLES DE ENTORNO

DATABASE_URL ← OBLIGATORIA — conexión a PostgreSQL GEMINI_API_KEY ← OBLIGATORIA — IA principal GEMINI_API_KEY2 ← Recomendada — más capacidad GEMINI_API_KEY3 ← Recomendada — más capacidad GEMINI_API_KEY4 ← Recomendada — más capacidad GEMINI_API_KEY5 ← Opcional — si necesitas más BASE_URL ← OBLIGATORIA — https://elfarolaldia.com GOOGLE_CSE_KEY ← Importante — fotos HD GOOGLE_CSE_ID ← Importante — fotos HD PORT ← Railway lo pone solo (8080) 

CONTACTOS DE SOPORTE EXTERNO

Railway soporte: railway.app/help Google AI Studio: aistudio.google.com (para keys Gemini) Google AdSense: adsense.google.com Google CSE: programmablesearchengine.google.com GitHub soporte: github.com/support 

CHECKLIST DIARIO (opcional — 2 minutos)

□ Entrar a elfarolaldia.com/monitor □ Verificar semáforo verde □ Verificar que "Sin publicar" sea menos de 60 min □ Verificar que el número de noticias siga creciendo □ Si hay alertas amarillas → esperar 30 min (el sistema se corrige solo) □ Si hay alertas rojas → ver sección "Problemas comunes" arriba 

Manual generado: Marzo 2026 — V34.48 Sistema desarrollado con Claude (Anthropic) + Gemini 2.5 Flash (Google) Servidor: Railway · Base de datos: PostgreSQL · Dominio: elfarolaldia.com

MANUAL_COMPLETO.md — guárdalo bien. Cubre todo:

📊 Cómo leer el monitor

⏰ Horarios de publicación

🖼️ Cómo funciona el sistema de imágenes

🧠 Cómo aprende la IA

🩺 Cómo se repara solo

🔑 Cómo manejar las keys Gemini

💰 AdSense y Google CSE

❌ Problemas comunes y soluciones paso a paso

🚀 Cómo migrar a otra plataforma si Railway falla

✅ Checklist diario de 2 minutos

Con este manual cualquier persona puede operar el sistema aunque no sepa programar. Buenas noches mxl. 🌙🏮
