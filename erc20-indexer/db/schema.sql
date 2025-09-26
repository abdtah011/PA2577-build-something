-- db/schema.sql

CREATE TABLE IF NOT EXISTS erc20_transfers (
  block_number     BIGINT       NOT NULL,
  tx_hash          TEXT         NOT NULL,
  log_index        INTEGER      NOT NULL,
  contract         TEXT,
  from_addr        TEXT,
  to_addr          TEXT,
  value_wei        NUMERIC(78),           -- mycket stora tal
  token_symbol     TEXT,
  token_decimals   INTEGER,
  ts               TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (tx_hash, log_index)
);

-- Hjälp-index för snabba sökningar
CREATE INDEX IF NOT EXISTS idx_erc20_x_block ON erc20_transfers (block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS idx_erc20_x_from  ON erc20_transfers (from_addr);
CREATE INDEX IF NOT EXISTS idx_erc20_x_to    ON erc20_transfers (to_addr);
