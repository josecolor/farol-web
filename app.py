from flask import Flask, render_template_string, request, redirect, url_for, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'farol_olimpo_2026'

# CONFIGURACIÓN DE RUTAS Y BASE DE DATOS
UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///el_farol_olimpo.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- MODELOS ---
class Usuario(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True)
    password = db.Column(db.String(50))
    nombre_publico = db.Column(db.String(100))
    foto_perfil = db.Column(db.String(400), default="default_user.png")

class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200))
    resumen = db.Column(db.Text)
    keywords = db.Column(db.String(200))
    multimedia_url = db.Column(db.String(400))
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()
    # ACCESOS FIJOS
    if not Usuario.query.filter_by(username='director').first():
        db.session.add(Usuario(username='director', password='farol_director', nombre_publico='Director General'))
        db.session.add(Usuario(username='periodista1', password='farol_periodista', nombre_publico='Reportero 1'))
        db.session.commit()

# --- DISEÑO PORTADA (NARANJA Y NEGRO) ---
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
    <title>El Farol | El Olimpo</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #000; color: #fff; font-family: sans-serif; }
        .navbar { border-bottom: 4px solid #ff8c00; background: #000; padding: 20px; }
        .btn-army { background: #ff8c00; color: #000; font-weight: bold; width: 100%; display: block; padding: 15px; text-decoration: none; text-align: center; font-size: 1.2rem; }
        .card-noticia { background: #111; border: 1px solid #333; border-radius: 12px; margin-bottom: 25px; overflow: hidden; }
        .logo-farol { color: #ff8c00; font-family: 'Impact', sans-serif; font-size: 2.5rem; text-transform: uppercase; margin: 0; }
    </style>
</head>
<body>
    <a href="/unirse" class="btn-army">UNIRSE AL ARMY 🚨</a>
    <div class="navbar"><h1 class="logo-farol">🏮 EL FAROL</h1><div id="google_translate_element"></div></div>
    <div class="container mt-4">
        <div class="row">
            {% for n in noticias %}
            <div class="col-12 col-md-6">
                <div class="card-noticia">
                    <img src="/uploads/{{ n.multimedia_url }}" style="width:100%; height:250px; object-fit:cover; border-bottom:3px solid #ff8c00;">
                    <div style="padding:20px;">
                        <h3 style="color:#ff8c00;">{{ n.titulo }}</h3>
                        <div class="text-muted">{{ n.resumen|safe }}</div>
                        <p style="color:#ff8c00; font-size:0.8rem; margin-top:10px;">#{{ n.keywords }}</p>
                    </div>
                </div>
            </div>
            {% endfor %}
        </div>
    </div>
    <script type="text/javascript">function googleTranslateElementInit() { new google.translate.TranslateElement({pageLanguage: 'es'}, 'google_translate_element'); }</script>
    <script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"></script>
</body>
</html>
'''

# --- PANEL DE PRENSA (VISIBILIDAD ALTA) ---
html_panel = '''
<body style="background:#000; color:#fff; font-family:sans-serif; padding:20px;">
    <h2 style="color:#ff8c00; text-align:center;">PANEL DE PRENSA 🎤</h2>
    <form method="post" enctype="multipart/form-data" style="max-width:600px; margin:auto; background:#111; padding:25px; border-radius:15px; border:2px solid #ff8c00;">
        <label>TÍTULO</label>
        <input name="titulo" required style="width:100%; padding:15px; margin-bottom:20px; background:#fff; color:#000; font-weight:bold; border-radius:8px;">
        
        <label>CONTENIDO NOTICIA</label>
        <textarea name="resumen" required style="width:100%; height:200px; padding:15px; margin-bottom:20px; background:#fff; color:#000; border-radius:8px;"></textarea>
        
        <label>KEYWORDS (SEO)</label>
        <input name="keywords" style="width:100%; padding:15px; margin-bottom:20px; background:#fff; color:#000; border-radius:8px;">
        
        <label style="color:#ff8c00;">FOTO DE LA EXCLUSIVA</label>
        <input type="file" name="foto" required style="color:#fff; margin-bottom:25px;">
        
        <button type="submit" style="width:100%; padding:20px; background:#ff8c00; color:#000; font-weight:bold; font-size:1.2rem; border:none; border-radius:10px; cursor:pointer;">PUBLICAR AHORA 🔥</button>
    </form>
</body>
'''

@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template_string(html_portada, noticias=noticias)

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if request.method == 'POST':
        u, p = request.form.get('u'), request.form.get('p')
        user = Usuario.query.filter_by(username=u, password=p).first()
        if user:
            session['user_id'] = user.id
            return redirect(url_for('panel'))
    return '<body style="background:#000;text-align:center;padding:100px;"><form method="post" style="display:inline-block;background:#111;padding:40px;border:2px solid #ff8c00;border-radius:15px;"><h2 style="color:#ff8c00;">OLIMPO LOGIN</h2><input name="u" placeholder="Usuario" style="margin-bottom:10px;"><br><input name="p" type="password" placeholder="Clave"><br><button type="submit" style="background:#ff8c00;margin-top:20px;padding:10px 30px;">ENTRAR</button></form></body>'

@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if 'user_id' not in session: return redirect(url_for('admin'))
    if request.method == 'POST':
        titulo, resumen, keyw = request.form.get('titulo'), request.form.get('resumen'), request.form.get('keywords')
        foto = request.files.get('foto')
        if foto:
            fname = f"n_{datetime.utcnow().timestamp()}.jpg"
            foto.save(os.path.join(UPLOAD_FOLDER, fname))
            db.session.add(Noticia(titulo=titulo, resumen=resumen, keywords=keyw, multimedia_url=fname))
            db.session.commit()
            return redirect(url_for('index'))
    return render_template_string(html_panel)

@app.route('/unirse')
def unirse():
    return '<body style="background:#000;color:#fff;text-align:center;padding:100px;"><h1 style="color:#ff8c00;">BIENVENIDO AL ARMY 🚨</h1><p>El registro está activo.</p><a href="/" style="color:#ff8c00;">Volver</a></body>'

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
