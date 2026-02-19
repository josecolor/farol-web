import os
import uuid
from flask import Flask, render_template, request, jsonify, url_for, redirect, flash
from werkzeug.utils import secure_filename
from flask_wtf.csrf import CSRFProtect, generate_csrf

app = Flask(__name__)

# CONFIGURACIÓN MAESTRA DE SEGURIDAD
app.config['SECRET_KEY'] = 'farol2026'
app.config['UPLOAD_FOLDER'] = 'static/uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024 
csrf = CSRFProtect(app)

# Asegurar que las carpetas existan en el servidor
os.makedirs(os.path.join(app.root_path, app.config['UPLOAD_FOLDER']), exist_ok=True)

@app.context_processor
def inject_csrf():
    return dict(csrf_token=generate_csrf)

@app.route('/')
def index():
    return "<h1>EL FAROL AL DÍA: PORTADA ACTIVA</h1>"

@app.route('/upload', methods=['POST'])
@csrf.exempt 
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file:
        filename = f"{uuid.uuid4().hex}_{secure_filename(file.filename)}"
        filepath = os.path.join(app.root_path, app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        # URL profesional para el editor
        file_url = url_for('static', filename=f'uploads/{filename}', _external=True)
        return jsonify({'location': file_url})
    return jsonify({'error': 'Error de subida'}), 400

@app.route('/admin')
def admin_panel():
    return render_template('admin.html')

# --- CORRECCIÓN DEFINITIVA DEL PUERTO ---
if __name__ == '__main__':
    # Tomamos el puerto que Railway nos asigne
    server_port = int(os.environ.get("PORT", 5000))
    # Eliminamos el error de resta (port-port)
    app.run(host='0.0.0.0', port=server_port)
