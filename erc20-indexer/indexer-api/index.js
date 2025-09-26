import 'dotenv/config';
import express from 'express';
import pkg from 'pg';
const { Pool } = pkg;

const {
  PGHOST='postgres', PGPORT=5432, PGDATABASE='appdb', PGUSER='app', PGPASSWORD='secret',
  PORT=3000
} = process.env;

const pool = new Pool({ host: PGHOST, port: PGPORT, database: PGDATABASE, user: PGUSER, password: PGPASSWORD });
const app = express();
app.use(express.static('public'));

app.get('/health', (_, res) => res.json({ ok: true }));

// GET /events?address=0x...&limit=100
app.get('/events', async (req, res) => {
  const { address, limit = 100 } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });
  const q = `
    SELECT block_number, tx_hash, log_index, contract, from_addr, to_addr, value_wei, token_symbol, token_decimals, ts
    FROM erc20_transfers
    WHERE from_addr = $1 OR to_addr = $1
    ORDER BY block_number DESC, log_index DESC
    LIMIT $2
  `;
  const { rows } = await pool.query(q, [address.toLowerCase(), Number(limit)]);
  res.json(rows);
});

// GET /events/all?limit=100&offset=0
app.get('/events/all', async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const q = `
    SELECT block_number, tx_hash, log_index, contract, from_addr, to_addr,
           value_wei, token_symbol, token_decimals, ts
    FROM erc20_transfers
    ORDER BY block_number DESC, log_index DESC
    LIMIT $1 OFFSET $2
  `;
  const { rows } = await pool.query(q, [limit, offset]);
  res.json(rows);
});

app.get('/events/count', async (_, res) => {
  const { rows } = await pool.query('SELECT COUNT(*)::bigint AS c FROM erc20_transfers');
  res.json({ count: rows[0].c });
});

// GET /stats/address/0x...
app.get('/stats/address/:addr', async (req, res) => {
  const addr = req.params.addr.toLowerCase();
  const sentQ = `SELECT COALESCE(SUM(value_wei),0) s FROM erc20_transfers WHERE from_addr=$1`;
  const recvQ = `SELECT COALESCE(SUM(value_wei),0) r FROM erc20_transfers WHERE to_addr=$1`;
  const sent = (await pool.query(sentQ,[addr])).rows[0].s;
  const recv = (await pool.query(recvQ,[addr])).rows[0].r;
  res.json({ address: addr, total_sent_wei: sent, total_received_wei: recv });
});

app.listen(PORT, () => console.log(`indexer-api on :${PORT}`));
