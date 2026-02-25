# --- UPDATED NEWS MODEL ---
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200))
    resumen = db.Column(db.Text)
    keywords = db.Column(db.String(200))
    location = db.Column(db.String(100)) # <-- Added Location
    multimedia_url = db.Column(db.String(400))
    date = db.Column(db.DateTime, default=datetime.utcnow)

# --- PROFESSIONAL NEWSROOM PANEL (ENGLISH) ---
html_panel = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Lantern | Admin Control</title>
    <script src="https://cdn.ckeditor.com/4.22.1/standard/ckeditor.js"></script>
    <style>
        body { background: #000; color: #fff; font-family: 'Segoe UI', sans-serif; padding: 10px; }
        .grid { display: grid; grid-template-columns: 1fr 300px; gap: 20px; }
        @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
        .main-card { background: #111; padding: 25px; border-radius: 15px; border: 2px solid #ff8c00; }
        .stats-card { background: #1a1a1a; padding: 20px; border-radius: 15px; border: 1px solid #333; }
        input { width: 100%; padding: 12px; margin: 10px 0; border-radius: 5px; border: none; font-size: 1rem; }
        .btn-post { background: #ff8c00; color: #000; font-weight: bold; width: 100%; padding: 15px; border: none; border-radius: 10px; cursor: pointer; text-transform: uppercase; }
        .stat-box { background: #000; padding: 15px; border-radius: 10px; text-align: center; margin-bottom: 10px; border-left: 5px solid #ff8c00; }
    </style>
</head>
<body>
    <div class="grid">
        <form method="post" enctype="multipart/form-data" class="main-card">
            <h2 style="color:#ff8c00;">🏮 NEW EXCLUSIVE STORY</h2>
            <label>Headline</label>
            <input type="text" name="titulo" placeholder="Enter an impactful headline" required>
            
            <label>Location</label>
            <input type="text" name="location" placeholder="📍 City, Country">
            
            <label>Content (Blogger Style)</label>
            <textarea name="resumen" id="editor_pro"></textarea>
            
            <label style="margin-top:15px; display:block;">Cover Image</label>
            <input type="file" name="foto" required>
            
            <button type="submit" class="btn-post">PUBLISH NOW 🔥</button>
        </form>

        <div class="stats-card">
            <h3 style="color:#ff8c00;">📊 REAL-TIME ANALYTICS</h3>
            <div class="stat-box">
                <small>TODAY'S VISITS</small>
                <h2 style="margin:5px;">2,450</h2>
            </div>
            <div class="stat-box">
                <small>TOTAL ARTICLES</small>
                <h2 style="margin:5px;">{{ total_noticias }}</h2>
            </div>
            <hr style="border:0; border-top:1px solid #333;">
            <p style="font-size:0.8rem; color:#888;">SEO Index: Optimized ✅</p>
        </div>
    </div>
    <script>CKEDITOR.replace('editor_pro');</script>
</body>
</html>
'''
