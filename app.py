from flask import Flask, render_template, request, redirect, url_for, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'farol_ultra_secreto_2026'

# CONFIGURACIÓN DE POTENCIA
UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///farol.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# MODELO DE USUARIOS (USTED Y SUS 4 REPORTEROS)
class Usuario(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password = db.Column(db.String(50), nullable=False)
    nombre_publico = db.Column(db.String(100), default="Redacción El Farol")
    foto_perfil = db.Column(db.String(400), default="default_user.png")
    es_admin = db.Column(db.Boolean, default=False)

# MODELO DE NOTICIA
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200), nullable=False)
    resumen = db.Column(db.Text, nullable=False)
    multimedia_url = db.Column(db.String(400))
    autor_id = db.Column(db.Integer, db.ForeignKey('usuario.id'))
    autor = db.relationship('Usuario', backref='noticias')
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()
    # CREAR AL DIRECTOR Y LOS 4 REPORTEROS SI NO EXISTEN
    if not Usuario.query.filter_by(username='director').first():
        # Usted como Jefe
        admin_user = Usuario(username='director', password='farol_director', nombre_publico='Director General', es_admin=True)
        db.session.add(admin_user)
        # Sus 4 reporteros
        for i in range(1, 5):
            u = Usuario(username=f'reportero{i}', password=f'farol{i}', nombre_publico=f'Reportero {i}')
            db.session.add(u)
        db.session.commit()

@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('index.html', noticias=noticias)

@app.route('/admin', methods=['GET', 'POST'])
def admin_login():
    if request.method == 'POST':
        user = request.form.get('user')
        pw = request.form.get('password')
        u = Usuario.query.filter_by(username=user, password=pw).first()
        if u:
            session['user_id'] = u.id
            return redirect(url_for('panel'))
    return '''<div style="text-align:center;padding:50px;font-family:sans-serif;">
              <h2>Acceso a Redacción - El Farol</h2>
              <form method="post">
              <input name="user" placeholder="Usuario" style="padding:10px;"><br><br>
              <input name="password" type="password" placeholder="Clave" style="padding:10px;"><br><br>
              <button type="submit" style="padding:10px 20px;background:orange;border:none;color:white;">ENTRAR</button>
              </form></div>'''

@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if 'user_id' not in session: return redirect(url_for('admin_login'))
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
            cuerpo = request.form.get('cuerpo')
            foto_n = request.files.get('foto_noticia')
            if foto_n:
                fname_n = f"noticia_{datetime.utcnow().timestamp()}.jpg"
                foto_n.save(os.path.join(UPLOAD_FOLDER, fname_n))
                nueva = Noticia(titulo=titulo, resumen=cuerpo, multimedia_url=fname_n, autor_id=u.id)
                db.session.add(nueva)
                db.session.commit()
            return redirect(url_for('index'))
            
    return f'''<div style="padding:20px;font-family:sans-serif;">
        <h3>Bienvenido al Panel, {u.nombre_publico}</h3>
        <div style="background:#f4f4f4;padding:15px;border-radius:10px;">
            <h4>Tu Perfil (Personaliza tu voz y rostro)</h4>
            <form method="post" enctype="multipart/form-data">
                Nombre para el público: <input name="nombre" value="{u.nombre_publico}"><br><br>
                Tu Foto de Perfil: <input type="file" name="foto_perfil" accept="image/*"><br><br>
                <button name="update_profile" type="submit">Guardar mis datos</button>
            </form>
        </div>
        <hr>
        <div style="background:#fff3e0;padding:15px;border-radius:10px;">
            <h4>Redactar Nueva Noticia</h4>
            <form method="post" enctype="multipart/form-data">
                <input name="titulo" placeholder="Título de la noticia" style="width:100%;padding:10px;"><br><br>
                <textarea name="cuerpo" placeholder="Escribe aquí la noticia completa..." style="width:100%;height:150px;"></textarea><br><br>
                Subir Imagen de la Noticia: <input type="file" name="foto_noticia" accept="image/*" required><br><br>
                <button type="submit" style="background:green;color:white;padding:15px;width:100%;border:none;font-weight:bold;">PUBLICAR AHORA</button>
            </form>
        </div></div>'''

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
