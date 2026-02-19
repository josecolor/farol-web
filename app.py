import os
from flask import Flask, render_template, request, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from functools import wraps
from datetime import datetime

app = Flask(__name__)
app.secret_key = "farol_mxl_2026_safe"

# BASE DE DATOS PROFESIONAL
uri = os.getenv("DATABASE_URL", "sqlite:///farol.db")
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

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

# SEGURIDAD DE ACCESO
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
    return '<body style="background:#003366;color:white;text-align:center;padding-top:100px;font-family:Impact;"><h1>🏮 LOGIN EL FAROL</h1><form method="post" style="background:white;padding:20px;display:inline-block;border-radius:10px;color:black;"><input name="username" placeholder="Usuario"><br><br><input type="password" name="password" placeholder="Clave"><br><br><button type="submit">ENTRAR</button></form></body>'

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
        <title>Panel El Farol</title>
        <script src="https://cdn.ckeditor.com/4.22.1/full/ckeditor.js"></script>
    </head>
    <body style="background:#f4f4f4;font-family:sans-serif;padding:20px;">
        <div style="max-width:900px;margin:auto;background:white;padding:25px;border-radius:15px;box-shadow:0 0 15px rgba(0,0,0,0.2);">
            <h2 style="font-family:Impact;color:#003366;text-align:center;border-bottom:4px solid #FF8C00;padding-bottom:10px;">🏮 EDITOR PROFESIONAL - EL FAROL</h2>
            <form method="post">
                <input type="text" name="titulo" placeholder="Título Impactante" style="width:100%;padding:10px;margin:10px 0;" required>
                <input type="text" name="imagen_url" placeholder="URL de la Foto (Blur 20% automático)" style="width:100%;padding:10px;margin:10px 0;">
                <input type="text" name="video_url" placeholder="URL del Video (YouTube/FB)" style="width:100%;padding:10px;margin:10px 0;">
                <input type="text" name="keywords" placeholder="Keywords: Nacional, Viral, Mexicali" style="width:100%;padding:10px;margin:10px 0;">
                <textarea name="contenido" id="editor_pro"></textarea>
                <script>CKEDITOR.replace('editor_pro');</script>
                <button type="submit" style="background:#FF8C00;color:white;width:100%;padding:20px;font-family:Impact;font-size:1.5em;border:none;margin-top:20px;cursor:pointer;border-radius:10px;">🚀 PUBLICAR NOTICIA</button>
            </form>
        </div>
    </body>
    </html>
    '''

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))

                
