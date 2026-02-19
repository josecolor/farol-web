import os
from flask import Flask, render_template, request, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from functools import wraps
from datetime import datetime

app = Flask(__name__)
app.secret_key = "farol_secreto_2026_mxl" # Llave de seguridad interna

# --- CONFIGURACIÓN DE BASE DE DATOS PROFESIONAL ---
uri = os.getenv("DATABASE_URL", "sqlite:///farol.db")
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- MODELO DE NOTICIA (FOTO, TEXTO, VIDEO, SEO) ---
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(250), nullable=False)
    contenido = db.Column(db.Text, nullable=False)
    imagen_url = db.Column(db.String(500))
    video_url = db.Column(db.String(500))
    keywords = db.Column(db.String(200))
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()

# --- FILTRO DE SEGURIDAD ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# --- RUTA 1: PORTADA PÚBLICA (ESTILO LISTÍN DIARIO) ---
@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('index.html', noticias=noticias)

# --- RUTA 2: LOGIN SEGURO ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        if request.form['username'] == 'director' and request.form['password'] == 'farol2026':
            session['logged_in'] = True
            return redirect(url_for('admin'))
        else:
            error = 'Acceso denegado.'
    return f'''
    <body style="background:#003366; color:white; font-family:Impact; text-align:center; padding-top:100px;">
        <h1>🏮 CONTROL DE ACCESO EL FAROL</h1>
        <form method="post" style="background:white; padding:30px; display:inline-block; color:black; border-radius:15px; border-bottom:5px solid #FF8C00;">
            <input type="text" name="username" placeholder="Usuario" style="width:100%; padding:10px; margin-bottom:10px;" required><br>
            <input type="password" name="password" placeholder="Contraseña" style="width:100%; padding:10px; margin-bottom:10px;" required><br>
            <button type="submit" style="background:#FF8C00; color:white; border:none; padding:15px; width:100%; font-family:Impact; cursor:pointer;">ENTRAR AL PANEL</button>
            <p style="color:red;">{error if error else ""}</p>
        </form>
    </body>
    '''

# --- RUTA 3: PANEL DE ADMINISTRACIÓN (ESTILO BLOGGER) ---
@app.route('/admin', methods=['GET', 'POST'])
@login_required
def admin():
    if request.method == 'POST':
        nueva_nota = Noticia(
            titulo=request.form['titulo'],
            contenido=request.form['contenido'],
            imagen_url=request.form['imagen_url'],
            video_url=request.form['video_url'],
            keywords=request.form['keywords']
        )
        db.session.add(nueva_nota)
        db.session.commit()
        return redirect(url_for('index'))
    
    # Vista del Editor tipo Blogger
    return '''
    <body style="background:#f4f4f4; font-family:sans-serif; margin:0;">
        <div style="background:#003366; color:white; padding:15px; font-family:Impact; display:flex; justify-content:space-between; align-items:center;">
            <h2 style="margin:0;">🏮 PANEL DE EDICIÓN PRO</h2>
            <a href="/" style="color:white; text-decoration:none; background:#FF8C00; padding:10px; border-radius:5px;">VER WEB</a>
        </div>
        
        <div style="max-width:800px; margin:20px auto; background:white; padding:30px; border-radius:10px; box-shadow:0 0 20px rgba(0,0,0,0.1);">
            <form method="post">
                <h3 style="color:#003366; border-bottom:2px solid #FF8C00;">CREAR NUEVA ENTRADA</h3>
                
                <label><b>Título de la Noticia (Tipografía Impact):</b></label><br>
                <input type="text" name="titulo" placeholder="Ej: EXCLUSIVA: LO QUE PASA EN MEXICALI" style="width:100%; padding:12px; margin:10px 0; border:1px solid #ccc;" required><br>
                
                <label><b>URL de la Foto Principal:</b></label><br>
                <input type="text" name="imagen_url" placeholder="Pegue el link de la imagen" style="width:100%; padding:12px; margin:10px 0; border:1px solid #ccc;"><br>
                
                <label><b>URL del Video (YouTube/FB):</b></label><br>
                <input type="text" name="video_url" placeholder="Link del video" style="width:100%; padding:12px; margin:10px 0; border:1px solid #ccc;"><br>
                
                <label><b>Palabras Clave (SEO):</b></label><br>
                <input type="text" name="keywords" placeholder="Nacional, Viral, Mexicali" style="width:100%; padding:12px; margin:10px 0; border:1px solid #ccc;"><br>
                
                <label><b>Cuerpo de la Noticia:</b></label><br>
                <textarea name="contenido" placeholder="Escriba aquí la noticia completa..." style="width:100%; height:250px; padding:12px; margin:10px 0; border:1px solid #ccc;" required></textarea><br>
                
                <button type="submit" style="background:#003366; color:white; padding:20px; width:100%; border:none; font-family:Impact; font-size:1.5em; cursor:pointer; border-radius:5px; margin-top:10px;">🚀 PUBLICAR EN EL FAROL</button>
            </form>
        </div>
    </body>
    '''

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
