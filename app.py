import os
from flask import Flask, render_template, request, redirect, url_for
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)

# --- CONFIGURACIÓN DE BASE DE DATOS PROFESIONAL ---
uri = os.getenv("DATABASE_URL", "sqlite:///farol.db")
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Modelo de Noticias para "El Farol al Día"
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200), nullable=False)
    contenido = db.Column(db.Text, nullable=False)
    fecha = db.Column(db.DateTime, server_default=db.func.now())

# Crear base de datos automáticamente
with app.app_context():
    db.create_all()

# PORTADA DEL PORTAL
@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.id.desc()).all()
    return render_template('index.html', noticias=noticias)

# ESCRITORIO DE EDITOR (Su nuevo panel estilo Blogger)
@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if request.method == 'POST':
        nueva_nota = Noticia(
            titulo=request.form['titulo'], 
            contenido=request.form['contenido']
        )
        db.session.add(nueva_nota)
        db.session.commit()
        return redirect(url_for('index'))
    
    return '''
    <div style="background:#FF8C00; color:white; padding:30px; font-family:Impact; text-align:center; border-bottom:10px solid #003366;">
        <h1>🏮 ESCRITORIO DE EDITOR - EL FAROL AL DÍA</h1>
    </div>
    <div style="max-width:800px; margin:20px auto; padding:20px; font-family:sans-serif; background:#fff; border:1px solid #ddd;">
        <form method="post">
            <label>Título de la Noticia (Impact Style):</label><br>
            <input type="text" name="titulo" style="width:100%; padding:10px; margin:10px 0; font-size:1.2em;" required><br><br>
            <label>Contenido de la Noticia:</label><br>
            <textarea name="contenido" style="width:100%; height:300px; padding:10px; margin:10px 0;" required></textarea><br>
            <button type="submit" style="background:#003366; color:white; padding:20px; width:100%; border:none; font-family:Impact; font-size:1.5em; cursor:pointer;">🚀 PUBLICAR EN EL FAROL</button>
        </form>
    </div>
    '''

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
