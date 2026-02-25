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

# RUTAS
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
    
    if request.method == 'POST':
        if 'update_profile' in request.form:
            u.nombre_publico = request.form.get('nombre')
            foto = request.files.get('foto_perfil')
            if foto:
                fname = f"perfil_{u.id}.jpg"
                foto.save(os.path.join(UPLOAD_FOLDER, fname))
                u.foto_perfil = fname
            db.session.commit()
        else:
            titulo = request.form.get('titulo')
            resumen = request.form.get('resumen')
            keyw = request.form.get('keywords')
            foto_n = request.files.get('foto_noticia')
            if foto_n:
                fname_n = f"n_{datetime.utcnow().timestamp()}.jpg"
                foto_n.save(os.path.join(UPLOAD_FOLDER, fname_n))
                nueva = Noticia(titulo=titulo, resumen=resumen, keywords=keyw, multimedia_url=fname_n, autor_id=u.id)
                db.session.add(nueva)
                db.session.commit()
            return redirect(url_for('index'))
    return render_template_string(html_panel, u=u)

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

# --- DISEÑO RESPONSIVE CORREGIDO ---

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
    <title>El Farol | La Luz de la Información</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #050505; color: #f0f0f0; font-family: 'Segoe UI', sans-serif; margin: 0; }
        
        /* TOP BAR RESPONSIVE */
        .top-bar { 
            background: #000; 
            border-bottom: 1px solid #222; 
            padding: 8px 0; 
        }
        .top-container {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
        }

        /* NAVBAR Y LOGO */
        .navbar { border-bottom: 3px solid #e63946; background-color: #000 !important; padding: 10px 0; }
        .navbar-brand { 
            color: #e63946 !important; 
            font-size: 1.8rem; 
            font-weight: 900; 
            font-family: 'Impact', sans-serif; 
            letter-spacing: 1px;
            text-transform: uppercase;
        }

        /* MEDIA QUERIES PARA TABLET Y PC */
        @media (min-width: 768px) {
            .navbar-brand { font-size: 3rem; letter-spacing: 3px; }
            .top-bar { padding: 5px 0; }
        }

        /* BOTÓN ARMY ADAPTABLE */
        .btn-army { 
            background: #e63946; 
            color: white; 
            font-weight: bold; 
            border-radius: 4px; 
            padding: 8px 16px; 
            text-decoration: none;
            font-size: 0.85rem;
            text-align: center;
        }
        @media (max-width: 576px) {
            .top-container { justify-content: center; }
            .btn-army { width: 100%; order: 2; }
            #google_translate_element { order: 1; }
        }

        /* TARJETAS DE NOTICIAS */
        .card-noticia { 
            background: #111; 
            border: 1px solid #222; 
            border-radius: 12px; 
            margin-bottom: 25px; 
            overflow: hidden; 
            transition: 0.3s;
        }
        .card-noticia:hover { border-color: #e63946; }
        .badge-seo { background: #e6394611; color: #e63946; border: 1px solid #e63946; font-size: 0.6rem; padding: 2px 8px; border-radius: 4px; margin-right: 5px; }
        
        /* GOOGLE TRANSLATE FIX */
        .goog-te-gadget-simple { background-color: #111 !important; border: 1px solid #444 !important; padding: 4px !important; border-radius: 4px !important; }
        .goog-te-gadget-simple span { color: #eee !important; }
    </style>
</head>
<body>

<div class="top-bar">
    <div class="container top-container">
        <div id="google_translate_element"></div>
        <a href="/admin" class="btn-army">UNIRSE AL ARMY 🚨</a>
    </div>
</div>

<nav class="navbar navbar-dark mb-4 shadow-lg">
    <div class="container text-center">
        <a class="navbar-brand mx-auto" href="/">🏮 EL FAROL</a>
    </div>
</nav>

<div class="container">
    <div class="row">
        {% if noticias %}
            {% for noticia in noticias %}
                <div class="col-12 col-md-6 col-lg-4">
                    <div class="card card-noticia shadow">
                        <img src="/uploads/{{ noticia.multimedia_url }}" class="card-img-top" style="height:220px; object-fit:cover;">
                        <div class="card-body">
                            <div class="mb-2">
                                {% for word in noticia.keywords.split(',') %}<span class="badge-seo">#{{ word.strip() }}</span>{% endfor %}
                            </div>
                            <h5 class="card-title text-white fw-bold">{{ noticia.titulo }}</h5>
                            <div class="card-text text-muted small mb-3">{{ noticia.resumen|safe }}</div>
                            <div class="d-flex align-items-center mt-3 pt-3 border-top border-secondary">
                                <img src="/uploads/{{ noticia.autor.foto_perfil }}" style="width:30px; height:30px; border-radius:50%; border: 1px solid #e63946; margin-right:10px;">
                                <span class="text-white-50 small">{{ noticia.autor.nombre_publico }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            {% endfor %}
        {% else %}
            <div class="col-12 text-center py-5"><h3>Esperando la primera exclusiva...</h3></div>
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

# (Login y Panel optimizados)
html_login = ''' <body style="background:#050505; color:white; font-family:sans-serif; text-align:center; padding: 50px 20px;"> <h1 style="color:#e63946; font-family:Impact;">🏮 EL FAROL</h1> <form method="post" style="background:#111; display:inline-block; padding:30px; border-radius:15px; border:1px solid #222; width:100%; max-width:400px;"> <h3 style="margin-bottom:20px;">Acceso Redacción</h3> <input name="user" placeholder="Usuario" style="width:100%; padding:12px; margin-bottom:15px; border-radius:5px; border:1px solid #333; background:#000; color:white;"><br> <input name="password" type="password" placeholder="Clave" style="width:100%; padding:12px; margin-bottom:25px; border-radius:5px; border:1px solid #333; background:#000; color:white;"><br> <button type="submit" style="width:100%; padding:12px; background:#e63946; color:white; border:none; font-weight:bold; border-radius:5px;">ENTRAR</button> </form> </body> '''

html_panel = ''' <body style="background:#050505; color:white; font-family:sans-serif; padding:15px;"> <script src="https://cdn.ckeditor.com/4.22.1/standard/ckeditor.js"></script> <div style="max-width:800px; margin:auto;"> <h2 style="color:#e63946;">Panel de Control</h2> <form method="post" enctype="multipart/form-data" style="background:#111; padding:20px; border-radius:12px; border:1px solid #e63946;"> <label>TÍTULO DE LA NOTICIA</label> <input name="titulo" required style="width:100%; padding:12px; margin-bottom:15px; background:#000; color:white; border:1px solid #333;"> <label>SEO (Separadas por coma)</label> <input name="keywords" style="width:100%; padding:12px; margin-bottom:15px; background:#000; color:white; border:1px solid #333;"> <label>CONTENIDO</label> <textarea name="resumen" id="editor1"></textarea> <script>CKEDITOR.replace('editor1');</script> <div style="margin-top:20px; background:#222; padding:15px; border-radius:8px;"> <label>Imagen Principal:</label><br> <input type="file" name="foto_noticia" accept="image/*" required style="margin-top:10px;"> </div> <button type="submit" style="width:100%; padding:15px; margin-top:20px; background:#e63946; color:white; font-weight:bold; border:none; border-radius:8px;">PUBLICAR AHORA 🔥</button> </form> </div> </body> '''

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
