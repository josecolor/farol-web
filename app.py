import os
import uuid
from flask import Flask, render_template, request, jsonify, url_for, redirect, flash
from werkzeug.utils import secure_filename
from flask_wtf.csrf import CSRFProtect, generate_csrf
from functools import wraps

app = Flask(__name__)

# --- CONFIGURACIÓN DE SEGURIDAD Y RUTAS ---
app.config['SECRET_KEY'] = 'farol2026' # Su clave maestra
app.config['UPLOAD_FOLDER'] = 'static/uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024 # Límite de 16MB
csrf = CSRFProtect(app)

# Garantizar carpetas para evitar errores de despliegue en Railway
os.makedirs(os.path.join(app.root_path, app.config['UPLOAD_FOLDER']), exist_ok=True)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# Inyección de seguridad global para el editor TinyMCE
@app.context_processor
def inject_csrf():
    return dict(csrf_token=generate_csrf)

# --- SISTEMA DE GESTIÓN DE NOTICIAS ---

@app.route('/')
def index():
    # Aquí el sistema mostrará las noticias que "ruedan" hacia abajo
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
@csrf.exempt # Exención manual para facilitar la subida desde el editor JS
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file and allowed_file(file.filename):
        filename = f"{uuid.uuid4().hex}_{secure_filename(file.filename)}"
        filepath = os.path.join(app.root_path, app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        # Genera la URL pública con el 20% de blur automático en el front
        file_url = url_for('static', filename=f'uploads/{filename}', _external=True)
        return jsonify({'location': file_url})
    return jsonify({'error': 'Extensión no permitida'}), 400

@app.route('/admin', methods=['GET', 'POST'])
def admin_panel():
    if request.method == 'POST':
        # Captura de datos del sistema "Farol al Día"
        titulo = request.form.get('titulo')
        contenido = request.form.get('contenido')
        tags = request.form.get('tags') # National, Viral, Mexicali
        
        # Aquí se guardaría en la base de datos (PostgreSQL/SQLite)
        # Por ahora, confirmamos la recepción exitosa
        flash(f'Noticia "{titulo}" publicada con éxito bajo el sistema seoacuerdate mxl')
        return redirect(url_for('index'))
        
    return render_template('admin.html') # El template con TinyMCE configurado

if __name__ == '__main__':
    # Puerto dinámico para Railway
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
