from flask import Flask, render_template_string, request, redirect, url_for, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'farol_olimpo_final_2026'

# --- CREDENCIALES DE SUPABASE (GUARDADAS EN CAJA FUERTE) ---
# URL: https://gqxlmgguteofoordmcop.supabase.co
# KEY: sb_publishable_rW0ArorYkHUuaEOXjLkuxg_01VKFMHd

UPLOAD_FOLDER = 'static/uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)

basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'farol_final.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200))
    resumen = db.Column(db.Text)
    location = db.Column(db.String(100))
    multimedia_url = db.Column(db.String(400))
    date = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()

# --- PANEL DE REDACCIÓN CON ICONOS BRILLANTES ---
html_panel = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Lantern | Admin</title>
    <script src="https://cdn.ckeditor.com/4.22.1/standard/ckeditor.js"></script>
    <style>
        body { background: #000; color: #fff; font-family: sans-serif; padding: 0; margin: 0; }
        .nav { background: #111; padding: 15px; border-bottom: 2px solid #ff8c00; text-align: center; }
        .nav a { color: #ff8c00; text-decoration: none; font-weight: bold; }
        .container { max-width: 900px; margin: 20px auto; padding: 10px; }
        .card { background: #111; padding: 25px; border-radius: 15px; border: 2px solid #ff8c00; }
        input { width: 100%; padding: 15px; margin: 10px 0; border-radius: 8px; border: 1px solid #333; background: #1a1a1a; color: #fff; box-sizing: border-box; }
        .btn { background: #ff8c00; color: #000; font-weight: bold; width: 100%; padding: 20px; border: none; border-radius: 10px; cursor: pointer; text-transform: uppercase; margin-top: 20px; font-size: 1.2rem; }
        label { color: #ff8c00; font-size: 0.8rem; font-weight: bold; text-transform: uppercase; }

        /* ICONOS BRILLANTES PARA EL DIRECTOR */
        .cke_button_icon { filter: invert(1) brightness(2) !important; }
        .cke_top { background: #2a2a2a !important; border-bottom: 1px solid #444 !important; }
        .cke_bottom { background: #2a2a2a !important; }
    </style>
</head>
<body>
    <div class="nav"><a href="/">👁️ IR A LA WEB</a></div>
    <div class="container">
        <form method="post" enctype="multipart/form-data" class="card">
            <h2 style="color:#ff8c00; text-align:center; font-family: Impact;">🏮 REDACCIÓN ELITE</h2>
            <label>Titular</label>
            <input type="text" name="titulo" placeholder="Escribe el titular..." required>
            <label>Ubicación</label>
            <input type="text" name="location" placeholder="📍 Ciudad, País">
            <label>Cuerpo de la Noticia</label>
            <textarea name="resumen" id="editor_pro"></textarea>
            <label style="display:block; margin-top:25px;">Imagen de Portada</label>
            <input type="file" name="foto" required style="color:#fff;">
            <button type="submit" class="btn">PUBLICAR EXCLUSIVA 🔥</button>
        </form>
    </div>
    <script>
        CKEDITOR.replace('editor_pro', {
            uiColor: '#1a1a1a',
            height: 400,
            versionCheck: false,
            contentsCss: ['body { background-color: #fff; color: #000; padding: 15px; }']
        });
    </script>
</body>
</html>
'''

html_portada = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Lantern</title>
    <style>
        body { background: #000; color: #eee; font-family: sans-serif; margin: 0; }
        .header { border-bottom: 5px solid #ff8c00; padding: 40px; text-align: center; }
        .container { max-width: 800px; margin: auto; padding: 15px; }
        .news-card { background: #111; border-radius: 20px; margin-bottom: 40px; border: 1px solid #222; overflow: hidden; }
        .news-card img { width: 100%; border-bottom: 4px solid #ff8c00; }
        .info { padding: 25px; }
        h1 { color: #fff; margin: 0 0 15px 0; }
        .meta { color: #ff8c00; font-weight: bold; }
    </style>
</head>
<body>
    <div class="header"><h1 style="color:#ff8c00; font-family:Impact; font-size:3.5rem;">🏮 THE LANTERN</h1></div>
    <div class="container">
        {% for n in noticias %}
        <div class="news-card">
            <img src="/uploads/{{ n.multimedia_url }}">
            <div class="info">
                <div class="meta">📍 {{ n.location }} | 📅 {{ n.date.strftime('%d %b, %Y') }}</div>
                <h1>{{ n.titulo }}</h1>
                <div style="line-height:1.7;">{{ n.resumen|safe }}</div>
            </div>
        </div>
        {% endfor %}
    </div>
</body>
</html>
'''

@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.date.desc()).all()
    return render_template_string(html_portada, noticias=noticias)

@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if request.method == 'POST':
        t, r, l = request.form.get('titulo'), request.form.get('resumen'), request.form.get('location')
        f = request.files.get('foto')
        if f:
            fname = f"news_{datetime.utcnow().timestamp()}.jpg"
            f.save(os.path.join(UPLOAD_FOLDER, fname))
            db.session.add(Noticia(titulo=t, resumen=r, location=l, multimedia_url=fname))
            db.session.commit()
            return redirect(url_for('index'))
    return render_template_string(html_panel)

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
