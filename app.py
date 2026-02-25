from flask import Flask, request, render_template, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import requests
import os

app = Flask(__name__)

# CONFIGURACIÓN ROBUSTA
TOKEN = os.environ.get('TOKEN', '8737097121:AAGiOFVpxLbbpH4iE9dlx4lJN8uAMtIPACo')
UPLOAD_FOLDER = 'static/uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# FORZAR SQLITE PARA EVITAR EL "NOT FOUND" DE BASE DE DATOS
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///farol.db'
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

# CREAR BASE DE DATOS AL ARRANCAR
with app.app_context():
    db.create_all()

@app.route('/')
def index():
    try:
        noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
        return render_template('index.html', noticias=noticias)
    except:
        return "<h1>El Farol está en mantenimiento, refresque en un minuto.</h1>"

@app.route('/webhook', methods=['POST'])
def webhook():
    update = request.get_json()
    if update and "message" in update:
        msg = update["message"]
        if "photo" in msg and "caption" in msg:
            texto = msg["caption"]
            file_id = msg["photo"][-1]["file_id"]
            
            # Descargar de Telegram
            f_info = requests.get(f"https://api.telegram.org/bot{TOKEN}/getFile?file_id={file_id}").json()
            if "result" in f_info:
                f_path = f_info["result"]["file_path"]
                f_res = requests.get(f"https://api.telegram.org/file/bot{TOKEN}/{f_path}")
                
                filename = f"bot_{datetime.utcnow().timestamp()}.jpg"
                with open(os.path.join(UPLOAD_FOLDER, filename), 'wb') as f:
                    f.write(f_res.content)
                
                nueva_nota = Noticia(
                    titulo=texto[:50] + "...",
                    resumen=texto,
                    multimedia_url=filename
                )
                db.session.add(nueva_nota)
                db.session.commit()
    return {"ok": True}

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == "__main__":
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
