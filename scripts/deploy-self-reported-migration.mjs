import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ACCOUNT = 'f4f236a6cd8fbddf397c6e9de17d8113';
const DATABASE = '051e7d97-6909-426b-9574-331edf1ef351';
const FILENAME = 'migration-clock-self-reported.sql';
const ALTER = 'ALTER TABLE clock_records ADD COLUMN reported_departure_at TEXT;';

// This is deliberately NOT a general migration runner. Only the additive
// migration approved for this release can execute with the deployment token.
export async function applyApprovedMigration(query, source) {
  const sql = source.replaceAll('\r\n', '\n');
  if (sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim() !== ALTER) {
    throw new Error('Approved migration SQL changed; refusing deployment');
  }
  const hash = createHash('sha256').update(sql).digest('hex');
  const columns = () => query("SELECT name,type,\"notnull\",dflt_value FROM pragma_table_info('clock_records') WHERE name='reported_departure_at'");
  const ledger = () => query('SELECT hash FROM applied_migrations WHERE filename = ?', [FILENAME]);
  const [existingColumn, existingLedger] = await Promise.all([columns(), ledger()]);
  if (existingLedger.length && existingLedger[0].hash !== hash) throw new Error('Migration ledger hash mismatch');
  const compatible = rows => rows.length === 1 && rows[0].type.toUpperCase() === 'TEXT' && rows[0].notnull === 0 && rows[0].dflt_value === null;
  if (existingColumn.length && !compatible(existingColumn)) throw new Error('Existing departure column differs from approved schema');
  if (existingLedger.length && !existingColumn.length) throw new Error('Migration ledger exists but column is missing');
  if (!existingColumn.length) await query(ALTER);
  if (!compatible(await columns())) throw new Error('Post-migration schema verification failed');
  // Repair the ledger after an interrupted run only when the column is exact.
  if (!existingLedger.length) await query('INSERT INTO applied_migrations (filename, hash) VALUES (?, ?)', [FILENAME, hash]);
  if ((await ledger())[0]?.hash !== hash) throw new Error('Post-migration ledger verification failed');
  return { filename: FILENAME, hash, status: existingLedger.length ? 'already-applied' : 'applied-and-verified' };
}

async function main() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID !== ACCOUNT || !process.env.CLOUDFLARE_API_TOKEN) throw new Error('Production account/token not configured');
  const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}`;
  async function request(suffix = '', body) {
    const response = await fetch(base + suffix, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60000),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(`Cloudflare request failed (HTTP ${response.status}; codes ${(data.errors ?? []).map(e => e.code).join(',')})`);
    return data.result;
  }
  const metadata = await request();
  if (metadata.name !== 'smartgate-db') throw new Error('Unexpected production database name');
  const query = async (sql, params = []) => {
    const result = await request('/query', { sql, params });
    if (!Array.isArray(result) || result.length !== 1 || !result[0].success) throw new Error('D1 statement did not succeed');
    return result[0].results;
  };
  const source = await readFile(new URL(`../packages/api/src/db/${FILENAME}`, import.meta.url), 'utf8');
  console.log(JSON.stringify(await applyApprovedMigration(query, source)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
