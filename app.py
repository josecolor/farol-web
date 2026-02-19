# coding: utf-8
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
                titulo          TEXT      NOT NULL,
                contenido       TEXT      NOT NULL,
                imagen          TEXT,
                creado_en       TIMESTAMP DEFAULT NOW(),
                actualizado_en  TIMESTAMP DEFAULT NOW()
            );
        """)
        conn.commit()
        cur.close()
        conn.close()
        logger.info("BD lista. Tabla noticias OK.")
    except Exception as e:
        logger.error("Error init_db: " + str(e))

init_db()

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in EXTENSIONES_PERMITIDAS

@app.context_processor
def inject_csrf():
    return dict(csrf_token=generate_csrf)

@app.errorhandler(413)
def error_grande(e):
    return jsonify({'error': 'Archivo mayor a 16 MB.'}), 413

@app.errorhandler(404)
def error_404(e):
    return render_template('404.html'), 404

@app.errorhandler(500)
def error_500(e):
    logger.error("Error 500: " + str(e))
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
        logger.error("Error portada: " + str(e))
        return "<h1>El Farol al Dia - Error al cargar.</h1>", 500

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
        logger.error("Error nota: " + str(e))
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
        logger.error("Error admin: " + str(e))
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
        logger.error("Error editor: " + str(e))
        return redirect('/admin')

@app.route('/noticias', methods=['POST'])
def crear_noticia():
    datos = request.get_json()
    if not datos:
        return jsonify({'error': 'No se recibieron datos.'}), 400
    titulo    = (datos.get('titulo') or '').strip()
    contenido = (datos.get('contenido') or '').strip()
    imagen    = datos.get('imagen') or None
    if not titulo or not contenido:
        return jsonify({'error': 'Titulo y contenido obligatorios.'}), 400
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
        logger.info("Noticia #" + str(nuevo_id) + " guardada.")
        return jsonify({'mensaje': 'Noticia publicada.', 'id': nuevo_id}), 201
    except Exception as e:
        logger.error("Error crear: " + str(e))
        return jsonify({'error': 'Error al guardar.'}), 500

@app.route('/noticias/<int:noticia_id>', methods=['PUT'])
def editar_noticia(noticia_id):
    datos = request.get_json()
    if not datos:
        return jsonify({'error': 'No se recibieron datos.'}), 400
    titulo    = (datos.get('titulo') or '').strip()
    contenido = (datos.get('contenido') or '').strip()
    imagen    = datos.get('imagen') or None
    if not titulo or not contenido:
        return jsonify({'error': 'Titulo y contenido obligatorios.'}), 400
    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute("""
            UPDATE noticias SET titulo=%s, contenido=%s, imagen=%s, actualizado_en=NOW()
            WHERE id=%s RETURNING id;
        """, (titulo, contenido, imagen, noticia_id))
        res = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        if not res:
            return jsonify({'error': 'Noticia no encontrada.'}), 404
        return jsonify({'mensaje': 'Noticia actualizada.', 'id': noticia_id}), 200
    except Exception as e:
        logger.error("Error editar: " + str(e))
        return jsonify({'error': 'Error al actualizar.'}), 500

@app.route('/noticias/<int:noticia_id>', methods=['DELETE'])
def eliminar_noticia(noticia_id):
    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute("DELETE FROM noticias WHERE id=%s RETURNING id;", (noticia_id,))
        res = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        if not res:
            return jsonify({'error': 'Noticia no encontrada.'}), 404
        return jsonify({'mensaje': 'Noticia eliminada.'}), 200
    except Exception as e:
        logger.error("Error eliminar: " + str(e))
        return jsonify({'error': 'Error al eliminar.'}), 500

@app.route('/upload', methods=['POST'])
@csrf.exempt
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'Sin archivo.'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Nombre vacio.'}), 400
    if not allowed_file(file.filename):
        return jsonify({'error': 'Extension no permitida.'}), 400
    try:
        nombre = uuid.uuid4().hex + '_' + secure_filename(file.filename)
        ruta   = os.path.join(ruta_uploads, nombre)
        file.save(ruta)
        url = url_for('static', filename='uploads/' + nombre, _external=True)
        return jsonify({'location': url})
    except Exception as e:
        logger.error("Error upload: " + str(e))
        return jsonify({'error': 'Error al guardar imagen.'}), 500

if __name__ == '__main__':
    puerto = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=puerto, debug=False)
