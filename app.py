import os, re
from flask import Flask, render_template, request, redirect, url_for, session, flash, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from functools import wraps
from unicodedata import normalize
from werkzeug.utils import secure_filename

app = Flask(__name__)

# --- CONFIGURACIÓN MULTIMEDIA ---
UPLOAD_FOLDER = 'static/uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # Límite 100MB para videos
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

basedir = os.path.abspath(os.path.dirname(__file__))
db_path = os.path.join(basedir, 'noticias.db')
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = 'el_farol_mxl_2026_secreto'

db = SQLAlchemy(app)

def slugify(text):
    text = normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii').lower()
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')

class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200), nullable=False)
    slug = db.Column(db.String(200), unique=True)
    contenido = db.Column(db.Text, nullable=False)
    multimedia_url = db.Column(db.String(300))
    tipo_multimedia = db.Column(db.String(10)) # 'imagen' o 'video'
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if not session.get('logged_in'): return redirect(url_for('login'))
    if request.method == 'POST':
        file = request.files.get('archivo')
        filename = ""
        tipo = "imagen"
        if file and file.filename != '':
            filename = secure_filename(file.filename)
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            if filename.lower().endswith(('mp4', 'mov', 'avi')): tipo = "video"
        
        titulo = request.form.get('titulo')
        nueva_nota = Noticia(
            titulo=titulo,
            slug=slugify(titulo),
            contenido=request.form.get('contenido'),
            multimedia_url=filename,
            tipo_multimedia=tipo
        )
        db.session.add(nueva_nota)
        db.session.commit()
        return redirect(url_for('admin'))
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('admin.html', noticias=noticias)

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# (Aquí siguen sus rutas de index, login y noticia_slug...)
