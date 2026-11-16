// Feather Story API: a shared story desk where birds add sentences to a growing tale.
// SQLite storage for stories, sentences and events.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dir = path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'story.db'));
db.pragma('journal_mode = WAL');

db.exec(`CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  by_bird TEXT DEFAULT 'gurt',
  premise TEXT DEFAULT '',
  created TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sentences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id TEXT NOT NULL,
  bird TEXT NOT NULL,
  text TEXT NOT NULL,
  created TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id TEXT NOT NULL,
  bird TEXT NOT NULL,
  kind TEXT NOT NULL,
  note TEXT DEFAULT '',
  created TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sent_story ON sentences(story_id);
CREATE INDEX IF NOT EXISTS evt_story ON events(story_id);`);

const now = () => new Date().toISOString();
const rid = () => 'FS-' + Math.random().toString(36).slice(2, 8).toUpperCase();

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 100000) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); } });
  });
}
function storyRow(s) {
  const sentences = db.prepare('SELECT bird,text,created FROM sentences WHERE story_id=? ORDER BY id ASC').all(s.id);
  const words = sentences.reduce((n, x) => n + x.text.trim().split(/\s+/).filter(Boolean).length, 0);
  const birds = [...new Set(sentences.map(x => x.bird))];
  return { id: s.id, title: s.title, by_bird: s.by_bird, premise: s.premise,
           created: s.created, words, sentences, birds };
}

module.exports = function handler(req, res, route) {
  route = Array.isArray(route) ? route.join('/') : String(route || '');

  if (req.method === 'GET' && route === 'stats') {
    const stories = db.prepare('SELECT COUNT(*) AS n FROM stories').get().n;
    const sentences = db.prepare('SELECT COUNT(*) AS n FROM sentences').get().n;
    const birds = db.prepare('SELECT COUNT(DISTINCT bird) AS n FROM sentences').get().n;
    const words = db.prepare('SELECT text FROM sentences').all()
      .reduce((n, r) => n + r.text.trim().split(/\s+/).filter(Boolean).length, 0);
    return json(res, 200, { stories, sentences, birds, words });
  }

  if (req.method === 'GET' && (route === '' || route === 'stories')) {
    const rows = db.prepare('SELECT * FROM stories ORDER BY created ASC').all();
    return json(res, 200, { count: rows.length, stories: rows.map(storyRow) });
  }

  if (req.method === 'GET' && route === 'story') {
    const id = String(req.url.split('?')[1] || '').replace('id=', '').toUpperCase();
    const s = db.prepare('SELECT * FROM stories WHERE id=?').get(id);
    if (!s) return json(res, 404, { error: 'no such story' });
    const events = db.prepare('SELECT bird,kind,note,created FROM events WHERE story_id=? ORDER BY id ASC').all(id);
    return json(res, 200, { story: storyRow(s), events });
  }

  if (req.method === 'POST' && route === 'story') {
    return readBody(req).then(b => {
      const title = String(b.title || '').trim().slice(0, 100);
      if (!title) return json(res, 400, { error: 'a story needs a title' });
      const bird = String(b.by_bird || 'gurt').trim().slice(0, 40) || 'gurt';
      const id = rid();
      db.prepare('INSERT INTO stories (id,title,by_bird,premise,created) VALUES (?,?,?,?,?)')
        .run(id, title, bird, String(b.premise || '').slice(0, 300), now());
      db.prepare('INSERT INTO events (story_id,bird,kind,note,created) VALUES (?,?,?,?,?)')
        .run(id, bird, 'opened', 'opened the story', now());
      return json(res, 200, { ok: true, story: storyRow(db.prepare('SELECT * FROM stories WHERE id=?').get(id)) });
    });
  }

  if (req.method === 'POST' && route === 'sentence') {
    return readBody(req).then(b => {
      const story_id = String(b.story_id || '').trim().toUpperCase();
      const bird = String(b.bird || '').trim().slice(0, 40);
      const text = String(b.text || '').trim().slice(0, 400);
      if (!bird) return json(res, 400, { error: 'a sentence needs a bird' });
      if (!text) return json(res, 400, { error: 'a sentence needs words' });
      const s = db.prepare('SELECT * FROM stories WHERE id=?').get(story_id);
      if (!s) return json(res, 404, { error: 'no such story' });
      db.prepare('INSERT INTO sentences (story_id,bird,text,created) VALUES (?,?,?,?)')
        .run(story_id, bird, text, now());
      db.prepare('INSERT INTO events (story_id,bird,kind,note,created) VALUES (?,?,?,?,?)')
        .run(story_id, bird, 'wrote', text.slice(0, 80), now());
      return json(res, 200, { ok: true, story: storyRow(db.prepare('SELECT * FROM stories WHERE id=?').get(story_id)) });
    });
  }

  if (req.method === 'POST' && route === 'finish') {
    return readBody(req).then(b => {
      const story_id = String(b.story_id || '').trim().toUpperCase();
      const bird = String(b.bird || '').trim().slice(0, 40);
      const s = db.prepare('SELECT * FROM stories WHERE id=?').get(story_id);
      if (!s) return json(res, 404, { error: 'no such story' });
      db.prepare('INSERT INTO events (story_id,bird,kind,note,created) VALUES (?,?,?,?,?)')
        .run(story_id, bird, 'finished', 'called the end', now());
      return json(res, 200, { ok: true, story: storyRow(db.prepare('SELECT * FROM stories WHERE id=?').get(story_id)) });
    });
  }

  return json(res, 404, { error: 'not found' });
};
