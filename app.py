from flask import Flask, render_template_string, request, redirect, url_for, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'farol_olimpo_final_2026'

# --- CONFIGURACIÓN DE CARPETAS Y BASE DE DATOS ---
UPLOAD_FOLDER = 'static/uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Usamos una ruta absoluta para evitar que Railway se pierda
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
    date = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()

# --- VISTA: PANEL DE ADMINISTRACIÓN (MODO OSCURO + WYSIWYG) ---
html_panel = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Lantern | Admin</title>
    <script src="https://cdn.tiny.cloud/1/no-api-key/tinymce/6/tinymce.min.js" referrerpolicy="origin"></script>
    <style>
        body { background: #000; color: #fff; font-family: sans-serif; padding: 0; margin: 0; }
        .nav { background: #111; padding: 15px; border-bottom: 2px solid #ff8c00; text-align: center; }
        .nav a { color: #ff8c00; text-decoration: none; font-weight: bold; }
        .container { max-width: 900px; margin: 20px auto; padding: 15px; }
        .card { background: #111; padding: 20px; border-radius: 15px; border: 2px solid #ff8c00; }
        input, textarea { width: 100%; padding: 12px; margin: 10px 0; border-radius: 8px; border: 1px solid #333; background: #222; color: #fff; box-sizing: border-box; }
        .btn { background: #ff8c00; color: #000; font-weight: bold; width: 100%; padding: 18px; border: none; border-radius: 10px; cursor: pointer; text-transform: uppercase; margin-top: 10px; }
        label { color: #ff8c00; font-size: 0.8rem; font-weight: bold; }
    </style>
</head>
<body>
    <div class="nav"><a href="/">👁️ VIEW PUBLIC SITE</a></div>
    <div class="container">
        <form method="post" enctype="multipart/form-data" class="card">
            <h2 style="color:#ff8c00; margin-top:0;">🏮 ELITE NEWSROOM</h2>
            <label>Headline</label>
            <input type="text" name="titulo" placeholder="News title..." required>
            <label>Location</label>
            <input type="text" name="location" placeholder="City, Country">
            <label>Content (Dark Style)</label>
            <textarea name="resumen" id="editor_pro"></textarea>
            <label>Cover Image</label>
            <input type="file" name="foto" required>
            <button type="submit" class="btn">PUBLISH NOW 🔥</button>
        </form>
    </div>
    <script>
        tinymce.init({
          selector: '#editor_pro',
          skin: "oxide-dark",
          content_css: "dark",
          height: 350,
          plugins: 'lists link emoticons',
          toolbar: 'bold italic | bullist numlist | link emoticons',
          menubar: false,
          statusbar: false
        });
    </script>
</body>
</html>
'''

# --- VISTA: PORTADA PÚBLICA ---
html_portada = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Lantern</title>
    <style>
        body { background: #000; color: #eee; font-family: sans-serif; margin: 0; }
        .header { border-bottom: 5px solid #ff8c00; padding: 30px; text-align: center; }
        .container { max-width: 800px; margin: auto; padding: 15px; }
        .news-card { background: #111; border-radius: 15px; margin-bottom: 40px; border: 1px solid #222; overflow: hidden; }
        .news-card img { width: 100%; border-bottom: 3px solid #ff8c00; }
        .info { padding: 25px; }
        .meta { color: #ff8c00; font-weight: bold; font-size: 0.9rem; }
        .admin-btn { display: block; text-align: center; background: #ff8c00; color: #000; padding: 5px; text-decoration: none; font-size: 0.7rem; font-weight: bold; }
    </style>
</head>
<body>
    <a href="/panel" class="admin-btn">🔐 STAFF LOGIN</a>
    <div class="header"><h1 style="color:#ff8c00; font-family:Impact; font-size:3rem; margin:0;">🏮 THE LANTERN</h1></div>
    <div class="container">
        {% for n in noticias %}
        <div class="news-card">
            <img src="/uploads/{{ n.multimedia_url }}">
            <div class="info">
                <div class="meta">📍 {{ n.location }} | 📅 {{ n.date.strftime('%d %b, %Y') }}</div>
                <h1 style="margin:10px 0;">{{ n.titulo }}</h1>
                <div style="line-height:1.6;">{{ n.resumen|safe }}</div>
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
    # Importante para Railway: usar el puerto que ellos asignan
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
