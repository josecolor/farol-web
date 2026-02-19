Aquí están los 6 archivos uno por uno para copiar y pegar:

---

**1. `app.py`**

```python
"""
╔══════════════════════════════════════════════════════════════╗
║           EL FAROL AL DÍA — BACKEND DE PRODUCCIÓN           ║
║   Identidad: Farol azul · Estrella blanca · Fondo naranja    ║
║   SEO Firma: seoacuerdate mxl                                ║
║   Tags Mandatorios: National · Viral · Mexicali              ║
║   Pilares: PostgreSQL · Portada Pública · Panel Admin        ║
╚══════════════════════════════════════════════════════════════╝
"""

import os
import uuid
import logging
import psycopg2
import psycopg2.extras
from flask import Flask, render_template, request, jsonify, url_for, redirect
from werkzeug.utils import secure_filename
from flask_wtf.csrf import CSRFProtect, generate_csrf

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY']         = os.environ.get('SECRET_KEY', 'farol2026')
app.config['UPLOAD_FOLDER']      = 'static/uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

EXTENSIONES_PERMITIDAS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
csrf = CSRFProtect(app)

ruta_uploads = os.path.join(app.root_path, app.config['UPLOAD_FOLDER'])
os.makedirs(ruta_uploads, exist_ok=True)

DATABASE_URL = os.environ.get('DATABASE_URL')

def get_db():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL no configurada en Railway.")
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)

def init_db():
    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS noticias (
                id              SERIAL PRIMARY KEY,
                titulo          TEXT        NOT NULL,
                contenido       TEXT        NOT NULL,
                imagen          TEXT,
                creado_en       TIMESTAMP   DEFAULT NOW(),
                actualizado_en  TIMESTAMP   DEFAULT NOW()
            );
        """)
        conn.commit()
        cur.close()
        conn.close()
        logger.info("✅ Base de datos lista.")
    except Exception as e:
        logger.error(f"🔴 Error BD: {e}")

init_db()

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in EXTENSIONES_PERMITIDAS

@app.context_processor
def inject_csrf():
    return dict(csrf_token=generate_csrf)

@app.errorhandler(413)
def error_archivo_grande(e):
    return jsonify({'error': 'El archivo supera los 16 MB permitidos.'}), 413

@app.errorhandler(404)
def error_no_encontrado(e):
    return render_template('404.html'), 404

@app.errorhandler(500)
def error_interno(e):
    logger.error(f"🔴 Error interno: {e}")
    return jsonify({'error': 'Error interno.'}), 500

@app.route('/')
def index():
    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute("SELECT id, titulo, imagen, creado_en FROM noticias ORDER BY creado_en DESC LIMIT 20;")
        noticias = cur.fetchall()
        cur.close()
        conn.close()
        return render_template('index.html', noticias=noticias)
    except Exception as e:
        logger.error(f"🔴 Error portada: {e}")
        return "<h1>🏮 Error al cargar El Farol al Día.</h1>", 500

@app.route('/nota/<int:noticia_id>')
def ver_noticia(noticia_id):
    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute("SELECT * FROM noticias WHERE id = %s;", (noticia_id,))
        noticia = cur.fetchone()
        cur.close()
        conn.close()
        if not noticia:
            return render_template('404.html'), 404
        return render_template('noticia.html', noticia=noticia)
    except Exception as e:
        logger.error(f"🔴 Error nota {noticia_id}: {e}")
        return jsonify({'error': 'Error al cargar la noticia.'}), 500

@app.route('/admin')
def admin_panel():
    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute("SELECT id, titulo, creado_en, actualizado_en FROM noticias ORDER BY creado_en DESC;")
        noticias = cur.fetchall()
        cur.close()
        conn.close()
        return render_template('admin.html', noticias=noticias)
    except Exception as e:
        logger.error(f"🔴 Error admin: {e}")
        return render_template('admin.html', noticias=[], error=str(e))

@app.route('/admin/nueva')
def admin_nueva():
    return render_template('editor.html', noticia=None, modo='nueva')

@app.route('/admin/editar/<int:noticia_id>')
def admin_editar(noticia_id):
    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute("SELECT * FROM noticias WHERE id = %s;", (noticia_id,))
        noticia = cur.fetchone()
        cur.close()
        conn.close()
        if not noticia:
            return redirect('/admin')
        return render_template('editor.html', noticia=noticia, modo='editar')
    except Exception as e:
        logger.error(f"🔴 Error editor {noticia_id}: {e}")
        return redirect('/admin')

@app.route('/noticias', methods=['POST'])
def crear_noticia():
    datos = request.get_json()
    if not datos:
        return jsonify({'error': 'No se recibieron datos.'}), 400
    titulo    = datos.get('titulo', '').strip()
    contenido = datos.get('contenido', '').strip()
    imagen    = datos.get('imagen', None)
    if not titulo or not contenido:
        return jsonify({'error': 'Título y contenido son obligatorios.'}), 400
    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute(
            "INSERT INTO noticias (titulo, contenido, imagen) VALUES (%s, %s, %s) RETURNING id;",
            (titulo, contenido, imagen)
        )
        nuevo_id = cur.fetchone()['id']
        conn.commit()
        cur.close()
        conn.close()
        logger.info(f"✅ Noticia #{nuevo_id} guardada.")
        return jsonify({'mensaje': 'Noticia publicada.', 'id': nuevo_id}), 201
    except Exception as e:
        logger.error(f"🔴 Error guardar: {e}")
        return jsonify({'error': 'Error al guardar.'}), 500

@app.route('/noticias/<int:noticia_id>', methods=['PUT'])
def editar_noticia(noticia_id):
    datos = request.get_json()
    if not datos:
        return jsonify({'error': 'No se recibieron datos.'}), 400
    titulo    = datos.get('titulo', '').strip()
    contenido = datos.get('contenido', '').strip()
    imagen    = datos.get('imagen', None)
    if not titulo or not contenido:
        return jsonify({'error': 'Título y contenido son obligatorios.'}), 400
    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute("""
            UPDATE noticias SET titulo=%s, contenido=%s, imagen=%s, actualizado_en=NOW()
            WHERE id=%s RETURNING id;
        """, (titulo, contenido, imagen, noticia_id))
        resultado = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        if not resultado:
            return jsonify({'error': 'Noticia no encontrada.'}), 404
        return jsonify({'mensaje': 'Actualizada.', 'id': noticia_id}), 200
    except Exception as e:
        logger.error(f"🔴 Error editar {noticia_id}: {e}")
        return jsonify({'error': 'Error al actualizar.'}), 500

@app.route('/noticias/<int:noticia_id>', methods=['DELETE'])
def eliminar_noticia(noticia_id):
    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute("DELETE FROM noticias WHERE id=%s RETURNING id;", (noticia_id,))
        resultado = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        if not resultado:
            return jsonify({'error': 'Noticia no encontrada.'}), 404
        return jsonify({'mensaje': 'Eliminada.'}), 200
    except Exception as e:
        logger.error(f"🔴 Error eliminar {noticia_id}: {e}")
        return jsonify({'error': 'Error al eliminar.'}), 500

@app.route('/upload', methods=['POST'])
@csrf.exempt
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No se recibió archivo.'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Sin nombre.'}), 400
    if not allowed_file(file.filename):
        return jsonify({'error': 'Tipo no permitido.'}), 400
    try:
        nombre_seguro = secure_filename(file.filename)
        filename      = f"{uuid.uuid4().hex}_{nombre_seguro}"
        filepath      = os.path.join(ruta_uploads, filename)
        file.save(filepath)
        file_url = url_for('static', filename=f'uploads/{filename}', _external=True)
        return jsonify({'location': file_url})
    except Exception as e:
        logger.error(f"🔴 Error imagen: {e}")
        return jsonify({'error': 'Error al guardar imagen.'}), 500

if __name__ == '__main__':
    puerto = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=puerto, debug=False)
```

