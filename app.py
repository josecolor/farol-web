import os
from flask import Flask, render_template, request, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from functools import wraps

app = Flask(__name__)
app.secret_key = "farol_secreto_2026"

# Configuración de Base de Datos
uri = os.getenv("DATABASE_URL", "sqlite:///farol.db")
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = uri
db = SQLAlchemy(app)

# MODELO COMPLETO (Sincronizado con su nuevo index.html)
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200), nullable=False)
    contenido = db.Column(db.Text, nullable=False)
    imagen_url = db.Column(db.String(500))  # CAMPO PARA FOTO
    video_url = db.Column(db.String(500))   # CAMPO PARA VIDEO
    keywords = db.Column(db.String(200))    # CAMPO PARA SEO
    fecha = db.Column(db.DateTime, server_default=db.func.now())

with app.app_context():
    db.create_all()

# SEGURIDAD
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form['username'] == 'director' and request.form['password'] == 'farol2026':
            session['logged_in'] = True
            return redirect(url_for('admin'))
    return '''
        <body style="background:#003366; color:white; font-family:Impact; text-align:center; padding-top:50px;">
            <h1>🏮 ACCESO EL FAROL</h1>
            <form method="post" style="background:white; padding:20px; display:inline-block; color:black; border-radius:10px;">
                <input type="text" name="username" placeholder="Usuario" required><br><br>
                <input type="password" name="password" placeholder="Contraseña" required><br><br>
                <button type="submit" style="background:#FF8C00; color:white; border:none; padding:10px 20px;">ENTRAR</button>
            </form>
        </body>
    '''

@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.id.desc()).all()
    return render_template('index.html', noticias=noticias)

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
    return f'''
        <body style="background:#FF8C00; font-family:sans-serif; padding:20px;">
            <h1 style="font-family:Impact; color:white;">🏮 EDITOR PRO - EL FAROL</h1>
            <form method="post" style="background:white; padding:20px; border-radius:10px;">
                <input type="text" name="titulo" placeholder="Título Impact" style="width:100%" required><br><br>
                <input type="text" name="imagen_url" placeholder="URL de la Foto" style="width:100%"><br><br>
                <input type="text" name="video_url" placeholder="URL del Video" style="width:100%"><br><br>
                <input type="text" name="keywords" placeholder="Keywords (SEO)" style="width:100%"><br><br>
                <textarea name="contenido" placeholder="Texto de la noticia" style="width:100%; height:150px;" required></textarea><br><br>
                <button type="submit" style="background:#003366; color:white; width:100%; padding:15px; border:none; font-family:Impact;">🚀 PUBLICAR AHORA</button>
            </form>
        </body>
    '''

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
