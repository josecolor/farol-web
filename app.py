from flask import Flask, render_template_string, request, redirect, url_for, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'farol_maestro_2026'

# CONFIGURACIÓN DE CARPETAS Y BASE DE DATOS
UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///farol_final.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# MODELOS DE DATOS
class Usuario(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True)
    password = db.Column(db.String(50))
    nombre_publico = db.Column(db.String(100), default="Redacción El Farol")
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
    if not Usuario.query.filter_by(username='director').first():
        db.session.add(Usuario(username='director', password='farol_director', nombre_publico='Director General'))
        db.session.commit()

# --- DISEÑO INTEGRAL: TODO EN UNO ---

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

    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>El Farol | La Luz de la Información</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #050505; color: #f0f0f0; font-family: sans-serif; margin: 0; }
        .top-bar { background: #000; border-bottom: 1px solid #222; padding: 10px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; }
        .navbar { border-bottom: 4px solid #ff8c00; background-color: #000 !important; }
        .navbar-brand { color: #ff8c00 !important; font-size: 2rem; font-weight: 900; font-family: 'Impact', sans-serif; text-transform: uppercase; }
        .btn-army { background: #ff8c00; color: #000; font-weight: bold; border-radius: 5px; padding: 8px 15px; text-decoration: none; }
        .card-noticia { background: #111; border: 1px solid #222; border-radius: 12px; margin-bottom: 20px; overflow: hidden; }
        .badge-seo { color: #ff8c00; font-size: 0.7rem; font-weight: bold; }
        
        @media (max-width: 600px) {
            .navbar-brand { font-size: 1.6rem; }
            .btn-army { width: 100%; text-align: center; margin-top: 10px; }
        }
    </style>
</head>
<body>

<div class="top-bar">
    <div id="google_translate_element"></div>
    <a href="/admin" class="btn-army">UNIRSE AL ARMY 🚨</a>
</div>

<nav class="navbar navbar-dark mb-4 shadow-lg text-center">
    <div class="container"><a class="navbar-brand mx-auto" href="/">🏮 EL FAROL</a></div>
</nav>

<div class="container">
    <div class="row">
        {% if noticias %}
            {% for n in noticias %}
                <div class="col-12 col-md-6 col-lg-4">
                    <div class="card card-noticia">
                        <img src="/uploads/{{ n.multimedia_url }}" class="card-img-top" style="height:220px; object-fit:cover; border-bottom: 2px solid #ff8c00;">
                        <div class="card-body">
                            <h5 class="text-white fw-bold">{{ n.titulo }}</h5>
                            <div class="text-muted small mb-3">{{ n.resumen|safe }}</div>
                            <span class="badge-seo">#{{ n.keywords }}</span>
                        </div>
                    </div>
                </div>
            {% endfor %}
        {% else %}
            <div class="col-12 text-center py-5"><h3 style="color: #ff8c00;">Esperando la primera exclusiva...</h3></div>
        {% endif %}
    </div>
</div>

<script type="text/javascript">
function googleTranslateElementInit() {
  new google.translate.TranslateElement({pageLanguage: 'es', layout: google.translate.TranslateElement.InlineLayout.SIMPLE}, 'google_translate_element');
}
</script>
<script type="text/javascript" src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"></script>

</body>
</html>
'''

# --- PANEL DE ADMINISTRACIÓN (VUELVE A ESTAR ACTIVO) ---
@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if request.method == 'POST':
        user = request.form.get('user')
        pw = request.form.get('password')
        if user == 'director' and pw == 'farol_director':
            session['user_id'] = 1
            return redirect(url_for('panel'))
    return '''<body style="background:#000;color:#fff;text-align:center;padding-top:100px;">
                <h1 style="color:#ff8c00;">ACCESO REDACCIÓN</h1>
                <form method="post"><input name="user" placeholder="Usuario"><br><input name="password" type="password" placeholder="Clave"><br><button type="submit">ENTRAR</button></form>
              </body>'''

@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if 'user_id' not in session: return redirect(url_for('admin'))
    if request.method == 'POST':
        titulo = request.form.get('titulo')
        resumen = request.form.get('resumen')
        keyw = request.form.get('keywords')
        foto = request.files.get('foto')
        if foto:
            fname = f"n_{datetime.utcnow().timestamp()}.jpg"
            foto.save(os.path.join(UPLOAD_FOLDER, fname))
            nueva = Noticia(titulo=titulo, resumen=resumen, keywords=keyw, multimedia_url=fname)
            db.session.add(nueva)
            db.session.commit()
            return redirect(url_for('index'))
    return '''<body style="background:#000;color:#fff;padding:20px;">
                <h2 style="color:#ff8c00;">Publicar Noticia</h2>
                <form method="post" enctype="multipart/form-data">
                    <input name="titulo" placeholder="Título" style="width:100%;margin-bottom:10px;"><br>
                    <textarea name="resumen" placeholder="Contenido" style="width:100%;height:100px;"></textarea><br>
                    <input name="keywords" placeholder="Keywords (SEO)"><br>
                    <input type="file" name="foto" required><br>
                    <button type="submit" style="background:#ff8c00;padding:10px;width:100%;margin-top:20px;">PUBLICAR 🔥</button>
                </form>
              </body>'''

@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template_string(html_portada, noticias=noticias)

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
