from flask import Flask, render_template_string, request, redirect, url_for, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'farol_olimpo_final_2026'

# CONFIGURACIÓN DE CARPETAS Y BASE DE DATOS
UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///farol_limpio.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# MODELO DE DATOS (ESTRUCTURA DE LA NOTICIA)
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200))
    resumen = db.Column(db.Text)
    keywords = db.Column(db.String(200))
    location = db.Column(db.String(100))
    multimedia_url = db.Column(db.String(400))
    date = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()

# --- PANEL DE REDACCIÓN ELITE (MODO OSCURO TOTAL) ---
html_panel = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Lantern | Admin</title>
    <script src="https://cdn.tiny.cloud/1/no-api-key/tinymce/6/tinymce.min.js" referrerpolicy="origin"></script>
    <style>
        body { background: #000; color: #fff; font-family: 'Segoe UI', sans-serif; padding: 10px; margin: 0; }
        .grid { display: grid; grid-template-columns: 1fr 300px; gap: 20px; max-width: 1200px; margin: auto; }
        @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
        .main-card { background: #111; padding: 20px; border-radius: 15px; border: 2px solid #ff8c00; box-sizing: border-box; }
        .stats-card { background: #1a1a1a; padding: 20px; border-radius: 15px; border: 1px solid #333; }
        input { width: 100%; padding: 12px; margin: 10px 0; border-radius: 8px; border: none; font-size: 1rem; box-sizing: border-box; }
        .btn-post { background: #ff8c00; color: #000; font-weight: bold; width: 100%; padding: 18px; border: none; border-radius: 10px; cursor: pointer; text-transform: uppercase; font-size: 1.1rem; margin-top: 15px; }
        .stat-box { background: #000; padding: 15px; border-radius: 10px; text-align: center; margin-bottom: 10px; border-left: 5px solid #ff8c00; }
        label { color: #ff8c00; font-weight: bold; font-size: 0.8rem; text-transform: uppercase; }
    </style>
</head>
<body>
    <div class="grid">
        <form method="post" enctype="multipart/form-data" class="main-card">
            <h2 style="color:#ff8c00; margin-top:0;">🏮 NEWSROOM ELITE</h2>
            
            <label>Headline</label>
            <input type="text" name="titulo" placeholder="Impactful headline..." required>
            
            <label>Location</label>
            <input type="text" name="location" placeholder="📍 City, Country">
            
            <label>Content (Blogger Style)</label>
            <textarea name="resumen" id="editor_pro"></textarea>
            
            <label style="margin-top:20px; display:block;">Cover Image</label>
            <input type="file" name="foto" required style="color:#fff;">
            
            <button type="submit" class="btn-post">PUBLISH TO THE WORLD 🔥</button>
        </form>

        <div class="stats-card">
            <h3 style="color:#ff8c00;">📊 ANALYTICS</h3>
            <div class="stat-box">
                <small>DAILY VISITS</small>
                <h2 style="margin:5px;">3,890</h2>
            </div>
            <div class="stat-box">
                <small>TOTAL STORIES</small>
                <h2 style="margin:5px;">{{ total_noticias }}</h2>
            </div>
            <hr style="border:0; border-top:1px solid #333; margin: 20px 0;">
            <p style="font-size:0.8rem; color:#888; text-align:center;">System Status: Active ✅</p>
        </div>
    </div>

    <script>
        tinymce.init({
          selector: '#editor_pro',
          height: 400,
          skin: "oxide-dark",
          content_css: "dark",
          plugins: 'lists link image emoticons table',
          toolbar: 'bold italic forecolor | alignleft aligncenter alignright | bullist numlist | link emoticons',
          menubar: false,
          statusbar: false,
          mobile: { toolbar: 'bold italic forecolor bullist emoticons' }
        });
    </script>
</body>
</html>
'''

# --- PORTADA PÚBLICA (FRONT-END) ---
html_portada = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Lantern | News</title>
    <style>
        body { background: #000; color: #eee; font-family: 'Helvetica', sans-serif; margin: 0; }
        .header { background: #000; border-bottom: 5px solid #ff8c00; padding: 25px; text-align: center; }
        .container { max-width: 850px; margin: auto; padding: 15px; }
        .card { background: #111; border-radius: 15px; margin-bottom: 40px; overflow: hidden; border: 1px solid #222; }
        .card img { width: 100%; height: auto; border-bottom: 3px solid #ff8c00; }
        .info { padding: 25px; }
        .meta { color: #ff8c00; font-size: 0.9rem; font-weight: bold; margin-bottom: 10px; }
        h1 { margin: 0 0 15px 0; color: #fff; font-size: 2.2rem; }
        .content { line-height: 1.7; font-size: 1.1rem; }
        .comments { background: #fff; padding: 20px; color: #000; }
    </style>
</head>
<body>
    <div class="header"><h1 style="color:#ff8c00; font-size:2.8rem; margin:0; font-family:Impact;">🏮 THE LANTERN</h1></div>
    <div class="container">
        {% for n in noticias %}
        <div class="card">
            <img src="/uploads/{{ n.multimedia_url }}">
            <div class="info">
                <div class="meta">📍 {{ n.location }} | 📅 {{ n.date.strftime('%b %d, %Y') }}</div>
                <h1>{{ n.titulo }}</h1>
                <div class="content">{{ n.resumen|safe }}</div>
            </div>
            <div class="comments">
                <div id="disqus_thread"></div>
            </div>
        </div>
        {% endfor %}
    </div>
    <script>
        (function() { 
            var d = document, s = d.createElement('script');
            s.src = 'https://elfarol-1.disqus.com/embed.js';
            s.setAttribute('data-timestamp', +new Date());
