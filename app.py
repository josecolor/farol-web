import os, re, bleach
from flask import Flask, render_template_string, request, redirect, url_for, session, flash
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

app = Flask(__name__)
app.secret_key = "farol_mxl_2026_oficial"

# --- BASE DE DATOS ---
uri = os.getenv("DATABASE_URL", "sqlite:///farol.db")
if uri.startswith("postgres://"): uri = uri.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(250))
    contenido = db.Column(db.Text)
    imagen_url = db.Column(db.String(500))
    keywords = db.Column(db.String(200))
    vistas = db.Column(db.Integer, default=0)
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context(): db.create_all()

# --- DISEÑO PROFESIONAL (SIDEBAR + EDITOR WP) ---
ADMIN_HTML = '''
<!DOCTYPE html>
<html>
<head>
    <title>Panel El Farol | Mexicali</title>
    <script src="https://cdn.tiny.cloud/1/no-api-key/tinymce/6/tinymce.min.js" referrerpolicy="origin"></script>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; display: flex; background: #f0f2f1; }
        .sidebar { width: 240px; background: #1d2327; color: white; height: 100vh; position: fixed; }
        .sidebar h2 { background: #FF8C00; color: white; margin: 0; padding: 20px; font-family: 'Impact'; text-align: center; }
        .sidebar a { display: block; color: #ebebeb; padding: 15px; text-decoration: none; border-bottom: 1px solid #333; font-size: 14px; }
        .sidebar a:hover { background: #FF8C00; color: white; }
        .main { margin-left: 240px; padding: 30px; width: calc(100% - 240px); }
        .editor-card { background: white; padding: 25px; border-radius: 4px; border: 1px solid #ccd0d4; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .wp-title { width: 100%; padding: 10px; font-size: 1.7em; margin-bottom: 20px; border: 1px solid #ddd; }
        .btn-pub { background: #2271b1; color: white; border: none; padding: 12px 24px; border-radius: 3px; cursor: pointer; font-weight: bold; float: right; }
        .btn-pub:hover { background: #135e96; }
        .seo-box { background: #f9f9f9; padding: 15px; border: 1px solid #ddd; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="sidebar">
        <h2>🏮 EL FAROL</h2>
        <a href="/admin">📝 Todas las Entradas</a>
        <a href="/admin">📊 Estadísticas</a>
        <a href="/configuracion">⚙️ Configuración SEO</a>
        <a href="/" target="_blank">👁️ Ver Sitio Público</a>
        <a href="/logout" style="color: #ff6666; margin-top: 20px;">Cerrar Sesión</a>
    </div>
    <div class="main">
        <h1 style="font-weight: 400;">Añadir nueva entrada</h1>
        <form method="POST">
            <div style="display: grid; grid-template-columns: 3fr 1fr; gap: 20px;">
                <div class="editor-card">
                    <input type="text" name="titulo" class="wp-title" placeholder="Introduce el título aquí" required>
                    <textarea name="contenido" id="myeditor"></textarea>
                </div>
                <div>
                    <div class="editor-card">
                        <button type="submit" class="btn-pub">Publicar</button>
                        <div style="clear:both;"></div>
                        <hr>
                        <p><b>Estado:</b> Borrador</p>
                        <p><b>Visibilidad:</b> Público</p>
                    </div>
                    <div class="editor-card" style="margin-top:20px;">
                        <h3>Imagen y SEO</h3>
                        <label>URL Imagen (Blur 20%):</label>
                        <input type="text" name="imagen_url" style="width:100%; margin: 10px 0;">
                        <label>Keywords (Mantra):</label>
                        <input type="text" name="keywords" value="seoacuerdate mxl" style="width:100%; margin: 10px 0;">
                    </div>
                </div>
            </div>
        </form>
    </div>
    <script>
        tinymce.init({
            selector: '#myeditor',
            plugins: 'advlist autolink lists link image charmap preview anchor searchreplace visualblocks code fullscreen insertdatetime media table code help wordcount',
            toolbar: 'undo redo | formatselect | bold italic backcolor | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | removeformat | help',
            height: 500
        });
    </script>
</body>
</html>
'''

# --- RUTAS ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form['u'] == 'director' and request.form['p'] == 'farol2026':
            session['logged'] = True
            return redirect('/admin')
    return '''
    <body style="background:#1d2327; color:white; font-family:sans-serif; text-align:center; padding-top:100px;">
        <h1 style="font-family:Impact; color:#FF8C00; font-size:3em;">🏮 EL FAROL</h1>
        <form method="POST" style="background:white; display:inline-block; padding:30px; border-radius:8px; color:black;">
            <input name="u" placeholder="Usuario" style="width:100%; padding:10px; margin:5px;"><br>
            <input type="password" name="p" placeholder="Contraseña" style="width:100%; padding:10px; margin:5px;"><br>
            <button style="width:100%; background:#FF8C00; color:white; border:none; padding:10px; font-weight:bold; cursor:pointer;">ENTRAR AL PANEL</button>
        </form>
    </body>'''

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if not session.get('logged'): return redirect('/login')
    if request.method == 'POST':
        nueva = Noticia(
            titulo=request.form['titulo'], 
            contenido=request.form['contenido'],
            imagen_url=request.form.get('imagen_url'),
            keywords=request.form.get('keywords')
        )
        db.session.add(nueva); db.session.commit()
        return redirect('/admin')
    return render_template_string(ADMIN_HTML)

@app.route('/logout')
def logout():
    session.clear(); return redirect('/login')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
