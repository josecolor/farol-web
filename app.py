from flask import Flask, render_template_string, request, redirect, url_for, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'farol_profesional_2026'

# CONFIGURACIÓN
UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///farol_pro.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# MODELOS
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
    if not Usuario.query.filter_by(username='director').first():
        db.session.add(Usuario(username='director', password='farol_director', nombre_publico='Director General'))
        db.session.commit()

# --- INTERFAZ PORTADA PROFESIONAL ---
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
    <title>El Farol | Profesional</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #000; color: #fff; font-family: 'Arial Black', Gadget, sans-serif; }
        .navbar { border-bottom: 5px solid #ff8c00; background: #000; padding: 25px; text-align: center; }
        .logo-farol { color: #ff8c00; font-size: 3rem; text-transform: uppercase; font-weight: 900; letter-spacing: -1px; }
        .btn-army { background: #ff8c00; color: #000; font-weight: 900; width: 100%; display: block; padding: 18px; text-decoration: none; text-align: center; font-size: 1.3rem; text-transform: uppercase; }
        .card-noticia { background: #0a0a0a; border: 2px solid #222; border-radius: 15px; margin-bottom: 30px; overflow: hidden; transition: 0.3s; }
        .card-noticia:hover { border-color: #ff8c00; }
        .noticia-titulo { color: #ff8c00; font-weight: 900; font-size: 1.5rem; margin-top: 10px; }
    </style>
</head>
<body>
    <a href="/unirse" class="btn-army">UNIRSE AL ARMY 🚨</a>
    <div class="navbar"><h1 class="logo-farol">🏮 EL FAROL</h1></div>
    <div class="container mt-5">
        <div class="row">
            {% for n in noticias %}
            <div class="col-12 col-md-6">
                <div class="card-noticia">
                    <img src="/uploads/{{ n.multimedia_url }}" style="width:100%; height:300px; object-fit:cover; border-bottom:4px solid #ff8c00;">
                    <div style="padding:25px;">
                        <h2 class="noticia-titulo">{{ n.titulo }}</h2>
                        <div style="color:#ccc; font-family: 'Segoe UI', sans-serif;">{{ n.resumen|safe }}</div>
                        <p style="color:#ff8c00; font-weight:bold; margin-top:15px;">#{{ n.keywords }}</p>
                    </div>
                </div>
            </div>
            {% endfor %}
        </div>
    </div>
</body>
</html>
'''

# --- PANEL DE PRENSA ELITE (NEGRETAS Y ALTA VISIBILIDAD) ---
html_panel = '''
<body style="background:#000; color:#fff; font-family: 'Arial Black', sans-serif; padding:20px;">
    <h1 style="color:#ff8c00; text-align:center; font-size:2.5rem; margin-bottom:30px;">PANEL DE PRENSA 🎤</h1>
    <form method="post" enctype="multipart/form-data" style="max-width:700px; margin:auto; background:#111; padding:35px; border-radius:20px; border:3px solid #ff8c00; box-shadow: 0 0 20px rgba(255,140,0,0.2);">
        
        <label style="color:#ff8c00; font-size:1.2rem;">TÍTULO DE LA EXCLUSIVA</label>
        <input name="titulo" required style="width:100%; padding:20px; margin-bottom:25px; background:#fff; color:#000; font-weight:900; font-size:1.1rem; border-radius:10px; border:none;">
        
        <label style="color:#ff8c00; font-size:1.2rem;">CONTENIDO (CUERPO DE NOTICIA)</label>
        <textarea name="resumen" required style="width:100%; height:250px; padding:20px; margin-bottom:25px; background:#fff; color:#000; font-family: 'Segoe UI', sans-serif; font-weight:600; font-size:1rem; border-radius:10px; border:none;"></textarea>
        
        <label style="color:#ff8c00; font-size:1.2rem;">PALABRAS CLAVE (SEO)</label>
        <input name="keywords" placeholder="ej: política, army, el farol" style="width:100%; padding:20px; margin-bottom:25px; background:#fff; color:#000; font-weight:900; border-radius:10px; border:none;">
        
        <div style="background:#222; padding:20px; border-radius:10px; margin-bottom:30px; border:1px dashed #ff8c00;">
            <label style="color:#ff8c00; font-weight:900;">SUBIR IMAGEN DE ALTA RESOLUCIÓN</label><br><br>
            <input type="file" name="foto" required style="color:#fff;">
        </div>
        
        <button type="submit" style="width:100%; padding:25px; background:#ff8c00; color:#000; font-weight:900; font-size:1.5rem; border:none; border-radius:12px; cursor:pointer; text-transform:uppercase;">PUBLICAR AHORA 🔥</button>
    </form>
    <p style="text-align:center; margin-top:30px;"><a href="/" style="color:#ff8c00; text-decoration:none; font-weight:900;">← VOLVER A PORTADA</a></p>
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
    return '<body style="background:#000;text-align:center;padding-top:100px;font-family:sans-serif;"><form method="post" style="display:inline-block;background:#111;padding:40px;border:3px solid #ff8c00;border-radius:20px;"><h2 style="color:#ff8c00;font-weight:900;">OLIMPO LOGIN</h2><input name="u" placeholder="Usuario" style="padding:10px;margin-bottom:10px;width:100%;"><br><input name="p" type="password" placeholder="Contraseña" style="padding:10px;margin-bottom:20px;width:100%;"><br><button type="submit" style="background:#ff8c00;padding:15px 40px;font-weight:900;border:none;border-radius:10px;">ACCEDER AL BÚNKER</button></form></body>'

@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if 'user_id' not in session: return redirect(url_for('admin'))
    if request.method == 'POST':
        t, r, k = request.form.get('titulo'), request.form.get('resumen'), request.form.get('keywords')
        f = request.files.get('foto')
        if f:
            fname = f"exclusiva_{datetime.utcnow().timestamp()}.jpg"
            f.save(os.path.join(UPLOAD_FOLDER, fname))
            db.session.add(Noticia(titulo=t, resumen=r, keywords=k, multimedia_url=fname))
            db.session.commit()
            return redirect(url_for('index'))
    return render_template_string(html_panel)

@app.route('/unirse')
def unirse():
    return '<body style="background:#000;color:#fff;text-align:center;padding:100px;font-family:Arial;"><h1 style="color:#ff8c00;font-weight:900;">ORDEN RECIBIDA</h1><p>Te has unido al ARMY de EL FAROL.</p><a href="/" style="color:#ff8c00;font-weight:900;text-decoration:none;">VOLVER</a></body>'

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