---

**2. `templates/index.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="El Farol al Día — Noticias de Mexicali, Baja California.">
    <title>El Farol al Día — Mexicali</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Georgia', serif; background: #f5f0e8; color: #1a1a1a; }
        header { background: #E87722; color: white; box-shadow: 0 3px 8px rgba(0,0,0,0.3); }
        .header-top { display: flex; align-items: center; justify-content: space-between; padding: 16px 32px; }
        .logo-area { display: flex; align-items: center; gap: 14px; }
        .logo-farol { font-size: 2.8rem; }
        .logo-texto h1 { font-size: 2rem; font-weight: 900; letter-spacing: 1px; }
        .logo-texto .subtitulo { font-size: 0.85rem; opacity: 0.9; letter-spacing: 3px; text-transform: uppercase; }
        .fecha-header { font-size: 0.85rem; opacity: 0.85; text-align: right; }
        .barra-tags { background: #1a3a5c; padding: 6px 32px; font-size: 0.8rem; color: white; letter-spacing: 2px; }
        .barra-tags span { margin-right: 24px; opacity: 0.8; }
        .barra-tags span::before { content: '⭐ '; }
        main { max-width: 1100px; margin: 32px auto; padding: 0 20px; }
        .seccion-titulo { font-size: 0.75rem; letter-spacing: 3px; text-transform: uppercase; color: #E87722; font-family: Arial, sans-serif; font-weight: 700; margin-bottom: 16px; padding-bottom: 6px; border-bottom: 2px solid #E87722; }
        .grilla { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px; margin-bottom: 48px; }
        .tarjeta { background: white; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); transition: transform 0.2s, box-shadow 0.2s; text-decoration: none; color: inherit; display: block; }
        .tarjeta:hover { transform: translateY(-4px); box-shadow: 0 8px 20px rgba(0,0,0,0.12); }
        .tarjeta-imagen { width: 100%; height: 200px; background: #e0d8cc; display: flex; align-items: center; justify-content: center; font-size: 3rem; color: #ccc; }
        .tarjeta-imagen img { width: 100%; height: 200px; object-fit: cover; }
        .tarjeta-cuerpo { padding: 18px; }
        .tarjeta-fecha { font-size: 0.72rem; color: #999; font-family: Arial, sans-serif; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }
        .tarjeta-titulo { font-size: 1.1rem; font-weight: 700; line-height: 1.4; color: #1a1a1a; }
        .sin-noticias { text-align: center; padding: 80px 20px; color: #888; }
        .sin-noticias .icono { font-size: 4rem; margin-bottom: 16px; }
        footer { background: #1a3a5c; color: white; text-align: center; padding: 24px; font-size: 0.82rem; }
        footer a { color: #E87722; text-decoration: none; }
        @media (max-width: 600px) { .logo-texto h1 { font-size: 1.4rem; } .header-top { flex-direction: column; gap: 8px; } .grilla { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
<header>
    <div class="header-top">
        <div class="logo-area">
            <div class="logo-farol">🏮</div>
            <div class="logo-texto">
                <h1>EL FAROL AL DÍA</h1>
                <div class="subtitulo">Mexicali · Baja California</div>
            </div>
        </div>
        <div class="fecha-header" id="fecha-hoy"></div>
    </div>
    <div class="barra-tags">
        <span>National</span><span>Viral</span><span>Mexicali</span>
    </div>
</header>
<main>
    <div class="seccion-titulo">Últimas Noticias</div>
    {% if noticias %}
    <div class="grilla">
        {% for noticia in noticias %}
        <a class="tarjeta" href="/nota/{{ noticia.id }}">
            <div class="tarjeta-imagen">
                {% if noticia.imagen %}<img src="{{ noticia.imagen }}" alt="{{ noticia.titulo }}" loading="lazy">
                {% else %}🏮{% endif %}
            </div>
            <div class="tarjeta-cuerpo">
                <div class="tarjeta-fecha">{{ noticia.creado_en.strftime('%d %b %Y · %H:%M') if noticia.creado_en else '' }}</div>
                <div class="tarjeta-titulo">{{ noticia.titulo }}</div>
            </div>
        </a>
        {% endfor %}
    </div>
    {% else %}
    <div class="sin-noticias">
        <div class="icono">🏮</div>
        <h2>Próximamente las primeras exclusivas</h2>
        <p>El equipo editorial de El Farol al Día está preparando el contenido.</p>
    </div>
    {% endif %}
</main>
<footer>
    <p>© 2025 <strong>El Farol al Día</strong> — Mexicali, Baja California &nbsp;|&nbsp; <a href="/admin">Redacción</a></p>
</footer>
<script>
    const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('fecha-hoy').textContent = new Date().toLocaleDateString('es-MX', opciones);
</script>
</body>
</html>
```

