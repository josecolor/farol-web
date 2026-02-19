import os
from flask import Flask, render_template, request, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from functools import wraps
from datetime import datetime

app = Flask(__name__)
app.secret_key = "farol_secreto_2026_mxl"

# --- CONFIGURACIÓN DE BASE DE DATOS ---
uri = os.getenv("DATABASE_URL", "sqlite:///farol.db")
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- MODELO DE NOTICIA ---
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

# --- SEGURIDAD ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('index.html', noticias=noticias)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form['username'] == 'director' and request.form['password'] == 'farol2026':
            session['logged_in'] = True
            return redirect(url_for('admin'))
    return '''
    <body style="background:#003366; color:white; font-family:Impact; text-align:center; padding-top:100px;">
        <h1>🏮 ACCESO EL FAROL</h1>
        <form method="post" style="background:white; padding:30px; display:inline-block; color:black; border-radius:15px;">
            <input type="text" name="username" placeholder="Usuario" required><br><br>
            <input type="password" name="password" placeholder="Contraseña" required><br><br>
            <button type="submit" style="background:#FF8C00; color:white; border:none; padding:10px 20px; font-family:Impact;">ENTRAR</button>
        </form>
    </body>
    '''

# --- PANEL CON TODOS LOS ICONOS (ESTILO BLOGGER) ---
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
    
    return '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Editor El Farol</title>
        <script src="https://cdn.ckeditor.com/4.22.1/standard/ckeditor.js"></script>
    </head>
    <body style="background:#f4f4f4; font-family:sans-serif; margin:0; padding:20px;">
        <div style="max-width:900px; margin:auto; background:white; padding:20px; border-radius:10px; box-shadow:0 0 10px rgba(0,0,0,0.1);">
            <h2 style="font-family:Impact; color:#003366;">🏮 EDITOR DE NOTICIAS - ESTILO BLOGGER</h2>
            <form method="post">
                <input type="text" name="titulo" placeholder="Título de la Noticia" style="width:100%; padding:10px; margin-bottom:10px; font-size:1.2em;" required>
                <input type="text" name="imagen_url" placeholder="URL de la Foto" style="width:100%; padding:10px; margin-bottom:10px;">
                <input type="text" name="video_url" placeholder="URL del Video" style="width:100%; padding:10px; margin-bottom:10px;">
                <input type="text" name="keywords" placeholder="Palabras Clave (SEO)" style="width:100%; padding:10px; margin-bottom:10px;">
                
                <p><b>Contenido (Use los iconos para dar formato):</b></p>
                <textarea name="contenido" id="editor1"></textarea>
                
                <script>
                    CKEDITOR.replace('editor1'); // ACTIVA LOS ICONOS TIPO BLOGGER
                </script>
                
                <button type="submit" style="background:#FF8C00; color:white; width:100%; padding:15px; border:none; font-family:Impact; font-size:1.5em; margin-top:20px; cursor:pointer;">🚀 PUBLICAR EN EL FAROL</button>
            </form>
        </div>
    </body>
    </html>
    '''

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
                
