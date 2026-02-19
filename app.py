import os, re
from flask import Flask, render_template_string, request, redirect, url_for, session, flash
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename
from datetime import datetime

app = Flask(__name__)
app.secret_key = "farol_mxl_2026_oficial_master"

# --- CONFIGURACIÓN MULTIMEDIA ---
UPLOAD_FOLDER = 'static/uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# --- BASE DE DATOS ---
uri = os.getenv("DATABASE_URL", "sqlite:///farol.db")
if uri and uri.startswith("postgres://"): uri = uri.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = uri
db = SQLAlchemy(app)

class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(250))
    contenido = db.Column(db.Text)
    media_url = db.Column(db.String(500)) # Para links externos
    archivo_local = db.Column(db.String(500)) # Para subidas directas
    keywords = db.Column(db.String(200), default="seoacuerdate mxl")
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context(): db.create_all()

# --- PANEL DE CONTROL REFORZADO ---
ADMIN_HTML = '''
<!DOCTYPE html>
<html>
<head>
    <title>Panel El Farol Pro</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script src="https://cdn.ckeditor.com/4.22.1/standard/ckeditor.js"></script>
    <style>
        body { font-family: sans-serif; margin: 0; display: flex; background: #f4f7f6; }
        .sidebar { width: 220px; background: #1d2327; color: white; height: 100vh; position: fixed; }
        .sidebar h2 { background: #FF8C00; padding: 20px; margin: 0; font-family: 'Impact'; text-align: center; }
        .main { margin-left: 220px; padding: 20px; width: 100%; }
        .card { background: white; padding: 20px; border-radius: 8px; border: 1px solid #ddd; margin-bottom: 20px; }
        .btn-pub { background: #2271b1; color: white; border: none; padding: 15px; width: 100%; cursor: pointer; font-weight: bold; border-radius: 4px; font-size: 16px; }
        input, select { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
        .section-title { color: #003366; font-family: Impact; border-bottom: 2px solid #FF8C00; padding-bottom: 5px; }
    </style>
</head>
<body>
    <div class="sidebar">
        <h2>🏮 EL FAROL</h2>
        <a href="/admin" style="color:white; display:block; padding:15px; text-decoration:none;">📝 Nueva Entrada</a>
        <a href="/logout" style="color:#ff6666; display:block; padding:15px; text-decoration:none;">❌ Salir</a>
    </div>
    <div class="main">
        <form method="POST" enctype="multipart/form-data">
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
                <div>
                    <div class="card">
                        <h3 class="section-title">CONTENIDO DE LA NOTICIA</h3>
                        <input type="text" name="titulo" placeholder="Título de impacto aquí..." required>
                        <textarea name="contenido" id="editor1"></textarea>
                    </div>
                </div>
                <div>
                    <div class="card">
                        <button type="submit" class="btn-pub">🚀 PUBLICAR AHORA</button>
                    </div>
                    <div class="card">
                        <h3 class="section-title">MULTIMEDIA (DOBLE VÍA)</h3>
                        <p style="font-size:12px; color:#666;"><b>Opción A:</b> Pegar Link (YouTube/Imagen)</p>
                        <input type="text" name="media_url" placeholder="https://youtube.com/...">
                        
                        <p style="font-size:12px; color:#666;"><b>Opción B:</b> Subir desde Celular/PC</p>
                        <input type="file" name="archivo" accept="image/*,video/*" style="border: 2px dashed #2271b1; background: #f0f8ff;">
                    </div>
                    <div class="card">
                        <h3 class="section-title">CONFIGURACIÓN SEO</h3>
                        <label>Mantra MXL:</label>
                        <input type="text" name="keywords" value="seoacuerdate mxl">
                    </div>
                </div>
            </div>
        </form>
    </div>
    <script>CKEDITOR.replace('editor1', { height: 400 });</script>
</body>
</html>
'''

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form['u'] == 'director' and request.form['p'] == 'farol2026':
            session['logged'] = True
            return redirect('/admin')
    return '<body style="background:#1d2327; color:white; text-align:center; padding-top:100px;"><form method="POST" style="background:white; color:black; display:inline-block; padding:40px; border-radius:10px;"><h1>🏮 Login Director</h1><input name="u" placeholder="Usuario"><br><input type="password" name="p" placeholder="Clave"><br><br><button style="background:#FF8C00; color:white; border:none; padding:10px; width:100%;">ENTRAR</button></form></body>'

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if not session.get('logged'): return redirect('/login')
    if request.method == 'POST':
        archivo = request.files.get('archivo')
        nombre_local = ""
        if archivo and archivo.filename != '':
            nombre_local = secure_filename(archivo.filename)
            archivo.save(os.path.join(app.config['UPLOAD_FOLDER'], nombre_local))

        nueva = Noticia(
            titulo=request.form['titulo'],
            contenido=request.form['contenido'],
            media_url=request.form.get('media_url'),
            archivo_local=nombre_local,
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
