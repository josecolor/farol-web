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

# MODELO DE USUARIOS (EL ARMY)
class Usuario(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password = db.Column(db.String(50), nullable=False)
    nombre_publico = db.Column(db.String(100), default="Reportero Farol")
    foto_perfil = db.Column(db.String(400), default="default_user.png")

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
    # CREAR LOS 4 ACCESOS SI NO EXISTEN
    if not Usuario.query.filter_by(username='admin').first():
        for i in range(1, 5):
            u = Usuario(username=f'reportero{i}', password=f'farol{i}')
            db.session.add(u)
        db.session.commit()

@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('index.html', noticias=noticias)

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if request.method == 'POST':
        user = request.form.get('user')
        pw = request.form.get('password')
        u = Usuario.query.filter_by(username=user, password=pw).first()
        if u:
            session['user_id'] = u.id
            return redirect(url_for('panel'))
    return '''<form method="post" style="text-align:center;padding:50px;">
              <h2>Acceso Army El Farol</h2>
              <input name="user" placeholder="Usuario"><br><br>
              <input name="password" type="password" placeholder="Clave"><br><br>
              <button type="submit">Entrar</button></form>'''

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
            cuerpo = request.form.get('cuerpo')
            foto_n = request.files.get('foto_noticia')
            if foto_n:
                fname_n = f"n_{datetime.utcnow().timestamp()}.jpg"
                foto_n.save(os.path.join(UPLOAD_FOLDER, fname_n))
                nueva = Noticia(titulo=titulo, resumen=cuerpo, multimedia_url=fname_n, autor_id=u.id)
                db.session.add(nueva)
                db.session.commit()
            return redirect(url_for('index'))
            
    return f'''<div style="padding:20px;">
        <h3>Bienvenido, {u.nombre_publico}</h3>
        <form method="post" enctype="multipart/form-data" style="background:#eee;padding:10px;">
            <h4>Tu Perfil (Sube tu foto aquí)</h4>
            <input name="nombre" value="{u.nombre_publico}">
            <input type="file" name="foto_perfil" accept="image/*">
            <button name="update_profile" type="submit">Guardar Perfil</button>
        </form>
        <hr>
        <form method="post" enctype="multipart/form-data">
            <h4>Nueva Noticia</h4>
            <input name="titulo" placeholder="Título" style="width:100%"><br><br>
            <textarea name="cuerpo" placeholder="Noticia..." style="width:100%"></textarea><br><br>
            <input type="file" name="foto_noticia" accept="image/*" required><br>
            <button type="submit" style="background:orange;">PUBLICAR AHORA</button>
        </form></div>'''

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
