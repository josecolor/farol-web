// Precarga para la prueba de integración de video: mock-pg + noticia "prueba" con clip (campos leídos de TEST_VIDEO_JSON si existe)
require('./mock-pg');
const Module = require('module'); const fs = require('fs'); const base = Module._load;
Module._load = function (r, ...a) {
    const m = base.call(this, r, ...a);
    if (r !== 'pg') return m;
    return { Pool: class extends m.Pool {
        async query(sql, p) {
            if (/UPDATE noticias SET video_nombre/.test(sql)) { global.__videoUpd = p; return { rows: [{ slug: 'prueba' }], rowCount: 1 }; }
            const res = await super.query(sql, p);
            if (/FROM noticias WHERE slug/.test(sql) && res.rows.length && process.env.TEST_VIDEO_JSON && fs.existsSync(process.env.TEST_VIDEO_JSON))
                return { rows: [{ ...res.rows[0], ...JSON.parse(fs.readFileSync(process.env.TEST_VIDEO_JSON, 'utf8')) }] };
            return res;
        }
    } };
};
