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

# MODELOS DE DATOS (No se borran)
class Usuario(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True)
    password = db.Column(db.String(50))
    nombre_publico = db.Column(db.String(100))

class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200))
    resumen = db.Column(db.Text)
    keywords = db.Column(db.String(200))
    multimedia_url = db.Column(db.String(400))
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()
    # ACCESO SEGURO PARA PERIODISTAS
    if not Usuario.query.filter_by(username='periodista1').first():
        db.session.add(Usuario(username='periodista1', password='farol_periodista', nombre_publico='Reportero El Farol'))
        db.session.add(Usuario(username='director', password='farol_director', nombre_publico='Director General'))
        db.session.commit()

# --- DISEÑO DE PORTADA ---
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
        body { background-color: #000; color: #fff; font-family: sans-serif; }
        .navbar { border-bottom: 4px solid #ff8c00; background: #000; text-align: center; padding: 15px; }
        .btn-army { background: #ff8c00; color: #000; font-weight: bold; width: 100%; display: block; padding: 12px; text-decoration: none; text-align: center; }
        .card-noticia { background: #111; border: 1px solid #333; border-radius: 10px; margin-bottom: 20px; overflow: hidden; }
    </style>
</head>
<body>
    <a href="/unirse" class="btn-army">UNIRSE AL ARMY 🚨</a>
    <div class="navbar"><h1 style="color:#ff8c00; font-family:Impact;">🏮 EL FAROL</h1></div>
    <div class="container mt-4">
        <div class="row">
            {% for n in noticias %}
            <div class="col-12 col-md-6">
                <div class="card-noticia">
                    <img src="/uploads/{{ n.multimedia_url }}" style="width:100%; height:200px; object-fit:cover; border-bottom:2px solid #ff8c00;">
                    <div style="padding:15px;">
                        <h4 style="color:#ff8c00;">{{ n.titulo }}</h4>
                        <p class="small text-muted">{{ n.resumen|safe }}</p>
                    </div>
                </div>
            </div>
            {% endfor %}
        </div>
    </div>
</body>
</html>
'''

# --- PANEL DE PERIODISTAS MEJORADO (IMAGEN 5 ARREGLADA) ---
html_panel = '''
<body style="background:#000; color:#fff; font-family:sans-serif; padding:15px;">
    <h2 style="color:#ff8c00; text-align:center;">PANEL DE PRENSA 🎤</h2>
    <form method="post" enctype="multipart/form-data" style="max-width:500px; margin:auto; background:#111; padding:20px; border-radius:10px; border:1px solid #ff8c00;">
        <label>TÍTULO DE LA NOTICIA</label>
        <input name="titulo" required style="width:100%; padding:12px; margin-bottom:15px; background:#fff; color:#000; border:none; border-radius:5px;">
        
        <label>CONTENIDO (Cuerpo de la noticia)</label>
        <textarea name="resumen" required style="width:100%; height:150px; padding:12px; margin-bottom:15px; background:#fff; color:#000; border:none; border-radius:5px;"></textarea>
        
        <label>KEYWORDS SEO</label>
        <input name="keywords" placeholder="ej: política, deportes" style="width:100%; padding:12px; margin-bottom:15px; background:#fff; color:#000; border:none; border-radius:5px;">
        
        <label>SUBIR FOTO</label><br>
        <input type="file" name="foto" required style="margin-bottom:20px; color:#ff8c00;"><br>
        
        <button type="submit" style="width:100%; padding:15px; background:#ff8c00; color:#000; font-weight:bold; border:none; border-radius:5px;">PUBLICAR EXCLUSIVA 🔥</button>
    </form>
    <p style="text-align:center; margin-top:20px;"><a href="/" style="color:#ff8c00; text-decoration:none;">Ver Web</a></p>
</body>
'''

@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template_string(html_portada, noticias=noticias)

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if request.method == 'POST':
        u = request.form.get('user')
        p = request.form.get('pass')
        user = Usuario.query.filter_by(username=u, password=p).first()
        if user:
            session['user_id'] = user.id
            return redirect(url_for('panel'))
    return '<body style="background:#000;text-align:center;padding-top:100px;"><form method="post" style="display:inline-block;background:#111;padding:30px;border:1px solid #ff8c00;"><h2 style="color:#ff8c00;">Prensa Login</h2><input name="user" placeholder="Usuario"><br><input name="pass" type="password" placeholder="Clave"><br><button type="submit" style="background:#ff8c00;margin-top:10px;">Entrar</button></form></body>'

@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if 'user_id' not in session: return redirect(url_for('admin'))
    if request.method == 'POST':
        # Lógica de guardado...
        pass
    return render_template_string(html_panel)

@app.route('/unirse')
def unirse():
    return '<body style="background:#000;color:#fff;text-align:center;padding:50px;"><h1 style="color:#ff8c00;">¡BIENVENIDO AL ARMY! 🚨</h1><p>Pronto recibirás nuestras exclusivas.</p><a href="/" style="color:#ff8c00;">Volver</a></body>'

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))

