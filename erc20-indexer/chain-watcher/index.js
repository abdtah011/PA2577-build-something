import 'dotenv/config';
import axios from 'axios';
import pkg from 'pg';
const { Pool } = pkg;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS || 10000);
const POLL_DELAY_MS = Number(process.env.POLL_DELAY_MS || 86400000); // default: 24h
const PLACEHOLDER_DELAY_MS = Number(process.env.PLACEHOLDER_DELAY_MS || RETRY_DELAY_MS);
const RUN_ONCE = /^true$/i.test(process.env.RUN_ONCE || '');
const RUN_ONCE_SLEEP_MS = Number(process.env.RUN_ONCE_SLEEP_MS || POLL_DELAY_MS || 86400000);
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 2000);
const isPlaceholderKey = (key) => !key || /^(?:PUT_|YourApiKeyToken)/i.test(key);
const isPlaceholderAddress = (addr) => !addr || /^0xYourEthereumAddress$/i.test(addr);

const {
  ETHERSCAN_API_KEY,
  WATCH_ADDRESS,
  ETHERSCAN_BASE_URL = 'https://api.etherscan.io',
  ETHERSCAN_CHAIN_ID,
  ETH_CHAIN_ID,
  PGHOST = 'postgres',
  PGPORT = 5432,
  PGDATABASE = 'appdb',
  PGUSER = 'app',
  PGPASSWORD = 'secret'
} = process.env;

const chainId = (ETHERSCAN_CHAIN_ID || ETH_CHAIN_ID || '1').toString();
const etherscanBase = `${ETHERSCAN_BASE_URL.replace(/\/$/, '')}/v2/api`;

const pool = new Pool({ host: PGHOST, port: PGPORT, database: PGDATABASE, user: PGUSER, password: PGPASSWORD });

async function getStartingBlock() {
  const res = await pool.query('SELECT COALESCE(MAX(block_number), -1) AS max_block FROM erc20_transfers');
  const raw = res.rows[0]?.max_block ?? '-1';
  try {
    const start = BigInt(raw) + 1n;
    return start < 0n ? 0n : start;
  } catch {
    return 0n;
  }
}

async function upsert(t) {
  const q = `
    INSERT INTO erc20_transfers
      (block_number, tx_hash, log_index, contract, from_addr, to_addr, value_wei, token_symbol, token_decimals, ts)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, to_timestamp($10))
    ON CONFLICT (tx_hash, log_index) DO NOTHING;
  `;
  const vals = [
    BigInt(t.blockNumber), t.hash, Number(t.logIndex || 0),
    (t.contractAddress||'').toLowerCase(),
    (t.from||'').toLowerCase(), (t.to||'').toLowerCase(),
    t.value, t.tokenSymbol || null, Number(t.tokenDecimal || 0),
    Number(t.timeStamp || 0)
  ];
  await pool.query(q, vals);
}

async function fetchTransfersByAddress(addr, startBlock, endBlock) {
  // Etherscan endpoint: 'ERC20 - Token Transfer Events by Address'
  // docs: https://docs.etherscan.io/api-endpoints/accounts#get-a-list-of-erc20-token-transfer-events-by-address
  const url = `${etherscanBase}?chainid=${chainId}&module=account&action=tokentx&address=${addr}&startblock=${startBlock}&endblock=${endBlock}&page=1&offset=10000&sort=asc&apikey=${ETHERSCAN_API_KEY}`;
  const { data } = await axios.get(url, { timeout: 20000 });
  if (data.status === "1" || data.message === "No transactions found") {
    return data.result || [];
  }

  const detail = typeof data.result === 'string' && data.result.length > 0
    ? data.result
    : '';
  throw new Error(`Etherscan error: ${data.message}${detail ? ` (${detail})` : ''}`);
}

async function runCycle() {
  let from = await getStartingBlock();
  let processed = 0;
  let attempt = 0;

  while (true) {
    if (attempt > 0 && REQUEST_DELAY_MS > 0) {
      await sleep(REQUEST_DELAY_MS);
    }
    const rows = await fetchTransfersByAddress(WATCH_ADDRESS, from.toString(), '99999999');
    attempt += 1;
    if (!rows.length) {
      return processed;
    }

    for (const r of rows) {
      await upsert(r);
      processed += 1;
    }

    const lastBlock = rows[rows.length - 1]?.blockNumber;
    if (!lastBlock) {
      return processed;
    }

    try {
      from = BigInt(lastBlock) + 1n;
    } catch {
      return processed;
    }
  }
}

async function main() {
  while (true) {
    if (isPlaceholderKey(ETHERSCAN_API_KEY) || isPlaceholderAddress(WATCH_ADDRESS)) {
      console.warn('[watcher] Waiting for valid ETHERSCAN_API_KEY and WATCH_ADDRESS');
      await sleep(PLACEHOLDER_DELAY_MS);
      continue;
    }

    try {
      const processed = await runCycle();
      if (RUN_ONCE) {
        console.info(`[watcher] Completed single run (processed ${processed} transfers); entering dormant state`);
        await sleep(RUN_ONCE_SLEEP_MS);
        continue;
      }
      console.info(`[watcher] Cycle finished; processed ${processed} transfers. Sleeping ${POLL_DELAY_MS}ms`);
      await sleep(POLL_DELAY_MS);
    } catch (err) {
      console.error(`[watcher] ${err.message}`);
      await sleep(RETRY_DELAY_MS);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
