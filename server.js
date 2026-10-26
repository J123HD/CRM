const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'crm.db');

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'note',
    body TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS notes_account ON notes(account_id, occurred_at);
`);

const NOTE_KINDS = ['call', 'email', 'meeting', 'visit', 'note'];
const ACCOUNT_FIELDS = ['name', 'address', 'phone', 'email'];

function cleanAccount(body) {
  const out = {};
  for (const f of ACCOUNT_FIELDS) out[f] = String(body?.[f] ?? '').trim();
  if (!out.name) return { error: 'Business name is required' };
  return { account: out };
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Accounts, with the most recent touch point for the list view
app.get('/api/accounts', (req, res) => {
  const q = `%${String(req.query.q ?? '').trim()}%`;
  const rows = db.prepare(`
    SELECT a.*, MAX(n.occurred_at) AS last_touch, COUNT(n.id) AS note_count
    FROM accounts a LEFT JOIN notes n ON n.account_id = a.id
    WHERE a.name LIKE ? OR a.email LIKE ? OR a.phone LIKE ? OR a.address LIKE ?
    GROUP BY a.id
    ORDER BY a.name COLLATE NOCASE
  `).all(q, q, q, q);
  res.json(rows);
});

app.post('/api/accounts', (req, res) => {
  const { account, error } = cleanAccount(req.body);
  if (error) return res.status(400).json({ error });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO accounts (name, address, phone, email) VALUES (?, ?, ?, ?)')
    .run(account.name, account.address, account.phone, account.email);
  res.status(201).json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(lastInsertRowid));
});

app.get('/api/accounts/:id', (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  account.notes = db
    .prepare('SELECT * FROM notes WHERE account_id = ? ORDER BY occurred_at DESC, id DESC')
    .all(req.params.id);
  res.json(account);
});

app.put('/api/accounts/:id', (req, res) => {
  const { account, error } = cleanAccount(req.body);
  if (error) return res.status(400).json({ error });
  const { changes } = db
    .prepare('UPDATE accounts SET name = ?, address = ?, phone = ?, email = ? WHERE id = ?')
    .run(account.name, account.address, account.phone, account.email, req.params.id);
  if (!changes) return res.status(404).json({ error: 'Account not found' });
  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id));
});

app.delete('/api/accounts/:id', (req, res) => {
  const { changes } = db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  if (!changes) return res.status(404).json({ error: 'Account not found' });
  res.status(204).end();
});

// Notes feed: one entry per sales touch point
app.post('/api/accounts/:id/notes', (req, res) => {
  if (!db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Account not found' });
  }
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'Note text is required' });
  const kind = NOTE_KINDS.includes(req.body?.kind) ? req.body.kind : 'note';
  const when = req.body?.occurred_at ? new Date(req.body.occurred_at) : new Date();
  if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'Invalid date' });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO notes (account_id, kind, body, occurred_at) VALUES (?, ?, ?, ?)')
    .run(req.params.id, kind, body, when.toISOString());
  res.status(201).json(db.prepare('SELECT * FROM notes WHERE id = ?').get(lastInsertRowid));
});

app.delete('/api/notes/:id', (req, res) => {
  const { changes } = db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  if (!changes) return res.status(404).json({ error: 'Note not found' });
  res.status(204).end();
});

app.listen(PORT, () => console.log(`CRM running at http://localhost:${PORT}`));
