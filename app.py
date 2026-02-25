from flask import Flask, render_template_string, request, redirect, url_for, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'farol_final_safe_2026'

# CONFIGURACIÓN
UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///farol_olimpo_final.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# MODELOS
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200))
    resumen = db.Column(db.Text)
    keywords = db.Column(db.String(200))
    multimedia_url = db.Column(db.String(400))
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()

# --- PANEL DE PRENSA ESTILO BLOGGER (SIN ERROR ROJO) ---
html_panel = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Editor El Farol</title>
    <script src="https://cdn.ckeditor.com/4.25.1-lts/standard/ckeditor.js"></script>
    <style>
        body { background-color: #000; color: #fff; font-family: 'Segoe UI', sans-serif; padding: 10px; }
        .editor-container { max-width: 900px; margin: auto; background: #111; padding: 20px; border-radius: 15px; border: 2px solid #ff8c00; }
        .header-editor { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .btn-publicar { background: #ff8c00; color: #000; font-weight: 900; border: none; padding: 12px 30px; border-radius: 8px; cursor: pointer; text-transform: uppercase; }
        input[type="text"] { width: 100%; padding: 12px; margin-bottom: 15px; border-radius: 5px; border: none; background: #fff; color: #000; font-weight: bold; box-sizing: border-box; }
        .file-upload { background: #222; padding: 15px; border-radius: 8px; border: 1px dashed #ff8c00; margin-top: 15px; }
        label { color: #ff8c00; font-weight: bold; display: block; margin-bottom: 5px; }
    </style>
</head>
<body>
    <form method="post" enctype="multipart/form-data" class="editor-container">
        <div class="header-editor">
            <h2 style="color: #ff8c00; margin: 0;">🎤 REDACCIÓN ELITE</h2>
            <button type="submit" class="btn-publicar">PUBLICAR 🚀</button>
        </div>

        <label>TÍTULO DE LA ENTRADA</label>
        <input type="text" name="titulo" required>

        <label>CUERPO DE LA NOTICIA</label>
        <textarea name="resumen" id="editor1"></textarea>

        <label style="margin-top:15px;">ETIQUETAS SEO</label>
        <input type="text" name="keywords" placeholder="noticias, army, farol...">

        <div class="file-upload">
            <label>IMAGEN DE PORTADA</label>
            <input type="file" name="foto" required style="color: #fff;">
        </div>
    </form>

    <script>
        // CONFIGURACIÓN PARA QUITAR EL AVISO ROJO
        CKEDITOR.config.versionCheck = false; 
        CKEDITOR.replace('editor1', {
            height: 400,
            uiColor: '#F7F7F7',
            removeButtons: 'About'
        });
    </script>
</body>
</html>
'''

# --- PORTADA ---
html_portada = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-V5QW7Y6X8Z"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-V5QW7Y6X8Z');
    </script>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>El Farol</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #000; color: #fff; }
        .navbar { border-bottom: 5px solid #ff8c00; background: #000; padding: 20px; text-align: center; }
        .card-noticia { background: #0a0a0a; border: 1px solid #222; border-radius: 15px; margin-bottom: 30px; overflow: hidden; }
        .noticia-contenido b, .noticia-contenido strong { color: #ff8c00; }
    </style>
</head>
<body>
    <div class="navbar"><h1 style="color:#ff8c00; font-family:Impact; font-size:2.5rem;">🏮 EL FAROL</h1></div>
    <div class="container mt-5">
        {% for n in noticias %}
        <div class="card-noticia">
            <img src="/uploads/{{ n.multimedia_url }}" style="width:100%; height:auto;">
            <div style="padding:30px;">
                <h1 style="color:#ff8c00;">{{ n.titulo }}</h1>
                <div class="noticia-contenido">{{ n.resumen|safe }}</div>
            </div>
        </div>
        {% endfor %}
    </div>
</body>
</html>
'''

@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template_string(html_portada, noticias=noticias)

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if request.method == 'POST':
        if request.form.get('u') == 'director' and request.form.get('p') == 'farol_director':
            session['user_id'] = 1
            return redirect(url_for('panel'))
    return '<body style="background:#000;text-align:center;padding-top:100px;"><form method="post" style="display:inline-block;background:#111;padding:40px;border:2px solid #ff8c00;"><h2 style="color:#ff8c00;">LOGIN</h2><input name="u" placeholder="User"><br><br><input name="p" type="password" placeholder="Pass"><br><br><button type="submit">ENTRAR</button></form></body>'

@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if 'user_id' not in session: return redirect(url_for('admin'))
    if request.method == 'POST':
        t, r, k = request.form.get('titulo'), request.form.get('resumen'), request.form.get('keywords')
        f = request.files.get('foto')
        if f:
            fname = f"n_{datetime.utcnow().timestamp()}.jpg"
            f.save(os.path.join(UPLOAD_FOLDER, fname))
            db.session.add(Noticia(titulo=t, resumen=r, keywords=k, multimedia_url=fname))
            db.session.commit()
            return redirect(url_for('index'))
    return render_template_string(html_panel)

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