---

**3. `templates/noticia.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ noticia.titulo }} | El Farol al Día</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Georgia', serif; background: #f5f0e8; color: #1a1a1a; }
        header { background: #E87722; padding: 14px 32px; }
        header a { text-decoration: none; color: white; display: flex; align-items: center; gap: 10px; }
        header h1 { font-size: 1.5rem; font-weight: 900; }
        .barra-volver { background: #1a3a5c; padding: 8px 32px; }
        .barra-volver a { color: #E87722; text-decoration: none; font-size: 0.85rem; font-family: Arial, sans-serif; }
        article { max-width: 780px; margin: 40px auto; padding: 0 20px; }
        .meta { font-size: 0.78rem; color: #999; font-family: Arial, sans-serif; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
        .meta .separador { margin: 0 8px; }
        h2.titulo-nota { font-size: 2rem; line-height: 1.25; margin-bottom: 20px; }
        .imagen-principal { width: 100%; max-height: 420px; object-fit: cover; border-radius: 6px; margin-bottom: 28px; }
        .contenido-nota { font-size: 1.08rem; line-height: 1.8; color: #2a2a2a; }
        .contenido-nota p { margin-bottom: 1.2em; }
        .contenido-nota img { max-width: 100%; border-radius: 4px; margin: 16px 0; }
        footer { background: #1a3a5c; color: white; text-align: center; padding: 20px; font-size: 0.82rem; margin-top: 60px; }
        footer a { color: #E87722; text-decoration: none; }
        @media (max-width: 600px) { h2.titulo-nota { font-size: 1.4rem; } }
    </style>
</head>
<body>
<header>
    <a href="/"><span style="font-size:1.8rem">🏮</span><h1>EL FAROL AL DÍA</h1></a>
</header>
<div class="barra-volver"><a href="/">← Volver a la portada</a></div>
<article>
    <div class="meta">
        <span>Mexicali · Baja California</span>
        <span class="separador">|</span>
        <span>{{ noticia.creado_en.strftime('%d de %B de %Y, %H:%M') if noticia.creado_en else '' }}</span>
        {% if noticia.actualizado_en and noticia.actualizado_en != noticia.creado_en %}
        <span class="separador">|</span>
        <span>Actualizado: {{ noticia.actualizado_en.strftime('%d/%m/%Y %H:%M') }}</span>
        {% endif %}
    </div>
    <h2 class="titulo-nota">{{ noticia.titulo }}</h2>
    {% if noticia.imagen %}<img class="imagen-principal" src="{{ noticia.imagen }}" alt="{{ noticia.titulo }}">{% endif %}
    <div class="contenido-nota">{{ noticia.contenido | safe }}</div>
</article>
<footer>
    <p>© 2025 <strong>El Farol al Día</strong> — Mexicali &nbsp;|&nbsp; <a href="/">Portada</a> &nbsp;|&nbsp; <a href="/admin">Redacción</a></p>
</footer>
</body>
</html>
```

