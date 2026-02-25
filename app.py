from flask import Flask, render_template_string, request, redirect, url_for, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'farol_ultra_secreto_2026'

# --- CONFIGURACIÓN DE ALMACENAMIENTO ---
UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///farol.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- MODELOS DE DATOS ---
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
    multimedia_url = db.Column(db.String(400))
    categoria = db.Column(db.String(50), default="EXCLUSIVA")
    autor_id = db.Column(db.Integer, db.ForeignKey('usuario.id'))
    autor = db.relationship('Usuario', backref='noticias')
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

# --- CREAR LA REDACCIÓN (5 PERSONAS) ---
with app.app_context():
    db.create_all()
    if not Usuario.query.filter_by(username='director').first():
        # Cuenta del Director
        db.session.add(Usuario(username='director', password='farol_director', nombre_publico='Director General'))
        # Cuentas del Army (4 Reporteros)
        for i in range(1, 5):
            db.session.add(Usuario(username=f'reportero{i}', password=f'farol{i}', nombre_publico=f'Reportero {i}'))
        db.session.commit()

# --- RUTAS ---
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
            foto_n = request.files.get('foto_noticia')
            if foto_n:
                fname_n = f"n_{datetime.utcnow().timestamp()}.jpg"
                foto_n.save(os.path.join(UPLOAD_FOLDER, fname_n))
                nueva = Noticia(titulo=titulo, resumen=resumen, multimedia_url=fname_n, autor_id=u.id)
                db.session.add(nueva)
                db.session.commit()
            return redirect(url_for('index'))
    return render_template_string(html_panel, u=u)

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

# --- DISEÑO VISUAL (HTML/CSS) ---

