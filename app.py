from flask import Flask, render_template_string, request, redirect, url_for, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'farol_olimpo_final_2026'

# CONFIGURACIÓN
UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///farol_limpio.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# MODELO DE DATOS
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200))
    resumen = db.Column(db.Text)
    keywords = db.Column(db.String(200))
    multimedia_url = db.Column(db.String(400))
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()

# --- PANEL DE PRENSA PROFESIONAL (SIN AVISO ROJO) ---
html_panel = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Redacción El Farol</title>
    <script src="https://cdn.ckeditor.com/4.25.1-lts/standard/ckeditor.js"></script>
    <style>
        body { background-color: #000; color: #fff; font-family: 'Arial Black', sans-serif; padding: 15px; }
        .editor-container { max-width: 800px; margin: auto; background: #0a0a0a; padding: 25px; border-radius: 20px; border: 3px solid #ff8c00; }
        .header-editor { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; }
        .btn-publicar { background: #ff8c00; color: #000; font-weight: 900; border: none; padding: 15px 35px; border-radius: 12px; cursor: pointer; text-transform: uppercase; font-size: 1.1rem; }
        input[type="text"] { width: 100%; padding: 15px; margin-bottom: 20px; border-radius: 8px; border: none; background: #fff; color: #000; font-weight: 900; box-sizing: border-box; }
        .file-upload { background: #1a1a1a; padding: 20px; border-radius: 10px; border: 2px dashed #ff8c00; margin-top: 20px; }
        label { color: #ff8c00; font-size: 1.2rem; display: block; margin-bottom: 8px; text-transform: uppercase; }
    </style>
</head>
<body>
    <form method="post" enctype="multipart/form-data" class="editor-container">
        <div class="header-editor">
            <h1 style="color: #ff8c00; margin: 0;">🎤 REDACCIÓN ELITE</h1>
            <button type="submit" class="btn-publicar">PUBLICAR 🔥</button>
        </div>

        <label>TÍTULO DE LA ENTRADA</label>
        <input type="text" name="titulo" required>

        <label>CUERPO DE LA NOTICIA (ESTILO BLOGGER)</label>
        <textarea name="resumen" id="editor_pro"></textarea>

        <label style="margin-top:20px;">ETIQUETAS SEO</label>
        <input type="text" name="keywords" placeholder="noticias, army, farol...">

        <div class="file-upload">
            <label style="font-size: 1rem;">IMAGEN DE PORTADA</label>
            <input type="file" name="foto" required style="color: #fff; font-weight: bold;">
        </div>
    </form>

    <script>
        // ESTO QUITA EL "DISPARATE" DEL AVISO ROJO DE SEGURIDAD
        CKEDITOR.config.versionCheck = false;
        
        CKEDITOR.replace('editor_pro', {
            height: 400,
            removeButtons: 'About',
            // Mantenemos el fondo blanco en el editor para que usted vea bien las letras negras
            uiColor: '#eeeeee' 
        });
    </script>
</body>
</html>
'''

# --- PORTADA PARA EL PÚBLICO ---
html_portada = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-V5QW7Y6X8Z"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-V5QW7Y6X8Z');
    </script>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>El Farol | Olimpo</title>
    <style>
        body { background-color: #000; color: #fff; font-family: sans-serif; margin: 0; }
        .header { border-bottom: 5px solid #ff8c00; padding: 30px; text-align: center; }
        .container { max-width: 900px; margin: auto; padding: 20px; }
        .noticia { background: #0a0a0a; border: 1px solid #222; border-radius: 15px; margin-bottom: 40px; overflow: hidden; }
        .noticia img { width: 100%; height: auto; border-bottom: 4px solid #ff8c00; }
        .contenido { padding: 25px; }
        .contenido h1 { color: #ff8c00; font-size: 2.2rem; margin-top: 0; }
        /* Para que las negritas del editor se vean bien */
        .texto-final b, .texto-final strong { color: #ff8c00; font-weight: bold; }
    </style>
</head>
<body>
    <div class="header"><h1 style="color:#ff8c00; font-family:Impact; font-size:3rem; margin:0;">🏮 EL FAROL</h1></div>
    <div class="container">
        {% for n in noticias %}
        <div class="noticia">
            <img src="/uploads/{{ n.multimedia_url }}">
            <div class="contenido">
                <h1>{{ n.titulo }}</h1>
                <div class="texto-final">{{ n.resumen|safe }}</div>
                <p style="color:#ff8c00; font-weight:bold; margin-top:20px;">#{{ n.keywords }}</p>
            </div>
        </div>
        {% endfor %}
    </div>
</body>
</html>
'''

@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template_string(html_portada, noticias=noticias)

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if request.method == 'POST':
        if request.form.get('u') == 'director' and request.form.get('p') == 'farol_director':
            session['user_id'] = 1
            return redirect(url_for('panel'))
    return '<body style="background:#000;text-align:center;padding-top:100px;color:#fff;font-family:sans-serif;"><form method="post" style="display:inline-block;background:#111;padding:40px;border:3px solid #ff8c00;border-radius:15px;"><h2 style="color:#ff8c00;">ACCESO OLIMPO</h2><input name="u" placeholder="Usuario" style="padding:10px;margin-bottom:10px;width:100%;"><br><input name="p" type="password" placeholder="Clave" style="padding:10px;margin-bottom:20px;width:100%;"><br><button type="submit" style="background:#ff8c00;padding:10px 40px;font-weight:900;border:none;border-radius:8px;">ENTRAR</button></form></body>'

@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if 'user_id' not in session: return redirect(url_for('admin'))
    if request.method == 'POST':
        t, r, k = request.form.get('titulo'), request.form.get('resumen'), request.form.get('keywords')
        f = request.files.get('foto')
        if f:
            fname = f"exclusiva_{datetime.utcnow().timestamp()}.jpg"
            f.save(os.path.join(UPLOAD_FOLDER, fname))
            db.session.add(Noticia(titulo=t, resumen=r, keywords=k, multimedia_url=fname))
            db.session.commit()
            return redirect(url_for('index'))
    return render_template_string(html_panel)

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