---

**4. `templates/admin.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Redacción — El Farol al Día</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; background: #f0f2f5; color: #1a1a1a; }
        header { background: #1a3a5c; color: white; padding: 16px 32px; display: flex; align-items: center; justify-content: space-between; }
        .logo { display: flex; align-items: center; gap: 10px; }
        .logo span { font-size: 1.8rem; }
        .logo h1 { font-size: 1.2rem; }
        .logo .sub { font-size: 0.75rem; opacity: 0.7; }
        .header-links a { color: #E87722; text-decoration: none; font-size: 0.85rem; margin-left: 20px; }
        main { max-width: 1000px; margin: 32px auto; padding: 0 20px; }
        .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
        .toolbar h2 { font-size: 1.2rem; color: #1a3a5c; }
        .btn-nueva { background: #E87722; color: white; padding: 10px 22px; border-radius: 5px; text-decoration: none; font-weight: 700; font-size: 0.9rem; }
        .btn-nueva:hover { background: #c9640f; }
        .error-msg { background: #ffe5e5; border: 1px solid #f44; padding: 12px 16px; border-radius: 5px; color: #c00; margin-bottom: 20px; font-size: 0.9rem; }
        .tabla-wrapper { background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.07); overflow: hidden; }
        table { width: 100%; border-collapse: collapse; }
        thead { background: #1a3a5c; color: white; }
        thead th { padding: 14px 16px; text-align: left; font-size: 0.8rem; letter-spacing: 1px; text-transform: uppercase; }
        tbody tr { border-bottom: 1px solid #f0f0f0; transition: background 0.15s; }
        tbody tr:hover { background: #fdf6ee; }
        tbody td { padding: 14px 16px; font-size: 0.9rem; vertical-align: middle; }
        .td-titulo { font-weight: 600; max-width: 400px; }
        .td-fecha { color: #888; font-size: 0.8rem; white-space: nowrap; }
        .btn-editar, .btn-ver, .btn-borrar { padding: 6px 14px; border-radius: 4px; font-size: 0.8rem; text-decoration: none; font-weight: 600; border: none; cursor: pointer; margin-right: 6px; }
        .btn-ver { background: #e8f0fe; color: #1a3a5c; }
        .btn-editar { background: #fff3e0; color: #E87722; }
        .btn-borrar { background: #fdecea; color: #c62828; }
        .sin-noticias { text-align: center; padding: 60px; color: #999; }
        footer { text-align: center; padding: 24px; font-size: 0.8rem; color: #aaa; margin-top: 40px; }
        footer a { color: #E87722; text-decoration: none; }
    </style>
</head>
<body>
<header>
    <div class="logo">
        <span>🏮</span>
        <div><h1>EL FAROL AL DÍA</h1><div class="sub">Panel de Redacción</div></div>
    </div>
    <div class="header-links"><a href="/" target="_blank">Ver Portada ↗</a></div>
</header>
<main>
    {% if error %}<div class="error-msg">⚠️ Error de conexión: {{ error }}</div>{% endif %}
    <div class="toolbar">
        <h2>📰 Noticias Publicadas ({{ noticias | length }})</h2>
        <a href="/admin/nueva" class="btn-nueva">+ Nueva Noticia</a>
    </div>
    <div class="tabla-wrapper">
        {% if noticias %}
        <table>
            <thead>
                <tr><th>#</th><th>Título</th><th>Publicado</th><th>Actualizado</th><th>Acciones</th></tr>
            </thead>
            <tbody>
                {% for noticia in noticias %}
                <tr>
                    <td style="color:#bbb;font-size:0.8rem">{{ noticia.id }}</td>
                    <td class="td-titulo">{{ noticia.titulo }}</td>
                    <td class="td-fecha">{{ noticia.creado_en.strftime('%d/%m/%Y %H:%M') if noticia.creado_en else '—' }}</td>
                    <td class="td-fecha">{{ noticia.actualizado_en.strftime('%d/%m/%Y %H:%M') if noticia.actualizado_en else '—' }}</td>
                    <td>
                        <a href="/nota/{{ noticia.id }}" target="_blank" class="btn-ver">Ver</a>
                        <a href="/admin/editar/{{ noticia.id }}" class="btn-editar">Editar</a>
                        <button class="btn-borrar" onclick="confirmarBorrado({{ noticia.id }}, '{{ noticia.titulo[:40] }}')">Borrar</button>
                    </td>
                </tr>
                {% endfor %}
            </tbody>
        </table>
        {% else %}
        <div class="sin-noticias">
            <p>📭 No hay noticias todavía. <a href="/admin/nueva" style="color:#E87722">Crear la primera →</a></p>
        </div>
        {% endif %}
    </div>
</main>
<footer><a href="/">Portada pública</a> · El Farol al Día © 2025</footer>
<script>
function confirmarBorrado(id, titulo) {
    if (!confirm(`¿Eliminar "${titulo}"?\n\nEsta acción es permanente.`)) return;
    fetch(`/noticias/${id}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(data => {
            if (data.mensaje) { alert('✅ Eliminada.'); location.reload(); }
            else alert('Error: ' + (data.error || 'No se pudo eliminar.'));
        })
        .catch(() => alert('Error de conexión.'));
}
</script>
</body>
</html>
```

---

**5. `templates/editor.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ 'Editar Nota' if modo == 'editar' else 'Nueva Nota' }} — El Farol al Día</title>
    <script src="https://cdn.tiny.cloud/1/no-api-key/tinymce/6/tinymce.min.js" referrerpolicy="origin"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; background: #f0f2f5; color: #1a1a1a; }
        header { background: #1a3a5c; color: white; padding: 14px 32px; display: flex; align-items: center; justify-content: space-between; }
        .logo { display: flex; align-items: center; gap: 10px; }
        .logo span { font-size: 1.6rem; }
        .logo h1 { font-size: 1.1rem; }
        .header-links a { color: #E87722; text-decoration: none; font-size: 0.85rem; margin-left: 16px; }
        main { max-width: 860px; margin: 32px auto; padding: 0 20px; }
        .page-title { font-size: 1.3rem; color: #1a3a5c; margin-bottom: 24px; font-weight: 700; }
        .form-grupo { margin-bottom: 20px; }
        label { display: block; font-size: 0.85rem; font-weight: 600; color: #555; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
        input[type="text"] { width: 100%; padding: 12px 14px; border: 1px solid #ddd; border-radius: 5px; font-size: 1rem; font-family: Georgia, serif; }
        input[type="text"]:focus { outline: none; border-color: #E87722; }
        .imagen-preview img { max-height: 80px; border-radius: 4px; margin-top: 6px; }
        .acciones { display: flex; gap: 12px; margin-top: 24px; padding-top: 20px; border-top: 1px solid #ddd; }
        .btn-publicar { background: #E87722; color: white; border: none; padding: 12px 32px; border-radius: 5px; font-size: 1rem; font-weight: 700; cursor: pointer; }
        .btn-publicar:hover { background: #c9640f; }
        .btn-cancelar { background: white; color: #666; border: 1px solid #ddd; padding: 12px 24px; border-radius: 5px; font-size: 0.9rem; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
        #notificacion { display: none; padding: 12px 18px; border-radius: 5px; margin-bottom: 20px; font-size: 0.9rem; font-weight: 600; }
        #notificacion.exito { background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7; }
        #notificacion.error { background: #fdecea; color: #c62828; border: 1px solid #ef9a9a; }
    </style>
</head>
<body>
<header>
    <div class="logo"><span>🏮</span><h1>EL FAROL AL DÍA — Redacción</h1></div>
    <div class="header-links"><a href="/admin">← Volver al panel</a></div>
</header>
<main>
    <div class="page-title">{{ '✏️ Editar Nota' if modo == 'editar' else '📝 Nueva Nota' }}</div>
    <div id="notificacion"></div>
    <div class="form-grupo">
        <label for="titulo">Titular de la nota</label>
        <input type="text" id="titulo" placeholder="Escribe el titular aquí..." value="{{ noticia.titulo if noticia else '' }}" maxlength="300">
    </div>
    <div class="form-grupo">
        <label for="imagen">URL de imagen principal (opcional)</label>
        <input type="text" id="imagen" placeholder="https://..." value="{{ noticia.imagen if noticia and noticia.imagen else '' }}">
        <div class="imagen-preview" id="previewImagen"></div>
    </div>
    <div class="form-grupo">
        <label>Contenido de la nota</label>
        <textarea id="contenido">{{ noticia.contenido | safe if noticia else '' }}</textarea>
    </div>
    <div class="acciones">
        <button class="btn-publicar" onclick="guardarNoticia()">{{ '💾 Guardar cambios' if modo == 'editar' else '🚀 Publicar ahora' }}</button>
        <a href="/admin" class="btn-cancelar">Cancelar</a>
    </div>
</main>
<script>
tinymce.init({
    selector: '#contenido',
    language: 'es',
    height: 480,
    menubar: false,
    plugins: 'link image lists media table code',
    toolbar: 'undo redo | bold italic underline | alignleft aligncenter alignright | bullist numlist | link image | table | code',
    images_upload_url: '/upload',
    automatic_uploads: true,
    content_style: 'body { font-family: Georgia, serif; font-size: 16px; line-height: 1.7; }'
});

document.getElementById('imagen').addEventListener('input', function() {
    const url = this.value.trim();
    document.getElementById('previewImagen').innerHTML = url ? `<img src="${url}" alt="preview">` : '';
});
window.addEventListener('load', () => document.getElementById('imagen').dispatchEvent(new Event('input')));

const MODO = "{{ modo }}";
const NOTICIA_ID = {{ noticia.id if noticia else 'null' }};

function guardarNoticia() {
    const titulo    = document.getElementById('titulo').value.trim();
    const imagen    = document.getElementById('imagen').value.trim() || null;
    const contenido = tinymce.get('contenido').getContent();
    if (!titulo) { mostrarNotif('El titular es obligatorio.', 'error'); return; }
    if (!contenido || contenido === '<p><br></p>') { mostrarNotif('El contenido no puede estar vacío.', 'error'); return; }
    const url    = MODO === 'editar' ? `/noticias/${NOTICIA_ID}` : '/noticias';
    const metodo = MODO === 'editar' ? 'PUT' : 'POST';
    fetch(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo, contenido, imagen })
    })
    .then(r => r.json())
    .then(data => {
        if (data.id || data.mensaje) {
            mostrarNotif(MODO === 'editar' ? '✅ Nota actualizada.' : '✅ Nota publicada.', 'exito');
            setTimeout(() => { window.location.href = `/nota/${data.id || NOTICIA_ID}`; }, 1200);
        } else {
            mostrarNotif('Error: ' + (data.error || 'No se pudo guardar.'), 'error');
        }
    })
    .catch(() => mostrarNotif('Error de conexión.', 'error'));
}

function mostrarNotif(msg, tipo) {
    const n = document.getElementById('notificacion');
    n.textContent = msg;
    n.className = tipo;
    n.style.display = 'block';
    if (tipo === 'exito') setTimeout(() => n.style.display = 'none', 4000);
}
</script>
</body>
</html>
```

---

**6. `templates/404.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Página no encontrada — El Farol al Día</title>
    <style>
        body { font-family: Arial, sans-serif; background: #f5f0e8; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
        .caja { text-align: center; }
        .icono { font-size: 5rem; }
        h1 { font-size: 1.8rem; color: #1a3a5c; margin: 16px 0 8px; }
        p { color: #888; }
        a { color: #E87722; font-weight: bold; text-decoration: none; }
    </style>
</head>
<body>
    <div class="caja">
        <div class="icono">🏮</div>
        <h1>Esta nota no existe</h1>
        <p>Puede que haya sido eliminada o el enlace sea incorrecto.</p>
        <p style="margin-top:20px"><a href="/">← Volver a la portada</a></p>
    </div>
</body>
</html>
```

---






