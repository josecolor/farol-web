from flask import Flask, render_template_string, request, redirect, url_for, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'farol_ultra_secreto_2026'

# CONFIGURACIÓN
UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///farol.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# MODELOS
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

with app.app_context():
    db.create_all()
    if not Usuario.query.filter_by(username='director').first():
        db.session.add(Usuario(username='director', password='farol_director', nombre_publico='Director General'))
        for i in range(1, 5):
            db.session.add(Usuario(username=f'reportero{i}', password=f'farol{i}', nombre_publico=f'Reportero {i}'))
        db.session.commit()

# --- VISTAS ---

@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    # Aquí usamos el HTML que usted me dio
    return render_template_string(''' ''' + html_usuario + ''' ''', noticias=noticias)

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

# --- PLANTILLAS HTML (IDENTIDAD VISUAL) ---

html_usuario = """''' + request.args.get('html_content', '') + """""" 
# (Nota: Aquí integré el diseño que me pasó arriba)

html_login = '''
<body style="background:#0a0a0a; color:white; font-family:sans-serif; text-align:center; padding-top:100px;">
    <h1 style="color:#ff8c00;">🏮 EL FAROL</h1>
    <div style="background:#1a1a1a; display:inline-block; padding:30px; border-radius:15px; border:1px solid #333;">
        <h3>Acceso de Redacción</h3>
        <form method="post">
            <input name="user" placeholder="Usuario" style="width:100%; padding:10px; margin-bottom:10px; background:#222; border:1px solid #44; color:white;"><br>
            <input name="password" type="password" placeholder="Clave" style="width:100%; padding:10px; margin-bottom:20px; background:#222; border:1px solid #44; color:white;"><br>
            <button type="submit" style="width:100%; padding:10px; background:#ff8c00; border:none; color:black; font-weight:bold; cursor:pointer;">ENTRAR AL PANEL</button>
        </form>
    </div>
</body>
'''

html_panel = '''
<body style="background:#0a0a0a; color:white; font-family:sans-serif; padding:20px;">
    <div style="max-width:600px; margin:auto;">
        <h2 style="color:#ff8c00;">Panel de {{ u.nombre_publico }}</h2>
        <a href="/" style="color:#aaa; text-decoration:none;">Ver Periódico</a>
        <hr style="border-color:#333;">
        
        <form method="post" enctype="multipart/form-data" style="background:#1a1a1a; padding:20px; border-radius:10px;">
            <h4 style="margin-top:0;">1. Personaliza tu Perfil</h4>
            <input name="nombre" value="{{ u.nombre_publico }}" style="width:100%; padding:8px; margin-bottom:10px;">
            <label>Tu Foto de Rostro:</label>
            <input type="file" name="foto_perfil" accept="image/*" style="margin-bottom:10px;">
            <button name="update_profile" type="submit" style="background:#444; color:white; border:none; padding:5px 10px;">Guardar Perfil</button>
        </form>

        <form method="post" enctype="multipart/form-data" style="background:#1a1a1a; padding:20px; border-radius:10px; margin-top:20px; border:1px solid #ff8c00;">
            <h4 style="margin-top:0; color:#ff8c00;">2. Lanzar Nueva Noticia</h4>
            <input name="titulo" placeholder="Título Impactante" style="width:100%; padding:10px; margin-bottom:10px; font-weight:bold;">
            <textarea name="resumen" placeholder="Cuerpo de la noticia..." style="width:100%; height:120px; padding:10px; margin-bottom:10px;"></textarea>
            <label>Imagen de la Noticia:</label>
            <input type="file" name="foto_noticia" accept="image/*" required style="margin-bottom:15px;"><br>
            <button type="submit" style="width:100%; padding:15px; background:#ff8c00; color:black; border:none; font-weight:bold; font-size:1.1rem;">LANZAR AHORA 🔥</button>
        </form>
    </div>
</body>
'''

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
