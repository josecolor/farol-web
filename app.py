import os
from flask import Flask, render_template, request, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

app = Flask(__name__)

# CONFIGURACIÓN DE BASE DE DATOS
# Usa SQLite para simplicidad en Railway
app.config['SQLALCHEMY_DATABASE_DATABASE_URI'] = 'sqlite:///noticias.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = 'el_farol_mxl_2026'

db = SQLAlchemy(app)

# MODELO DE LA NOTICIA (Estructura para SEO)
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200), nullable=False)
    contenido = db.Column(db.Text, nullable=False)
    protagonista = db.Column(db.String(100))
    ciudad = db.Column(db.String(100))
    categoria = db.Column(db.String(50), default='Nacional')
    imagen_url = db.Column(db.String(300))
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

# CREACIÓN DE BASE DE DATOS (Vital para evitar Error 500)
with app.app_context():
    db.create_all()

# RUTAS DEL PORTAL
@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('index.html', noticias=noticias)

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if request.method == 'POST':
        nueva_nota = Noticia(
            titulo=request.form.get('titulo'),
            contenido=request.form.get('contenido'),
            protagonista=request.form.get('protagonista'),
            ciudad=request.form.get('ciudad'),
            categoria=request.form.get('categoria'),
            imagen_url=request.form.get('imagen_url')
        )
        db.session.add(nueva_nota)
        db.session.commit()
        return redirect(url_for('index'))
    return render_template('admin.html')

# CONFIGURACIÓN DEL PUERTO PARA RAILWAY (El punto crítico)
if __name__ == '__main__':
    # Railway inyecta la variable PORT, si no existe usa el 5000 por defecto
    puerto = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=puerto)
