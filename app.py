from flask import Flask, render_template_string, request, redirect, url_for, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'farol_ultra_secreto_2026'

# CONFIGURACIÓN DE CARPETAS Y BASE DE DATOS
UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///farol.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# MODELOS DE DATOS
class Usuario(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password = db.Column(db.String(50), nullable=False)
    nombre_publico = db.Column(db.String(100), default="Redacción El Farol")
    foto_perfil = db.Column(db.String(400), default="default_user.png")

class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200), nullable=False)
    resumen = db.Column(db.Text, nullable=False)
    keywords = db.Column(db.String(200), default="noticia, el farol")
    multimedia_url = db.Column(db.String(400))
    autor_id = db.Column(db.Integer, db.ForeignKey('usuario.id'))
    autor = db.relationship('Usuario', backref='noticias')
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

# CREACIÓN DE ACCESOS
with app.app_context():
    db.create_all()
    if not Usuario.query.filter_by(username='director').first():
        db.session.add(Usuario(username='director', password='farol_director', nombre_publico='Director General'))
        for i in range(1, 5):
            db.session.add(Usuario(username=f'reportero{i}', password=f'farol{i}', nombre_publico=f'Reportero {i}'))
        db.session.commit()

# --- DISEÑO MAESTRO: NARANJA, NEGRO Y RESPONSIVE ---

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
        body { background-color: #050505; color: #f0f0f0; font-family: 'Segoe UI', sans-serif; margin: 0; }
        
        /* TOP BAR RESPONSIVE */
        .top-bar { background: #000; border-bottom: 1px solid #222; padding: 10px 0; }
        .top-container { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
        
        /* LOGO NARANJA OFICIAL */
        .navbar { border-bottom: 4px solid #ff8c00; background-color: #000 !important; }
        .navbar-brand { 
            color: #ff8c00 !important; 
            font-size: 2rem; 
            font-weight: 900; 
            font-family: 'Impact', sans-serif; 
            text-transform: uppercase;
            letter-spacing: 2px;
        }

        /* BOTÓN ARMY NARANJA */
        .btn-army { 
            background: #ff8c00; 
            color: #000; 
            font-weight: bold; 
            border-radius: 5px; 
            padding: 8px 20px; 
            text-decoration: none; 
            font-size: 0.9rem;
        }

        /* AJUSTES PARA MÓVIL */
        @media (max-width: 600px) {
            .navbar-brand { font-size: 1.6rem; }
            .top-container { justify-content: center; }
            .btn-army { width: 100%; text-align: center; }
            #google_translate_element { margin-bottom: 5px; }
        }

        /* NOTICIAS */
        .card-noticia { background: #111; border: 1px solid #222; border-radius: 12px; margin-bottom: 20px; transition: 0.3s; }
        .card-noticia:hover { border-color: #ff8c00; }
        .badge-seo { color: #ff8c00; font-size: 0.7rem; font-weight: bold; text-transform: uppercase; }
    </style>
</head>
<body>

<div class="top-bar">
    <div class="container top-container">
        <div id="google_translate_element"></div>
        <a href="/admin" class="btn-army">UNIRSE AL ARMY 🚨</a>
    </div>
</div>

<nav class="navbar navbar-dark mb-4 shadow-lg text-center">
    <div class="container"><a class="navbar-brand mx-auto" href="/">🏮 EL FAROL</a></div>
</nav>

<div class="container">
    <div class="row">
        {% if noticias %}
            {% for noticia in noticias %}
                <div class="col-12 col-md-6 col-lg-4">
                    <div class="card card-noticia">
                        <img src="/uploads/{{ noticia.multimedia_url }}" class="card-img-top" style="height:220px; object-fit:cover; border-bottom: 2px solid #ff8c00;">
                        <div class="card-body">
                            <h5 class="text-white fw-bold">{{ noticia.titulo }}</h5>
                            <div class="card-text text-muted small mb-3">{{ noticia.resumen|safe }}</div>
                            <span class="badge-seo">#{{ noticia.keywords }}</span>
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

# (Rutas adicionales de administración iguales a su base para mantener funcionalidad)
@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template_string(html_portada, noticias=noticias)

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if request.method == 'POST':
        user = request.form.get('user')
        pw = request.form.get('password')
        u = Usuario.query.filter_by(username=user, password=pw).first()
        if u:
            session['user_id'] = u.id
            return redirect(url_for('panel'))
    return render_template_string(html_login)

@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if 'user_id' not in session: return redirect(url_for('admin'))
    u = Usuario.query.get(session['user_id'])
    # (Lógica de publicación aquí...)
    return render_template_string(html_panel, u=u)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
