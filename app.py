"""
╔══════════════════════════════════════════════════════════════╗
║           EL FAROL AL DÍA — BACKEND DE PRODUCCIÓN           ║
║   Identidad: Farol azul · Estrella blanca · Fondo naranja    ║
║   SEO Firma: seoacuerdate mxl                                ║
║   Tags Mandatorios: National · Viral · Mexicali              ║
╚══════════════════════════════════════════════════════════════╝
"""

import os
import uuid
import logging
from flask import Flask, render_template, request, jsonify, url_for
from werkzeug.utils import secure_filename
from flask_wtf.csrf import CSRFProtect, generate_csrf

# ─────────────────────────────────────────────────────────────
#  SISTEMA DE LOGS — Railway imprime esto en su consola en vivo
# ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
#  INICIALIZACIÓN DE LA APLICACIÓN
# ─────────────────────────────────────────────────────────────
app = Flask(__name__)

# ─────────────────────────────────────────────────────────────
#  CONFIGURACIÓN MAESTRA
#  SECRET_KEY se lee desde Railway Environment Variables.
#  Si no existe la variable, usa el valor por defecto local.
# ─────────────────────────────────────────────────────────────
app.config['SECRET_KEY']         = os.environ.get('SECRET_KEY', 'farol2026')
app.config['UPLOAD_FOLDER']      = 'static/uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # Límite: 16 MB

# Extensiones permitidas — solo imágenes seguras para el portal
EXTENSIONES_PERMITIDAS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}

csrf = CSRFProtect(app)

# ─────────────────────────────────────────────────────────────
#  CREAR CARPETA DE UPLOADS AL INICIAR
#  exist_ok=True evita error si la carpeta ya existe en Railway
# ─────────────────────────────────────────────────────────────
ruta_uploads = os.path.join(app.root_path, app.config['UPLOAD_FOLDER'])
os.makedirs(ruta_uploads, exist_ok=True)
logger.info(f"✅ Carpeta de uploads lista en: {ruta_uploads}")

# ─────────────────────────────────────────────────────────────
#  FUNCIÓN DE VALIDACIÓN DE ARCHIVOS
#  Restringe uploads a imágenes únicamente. Bloquea ejecutables.
# ─────────────────────────────────────────────────────────────
def allowed_file(filename):
    """Devuelve True solo si la extensión está en la lista permitida."""
    return (
        '.' in filename and
        filename.rsplit('.', 1)[1].lower() in EXTENSIONES_PERMITIDAS
    )

# ─────────────────────────────────────────────────────────────
#  INYECTOR GLOBAL DE CSRF PARA TODAS LAS PLANTILLAS HTML
# ─────────────────────────────────────────────────────────────
@app.context_processor
def inject_csrf():
    return dict(csrf_token=generate_csrf)

# ─────────────────────────────────────────────────────────────
#  MANEJADORES DE ERROR
# ─────────────────────────────────────────────────────────────
@app.errorhandler(413)
def error_archivo_grande(e):
    """413 — El archivo supera el límite de 16 MB."""
    logger.warning("⚠️  Intento de subida rechazado: archivo mayor a 16 MB.")
    return jsonify({'error': 'El archivo supera los 16 MB permitidos.'}), 413

@app.errorhandler(404)
def error_no_encontrado(e):
    """404 — Ruta no existe en el sistema."""
    return jsonify({'error': 'Ruta no encontrada en El Farol al Día.'}), 404

@app.errorhandler(500)
def error_interno(e):
    """500 — Fallo crítico del servidor. Se registra en logs de Railway."""
    logger.error(f"🔴 Error interno del servidor: {e}")
    return jsonify({'error': 'Error interno. El equipo técnico fue notificado.'}), 500

# ─────────────────────────────────────────────────────────────
#  RUTAS PRINCIPALES
# ─────────────────────────────────────────────────────────────
@app.route('/')
def index():
    """Ruta raíz — confirma que el sistema está en línea en Railway."""
    return "<h1>🏮 EL FAROL AL DÍA — SISTEMA EN LÍNEA</h1>"

@app.route('/admin')
def admin_panel():
    """Panel de administración con TinyMCE integrado."""
    return render_template('admin.html')

# ─────────────────────────────────────────────────────────────
#  ENDPOINT DE SUBIDA DE IMÁGENES PARA TINYMCE
#
#  @csrf.exempt — TinyMCE no envía token CSRF en su petición.
#  UUID4 garantiza nombre único por imagen, lo que permite
#  al front-end aplicar procesamiento individual (ej: blur 20%).
#  Tags activos: National · Viral · Mexicali (seoacuerdate mxl)
# ─────────────────────────────────────────────────────────────
@app.route('/upload', methods=['POST'])
@csrf.exempt
def upload_file():
    """Recibe imágenes de TinyMCE, las valida y las guarda con UUID."""

    if 'file' not in request.files:
        logger.warning("⚠️  Petición de subida sin campo 'file'.")
        return jsonify({'error': 'No se recibió ningún archivo.'}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({'error': 'El archivo no tiene nombre.'}), 400

    if not allowed_file(file.filename):
        logger.warning(f"⛔ Extensión no permitida: {file.filename}")
        return jsonify({'error': 'Tipo de archivo no permitido. Usa PNG, JPG, GIF o WEBP.'}), 400

    try:
        # UUID4 + nombre seguro: evita colisiones y ataques de path traversal
        nombre_seguro = secure_filename(file.filename)
        filename      = f"{uuid.uuid4().hex}_{nombre_seguro}"
        filepath      = os.path.join(ruta_uploads, filename)

        file.save(filepath)
        logger.info(f"✅ Imagen guardada correctamente: {filename}")

        # Devuelve la URL pública que TinyMCE usa para mostrar la imagen
        file_url = url_for('static', filename=f'uploads/{filename}', _external=True)
        return jsonify({'location': file_url})

    except Exception as e:
        logger.error(f"🔴 Fallo al guardar imagen: {e}")
        return jsonify({'error': 'Error al guardar el archivo en el servidor.'}), 500

# ─────────────────────────────────────────────────────────────
#  ARRANQUE CON PUERTO DINÁMICO DE RAILWAY
#  Railway inyecta la variable PORT en tiempo de ejecución.
#  Si no existe (entorno local), usa el puerto 5000 por defecto.
#  host='0.0.0.0' es obligatorio para que Railway enrute el tráfico.
#  debug=False es obligatorio en producción.
# ─────────────────────────────────────────────────────────────
if __name__ == '__main__':
    puerto_sistema = int(os.environ.get("PORT", 5000))
    logger.info(f"🏮 Farol al Día iniciando en puerto {puerto_sistema}...")
    app.run(host='0.0.0.0', port=puerto_sistema, debug=False)
