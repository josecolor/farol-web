import os
import uuid
from flask import Flask, render_template, request, jsonify, url_for, redirect, flash
from werkzeug.utils import secure_filename
from flask_wtf.csrf import CSRFProtect, generate_csrf

app = Flask(__name__)

# CONFIGURACIÓN MAESTRA
app.config['SECRET_KEY'] = 'farol2026'
app.config['UPLOAD_FOLDER'] = 'static/uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024 
csrf = CSRFProtect(app)

# Crear carpetas para Railway
os.makedirs(os.path.join(app.root_path, app.config['UPLOAD_FOLDER']), exist_ok=True)

@app.context_processor
def inject_csrf():
    return dict(csrf_token=generate_csrf)

@app.route('/')
def index():
    return "<h1>EL FAROL AL DÍA - PORTADA</h1>"

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
        # URL profesional para que la imagen no se quede en el aire
        file_url = url_for('static', filename=f'uploads/{filename}', _external=True)
        return jsonify({'location': file_url})
    return jsonify({'error': 'Error de subida'}), 400

@app.route('/admin')
def admin_panel():
    return render_template('admin.html')

# --- CORRECCIÓN FINAL DEL PUERTO ---
if __name__ == '__main__':
    # Obtenemos el puerto de Railway, por defecto 5000
    port = int(os.environ.get("PORT", 5000))
    # SE ELIMINÓ EL ERROR port-port
    app.run(host='0.0.0.0', port=port)
