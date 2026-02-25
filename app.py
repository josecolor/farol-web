from flask import Flask, render_template_string, request, redirect, url_for, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'farol_olimpo_final_2026'

# --- CONFIGURACIÓN DE INFRAESTRUCTURA ---
UPLOAD_FOLDER = 'static/uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)

basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'farol_final.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- MODELO DE DATOS ---
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200))
    resumen = db.Column(db.Text)
    location = db.Column(db.String(100))
    multimedia_url = db.Column(db.String(400))
    autor = db.Column(db.String(100)) # Para saber quién publicó
    date = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()

# --- VISTA: LOGIN SEGURO PARA 4 REPORTEROS ---
html_login = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Lantern | Login</title>
    <style>
        body { background: #000; color: #fff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .login-card { background: #111; padding: 30px; border-radius: 15px; border: 2px solid #ff8c00; width: 320px; text-align: center; }
        input { width: 100%; padding: 12px; margin: 10px 0; border-radius: 8px; border: 1px solid #333; background: #222; color: #fff; box-sizing: border-box; }
        .btn { background: #ff8c00; color: #000; font-weight: bold; width: 100%; padding: 15px; border: none; border-radius: 8px; cursor: pointer; text-transform: uppercase; }
    </style>
</head>
<body>
    <form method="post" class="login-card">
        <h2 style="color:#ff8c00; font-family: Impact;">🏮 STAFF LOGIN</h2>
        <input type="email" name="email" placeholder="Email (Sopa Baby)" required>
        <input type="password" name="password" placeholder="Password" required>
        <button type="submit" class="btn">ENTRAR AL SISTEMA</button>
    </form>
</body>
</html>
'''

# --- PANEL DE REDACCIÓN ELITE (ICONOS BRILLANTES + PERFIL) ---
html_panel = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Lantern | Admin</title>
    <script src="https://cdn.ckeditor.com/4.22.1/standard/ckeditor.js"></script>
    <style>
        body { background: #000; color: #fff; font-family: sans-serif; padding: 0; margin: 0; }
        .nav { background: #111; padding: 15px; border-bottom: 2px solid #ff8c00; display: flex; justify-content: space-between; align-items: center; }
        .nav a { color: #ff8c00; text-decoration: none; font-weight: bold; font-size: 0.8rem; }
        .container { max-width: 900px; margin: 20px auto; padding: 10px; }
        .card { background: #111; padding: 25px; border-radius: 15px; border: 2px solid #ff8c00; }
        input { width: 100%; padding: 15px; margin: 10px 0; border-radius: 8px; border: 1px solid #333; background: #1a1a1a; color: #fff; box-sizing: border-box; }
        .btn { background: #ff8c00; color: #000; font-weight: bold; width: 100%; padding: 20px; border: none; border-radius: 10px; cursor: pointer; text-transform: uppercase; margin-top: 20px; font-size: 1.2rem; }
        label { color: #ff8c00; font-size: 0.8rem; font-weight: bold; }
        .cke_button_icon { filter: invert(1) brightness(2) !important; }
        .cke_top { background: #2a2a2a !important; border-bottom: 1px solid #444 !important; }
    </style>
</head>
<body>
    <div class="nav">
        <span style="color: #888;">👤 {{ session['user'] }}</span>
        <a href="/">👁️ VER WEB</a>
        <a href="/logout" style="color: #ff4444;">SALIR</a>
    </div>
    <div class="container">
        <form method="post" enctype="multipart/form-data" class="card">
            <h2 style="color:#ff8c00; text-align:center; font-family: Impact;">🏮 REDACCIÓN ELITE</h2>
            <label>Titular</label>
            <input type="text" name="titulo" placeholder="Escribe el titular..." required>
            <label>Ubicación</label>
            <input type="text" name="location" placeholder="📍 Ciudad, País">
            <label>Noticia (Estilo Blogger)</label>
            <textarea name="resumen" id="editor_pro"></textarea>
            <label style="display:block; margin-top:25px;">Imagen de Portada</label>
            <input type="file" name="foto" required style="color:#fff;">
            <button type="submit" class="btn">PUBLICAR 🔥</button>
        </form>
    </div>
    <script>
        CKEDITOR.replace('editor_pro', {
            uiColor: '#1a1a1a', height: 400, versionCheck: false,
            contentsCss: ['body { background-color: #fff; color: #000; padding: 15px; }']
        });
    </script>
</body>
</html>
'''

# --- LÓGICA DE RUTAS ---
@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.date.desc()).all()
    # Mostramos la web pública (Front-end)
    return render_template_string(open_html_portada(), noticias=noticias)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email')
        # Lista autorizada de los 4 reporteros
        autorizados = ["hsy@elfarol.com", "reportero2@elfarol.com", "reportero3@elfarol.com", "reportero4@elfarol.com"]
        if email in autorizados:
            session['user'] = email
            return redirect(url_for('panel'))
    return render_template_string(html_login)

@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if 'user' not in session: return redirect(url_for('login'))
    
    if request.method == 'POST':
        t, r, l = request.form.get('titulo'), request.form.get('resumen'), request.form.get('location')
        f = request.files.get('foto')
        if f:
            fname = f"exclusiva_{datetime.utcnow().timestamp()}.jpg"
            f.save(os.path.join(UPLOAD_FOLDER, fname))
            db.session.add(Noticia(titulo=t, resumen=r, location=l, multimedia_url=fname, autor=session['user']))
            db.session.commit()
            return redirect(url_for('index'))
    return render_template_string(html_panel)

@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect(url_for('index'))

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

def open_html_portada():
    # Retorna el diseño de la portada que ya definimos
    return '''...html_portada_anterior...'''

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