html_portada = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>El Farol | Periodismo Digital</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #0a0a0a; color: #e0e0e0; font-family: sans-serif; }
        .navbar { border-bottom: 2px solid #ff8c00; background-color: #000 !important; }
        .navbar-brand { color: #ff8c00 !important; font-size: 2.2rem; font-weight: bold; }
        .card-noticia { background: #1a1a1a; border: none; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 10px 20px rgba(0,0,0,0.5); }
        .btn-leer { border-radius: 20px; border-color: #ff8c00; color: #ff8c00; font-weight: bold; }
        .badge-categoria { background: #ff8c00; color: #000; font-weight: bold; padding: 5px 10px; border-radius: 4px; }
        .seccion-titulo { border-left: 4px solid #ff8c00; padding-left: 15px; margin-bottom: 30px; }
    </style>
</head>
<body>
<nav class="navbar navbar-dark sticky-top mb-5 shadow-lg">
    <div class="container"><a class="navbar-brand" href="/">🏮 EL FAROL</a></div>
</nav>
<div class="container">
    <div class="seccion-titulo"><h2>Últimas Noticias</h2><p class="text-muted small">Actualizado en tiempo real</p></div>
    <div class="row">
        {% if noticias %}
            {% for noticia in noticias %}
                <div class="col-md-4">
                    <div class="card card-noticia">
                        <img src="/uploads/{{ noticia.multimedia_url }}" class="card-img-top" style="height:220px; object-fit:cover; border-radius: 12px 12px 0 0;">
                        <div class="card-body">
                            <span class="badge-categoria mb-2 d-inline-block">{{ noticia.categoria }}</span>
                            <h5 class="card-title text-white">{{ noticia.titulo }}</h5>
                            <p class="card-text text-muted small">{{ noticia.resumen[:100] }}...</p>
                            <div class="d-flex justify-content-between align-items-center mt-3">
                                <div class="d-flex align-items-center">
                                    <img src="/uploads/{{ noticia.autor.foto_perfil }}" style="width:30px; height:30px; border-radius:50%; margin-right:10px; border:1px solid #ff8c00;">
                                    <span class="text-warning" style="font-size:0.8rem;">{{ noticia.autor.nombre_publico }}</span>
                                </div>
                                <a href="#" class="btn btn-sm btn-leer">Leer Crónica</a>
                            </div>
                        </div>
                    </div>
                </div>
            {% endfor %}
        {% else %}
            <div class="col-12 text-center py-5" style="background: #111; border-radius: 20px;">
                <h3 class="text-muted">Esperando la primera exclusiva...</h3>
                <a href="/admin" class="btn btn-outline-warning mt-3">Panel de Redacción</a>
            </div>
        {% endif %}
    </div>
</div>
<footer class="mt-5 py-4 text-center border-top border-secondary">
    <p class="text-muted">&copy; 2026 El Farol - Dirección General: Jose Color</p>
</footer>
</body>
</html>
'''

html_login = '''
<body style="background:#0a0a0a; color:white; font-family:sans-serif; text-align:center; padding-top:100px;">
    <h1 style="color:#ff8c00; font-size:3rem;">🏮 EL FAROL</h1>
    <div style="background:#1a1a1a; display:inline-block; padding:40px; border-radius:20px; border:1px solid #333; box-shadow: 0 0 30px rgba(255,140,0,0.1);">
        <h3 style="margin-bottom:20px;">Acceso de Redacción</h3>
        <form method="post">
            <input name="user" placeholder="Usuario" required style="width:100%; padding:12px; margin-bottom:15px; border-radius:8px; border:none; background:#222; color:white;"><br>
            <input name="password" type="password" placeholder="Clave" required style="width:100%; padding:12px; margin-bottom:25px; border-radius:8px; border:none; background:#222; color:white;"><br>
            <button type="submit" style="width:100%; padding:15px; background:#ff8c00; border:none; border-radius:8px; color:black; font-weight:bold; cursor:pointer; font-size:1.1rem;">ENTRAR AL PANEL</button>
        </form>
    </div>
</body>
'''

html_panel = '''
<body style="background:#0a0a0a; color:white; font-family:sans-serif; padding:20px;">
    <div style="max-width:650px; margin:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
            <h2 style="color:#ff8c00; margin:0;">Hola, {{ u.nombre_publico }}</h2>
            <a href="/" style="color:#ff8c00; text-decoration:none; font-weight:bold;">Ver Periódico ↗</a>
        </div>
        
        <form method="post" enctype="multipart/form-data" style="background:#1a1a1a; padding:20px; border-radius:15px; margin-bottom:25px; border:1px solid #333;">
            <h4 style="margin-top:0;">Mi Perfil de Reportero</h4>
            <div style="display:flex; gap:15px; align-items:center;">
                <img src="/uploads/{{ u.foto_perfil }}" style="width:60px; height:60px; border-radius:50%; border:2px solid #ff8c00;">
                <div style="flex-grow:1;">
                    <input name="nombre" value="{{ u.nombre_publico }}" style="width:100%; padding:8px; margin-bottom:8px; background:#222; border:1px solid #444; color:white;">
                    <input type="file" name="foto_perfil" accept="image/*" style="font-size:0.8rem;">
                </div>
                <button name="update_profile" type="submit" style="background:#333; color:white; border:none; padding:10px; border-radius:5px; cursor:pointer;">Guardar</button>
            </div>
        </form>

        <form method="post" enctype="multipart/form-data" style="background:#1a1a1a; padding:25px; border-radius:15px; border:2px solid #ff8c00;">
            <h4 style="margin-top:0; color:#ff8c00; font-size:1.5rem;">Lanzar Noticia de Último Minuto 🔥</h4>
            <input name="titulo" placeholder="TÍTULO DE LA EXCLUSIVA" required style="width:100%; padding:15px; margin-bottom:15px; font-weight:bold; font-size:1.2rem; border-radius:8px; border:1px solid #444; background:#222; color:white;"><br>
            <textarea name="resumen" placeholder="Escribe aquí el cuerpo de la noticia..." required style="width:100%; height:180px; padding:15px; margin-bottom:15px; border-radius:8px; border:1px solid #444; background:#222; color:white; font-size:1rem;"></textarea><br>
            <div style="background:#222; padding:15px; border-radius:8px; margin-bottom:20px; border:1px dashed #ff8c00;">
                <label style="display:block; margin-bottom:10px; font-weight:bold; color:#ff8c00;">Sube la Imagen de la Noticia:</label>
                <input type="file" name="foto_noticia" accept="image/*" required>
            </div>
            <button type="submit" style="width:100%; padding:20px; background:#ff8c00; color:black; border:none; border-radius:10px; font-weight:bold; font-size:1.3rem; cursor:pointer; box-shadow: 0 5px 15px rgba(255,140,0,0.3);">¡PUBLICAR AHORA! 🏮</button>
        </form>
    </div>
</body>
'''

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
