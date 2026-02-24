from flask import Flask, request, render_template, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import requests
import os

app = Flask(__name__)

# CONFIGURACIÓN PROFESIONAL
TOKEN = "8737097121:AAGiOFVpxLbbpH4iE9dlx4lJN8uAMtIPACo"
UPLOAD_FOLDER = os.path.join('static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Conexión a la base de datos (Postgres)
DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///farol.db')
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# MODELO DE NOTICIA
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200), nullable=False)
    resumen = db.Column(db.Text, nullable=False)
    multimedia_url = db.Column(db.String(400))
    categoria = db.Column(db.String(50), default="EXCLUSIVA")
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()

@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('index.html', noticias=noticias)

@app.route('/webhook', methods=['POST'])
def webhook():
    update = request.get_json()
    if "message" in update:
        msg = update["message"]
        
        # SI MANDA FOTO CON TEXTO
        if "photo" in msg and "caption" in msg:
            texto = msg["caption"]
            file_id = msg["photo"][-1]["file_id"]
            
            # Descargar de Telegram
            f_info = requests.get(f"https://api.telegram.org/bot{TOKEN}/getFile?file_id={file_id}").json()
            f_path = f_info["result"]["file_path"]
            f_res = requests.get(f"https://api.telegram.org/file/bot{TOKEN}/{f_path}")
            
            filename = f"bot_{datetime.utcnow().timestamp()}.jpg"
            with open(os.path.join(UPLOAD_FOLDER, filename), 'wb') as f:
                f.write(f_res.content)
            
            # Guardar en Base de Datos
            nueva_nota = Noticia(
                titulo=texto[:50] + "...",
                resumen=texto,
                multimedia_url=filename
            )
            db.session.add(nueva_nota)
            db.session.commit()
            
            # AVISO A GMAIL (Simulado)
            print(f"Aviso enviado a jose.colorvision@gmail.com")
            
    return {"ok": True}

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
