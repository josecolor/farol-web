import os, re, bleach
from flask import Flask, render_template_string, request, redirect, url_for, session, flash, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "farol_mxl_2026_oficial_master")

# --- CONFIGURACIÓN DE MULTIMEDIA (CELULAR/PC) ---
UPLOAD_FOLDER = 'static/uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'mp4', 'mov', 'webp'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# --- BASE DE DATOS PROFESIONAL ---
uri = os.getenv("DATABASE_URL", "sqlite:///farol.db")
if uri and uri.startswith("postgres://"): uri = uri.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(250), nullable=False)
    contenido = db.Column(db.Text, nullable=False)
    imagen_url = db.Column(db.String(500))
    keywords = db.Column(db.String(200))
    vistas = db.Column(db.Integer, default=0)
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

class Config(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sitio_nombre = db.Column(db.String(100), default="El Farol")
    seo_mantra = db.Column(db.String(100), default="seoacuerdate mxl")

with app.app_context():
    db.create_all()
    if not Config.query.first(): db.session.add(Config()); db.session.commit()

# --- DISEÑO PRO ESTILO WORDPRESS (TODO EN UNO) ---
ADMIN_LAYOUT = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Panel El Farol Pro</title>
    <script src="https://cdn.tiny.cloud/1/no-api-key/tinymce/6/tinymce.min.js" referrerpolicy="origin"></script>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; display: flex; background: #f0f2f1; }
        .sidebar { width: 200px; background: #1d2327; color: white; height: 100vh; position: fixed; }
        .sidebar h2 { background: #FF8C00; margin: 0; padding: 15px; font-family: Impact, sans-serif; text-align: center; color: white; }
        .sidebar a { display: block; color: #f0f0f1; padding: 12px; text-decoration: none; font-size: 14px; border-bottom: 1px solid #333; }
        .sidebar a:hover { background: #FF8C00; }
        .main { margin-left: 200px; padding: 20px; width: 100%; }
        .editor-container { background: white; border: 1px solid #ccd0d4; padding: 20px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .wp-title { width: 100%; padding: 10px; font-size: 1.7em; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 4px; }
        .side-card { background: white; padding: 15px; border: 1px solid #ccd0d4; margin-bottom: 20px; border-radius: 4px; }
        .btn-pub { background: #2271b1; color: white; border: none; padding: 12px 24px; border-radius: 3px; cursor: pointer; font-weight: bold; width: 100%; font-size: 1.1em; }
        .upload-input { border: 2px dashed #2271b1; padding: 15px; width: 100%; box-sizing: border-box; background: #f9fcff; cursor: pointer; }
    </style>
</head>
<body>
    <div class="sidebar">
        <h2>🏮 EL FAROL</h2>
        <a href="/admin">📝 Entradas</a>
        <a href="/configuracion">⚙️ Configuración</a>
        <a href="/" target="_blank">👁️ Ver Sitio</a>
        <a href="/logout" style="color:#ff6666; margin-top:20px;">Cerrar Sesión</a>
    </div>
    <div class="main">
        <form method="POST" enctype="multipart/form-data">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h1 style="font-size: 23px; font-weight: 400;">Añadir nueva entrada</h1>
                <div style="width: 150px;"><button type="submit" class="btn-pub">Publicar</button></div>
            </div>
            <div style="display: grid; grid-template-columns: 3fr 1fr; gap: 20px;">
                <div class="editor-container">
                    <input type="text" name="titulo" class="wp-title" placeholder="Introduce el título aquí" required>
                    <textarea name="contenido" id="wp_editor"></textarea>
                </div>
                <div>
                    <div class="side-card">
                        <h3 style="margin-top:0;">📁 Multimedia</h3>
                        <p style="font-size: 12px; color: #666;">Sube foto o video desde tu celular/PC:</p>
                        <input type="file" name="archivo" class="upload-input" accept="image/*,video/*">
                    </div>
                    <div class="side-card">
                        <h3>🔍 SEO & Mantra</h3>
                        <label>Keywords:</label>
                        <input type="text" name="keywords" value="{{ conf.seo_mantra }}" style="width:100%; padding:8px; margin-top:5px;">
                        <p style="font-size: 11px; color: #888; margin-top:10px;">Mantra activo: <b>{{ conf.seo_mantra }}</b></p>
                    </div>
                </div>
            </div>
        </form>
    </div>
    <script>
        tinymce.init({
            selector: '#wp_editor',
            height: 500,
            plugins: 'advlist autolink lists link image charmap preview anchor searchreplace visualblocks code fullscreen insertdatetime media table code help wordcount',
            toolbar: 'undo redo | blocks | bold italic | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | link image media | removeformat'
        });
    </script>
</body>
</html>
'''

# --- RUTAS DE ACCESO ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form.get('u') == 'director' and request.form.get('p') == 'farol2026':
            session['logged'] = True
            return redirect('/admin')
        flash("Credenciales incorrectas")
    return '''<body style="background:#1d2327; display:flex; justify-content:center; align-items:center; height:100vh; margin:0; font-family:sans-serif;">
        <form method="POST" style="background:white; padding:40px; border-radius:8px; width:300px; text-align:center;">
            <h1 style="font-family:Impact; color:#FF8C00;">🏮 EL FAROL</h1>
            <input name="u" placeholder="Usuario" style="width:100%; padding:10px; margin-bottom:10px;">
            <input type="password" name="p" placeholder="Contraseña" style="width:100%; padding:10px; margin-bottom:20px;">
            <button style="width:100%; background:#FF8C00; color:white; border:none; padding:12px; font-weight:bold; cursor:pointer;">ENTRAR</button>
        </form></body>'''

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if not session.get('logged'): return redirect('/login')
    conf = Config.query.first()
    if request.method == 'POST':
        archivo = request.files.get('archivo')
        url_media = ""
        if archivo and allowed_file(archivo.filename):
            filename = secure_filename(archivo.filename)
            archivo.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            url_media = f"/static/uploads/{filename}"
        
        nueva = Noticia(
            titulo=request.form['titulo'],
            contenido=request.form['contenido'],
            imagen_url=url_media,
            keywords=request.form.get('keywords')
        )
        db.session.add(nueva); db.session.commit()
        return redirect('/admin')
    return render_template_string(ADMIN_LAYOUT, conf=conf)

@app.route('/configuracion', methods=['GET', 'POST'])
def configuracion():
    if not session.get('logged'): return redirect('/login')
    conf = Config.query.first()
    if request.method == 'POST':
        conf.sitio_nombre = request.form.get('sitio_nombre')
        conf.seo_mantra = request.form.get('seo_mantra')
        db.session.commit()
        return redirect('/admin')
    return render_template_string('<h1>Configuración</h1><form method="POST">Nombre: <input name="sitio_nombre" value="{{conf.sitio_nombre}}"><br>Mantra SEO: <input name="seo_mantra" value="{{conf.seo_mantra}}"><br><button>Guardar</button></form>', conf=conf)

@app.route('/logout')
def logout():
    session.clear(); return redirect('/login')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
