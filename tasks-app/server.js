const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  host: process.env.DB_HOST,
  port: +(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'appdb',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  // RDS Postgres 15+ enforces SSL by default. Set DB_SSL=false for local dev.
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 10,
  connectionTimeoutMillis: 5000,
});

let meta;
async function getMeta() {
  if (meta) return meta;
  try {
    const base = 'http://169.254.169.254/latest';
    const token = await fetch(`${base}/api/token`, {
      method: 'PUT',
      headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '60' },
      signal: AbortSignal.timeout(1000),
    }).then((r) => r.text());
    const get = (p) =>
      fetch(`${base}/meta-data/${p}`, {
        headers: { 'X-aws-ec2-metadata-token': token },
        signal: AbortSignal.timeout(1000),
      }).then((r) => r.text());
    meta = {
      instanceId: await get('instance-id'),
      az: await get('placement/availability-zone'),
    };
  } catch {
    meta = { instanceId: 'local', az: 'local' };
  }
  return meta;
}

const h = (fn) => (req, res, next) => fn(req, res).catch(next);

app.param('id', (req, res, next, id) =>
  /^\d+$/.test(id) ? next() : res.status(400).json({ error: 'invalid id' })
);

// Shallow health check on purpose: a DB blip should not make the ALB
// mark every instance unhealthy and trigger replacements.
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/info', h(async (req, res) => res.json(await getMeta())));

app.get('/api/tasks', h(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM tasks ORDER BY id DESC');
  res.json(rows);
}));

app.post('/api/tasks', h(async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 200);
  if (!title) return res.status(400).json({ error: 'title is required' });
  const { rows } = await pool.query(
    'INSERT INTO tasks (title) VALUES ($1) RETURNING *',
    [title]
  );
  res.status(201).json(rows[0]);
}));

app.put('/api/tasks/:id', h(async (req, res) => {
  const { title, done } = req.body;
  const { rows } = await pool.query(
    'UPDATE tasks SET title = COALESCE($1, title), done = COALESCE($2, done) WHERE id = $3 RETURNING *',
    [title ? String(title).trim().slice(0, 200) : null, typeof done === 'boolean' ? done : null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
}));

app.delete('/api/tasks/:id', h(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

// Retry loop covers RDS still starting and several instances
// racing to create the table at the same time.
async function initDb(retries = 10) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        done BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      console.log('Database ready');
      return;
    } catch (e) {
      console.error(`DB init attempt ${i} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.error('Database still unavailable; API calls will fail until it recovers');
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening on ${PORT}`);
  initDb();
});
