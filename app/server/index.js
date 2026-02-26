const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../../'))); 

// CONEXIÓN AUTOMÁTICA: Railway llenará esto solo
const mongoURI = process.env.MONGO_URL || process.env.MONGODB_URI;

mongoose.connect(mongoURI)
  .then(() => console.log("🔥 Farol conectado con éxito"))
  .catch(err => console.error("❌ Error DB:", err));

const News = mongoose.model('News', new mongoose.Schema({
    title: String, location: String, content: String, date: { type: Date, default: Date.now }
}));

app.get('/api/news', async (req, res) => {
    const news = await News.find().sort({ date: -1 });
    res.json(news);
});

app.post('/api/news', async (req, res) => {
    const newReport = new News(req.body);
    await newReport.save();
    res.json({ success: true });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../../index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../../admin.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Puerto ${PORT}`));
