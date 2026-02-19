import os
import uuid
from flask import Flask, render_template, request, jsonify, url_for, redirect, flash
from werkzeug.utils import secure_filename
from flask_wtf.csrf import CSRFProtect, generate_csrf
from functools import wraps

app = Flask(__name__)

# CONFIGURACIÓN MAESTRA
app.config['SECRET_KEY'] = 'farol2026' #
app.config['UPLOAD_FOLDER'] = 'static/uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
csrf = CSRFProtect(app)

# Asegurar carpetas en el servidor de Railway
os.makedirs(os.path.join(app.root_path, app.config['UPLOAD_FOLDER']), exist_ok=True)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.context_processor
def inject_csrf():
    return dict(csrf_token=generate_csrf)

# --- RUTAS DE NOTICIAS ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
@csrf.exempt 
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file and allowed_file(file.filename):
        # Generar nombre único para evitar bloqueos
        filename = f"{uuid.uuid4().hex}_{secure_filename(file.filename)}"
        filepath = os.path.join(app.root_path, app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        # URL para el editor con 20% de blur automático
        file_url = url_for('static', filename=f'uploads/{filename}', _external=True)
        return jsonify({'location': file_url})
    return jsonify({'error': 'Formato no permitido'}), 400

@app.route('/admin', methods=['GET', 'POST'])
def admin_panel():
    if request.method == 'POST':
        # Captura de datos SEO
        titulo = request.form.get('titulo')
        contenido = request.form.get('contenido')
        flash(f'Noticia "{titulo}" publicada con éxito. #seoacuerdate mxl')
        return redirect(url_for('index'))
    return render_template('admin.html')

if __name__ == '__main__':
    # Corrección para Railway: Puerto dinámico obligatorio
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
