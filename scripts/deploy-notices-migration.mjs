import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ACCOUNT = 'f4f236a6cd8fbddf397c6e9de17d8113';
const DATABASE = '051e7d97-6909-426b-9574-331edf1ef351';
const FILENAME = 'migration-notices-hub.sql';
const EXPECTED_HASH = 'ac885472a8ef54b96a1285e53e260cab45c516de7a9e4815c37539fc20168327';
const OBJECTS = ['notice_register','notice_revisions','idx_notice_register_scope','idx_notice_register_owner','idx_notice_revisions_notice','notice_register_insert','notice_register_update','notice_register_withdraw','notice_register_ack'];

// Release-specific migration only. Production approval is a separate, explicit gate.
export async function applyNoticesMigration(query, source, approved = false) {
  if (!approved) throw new Error('Production notices migration requires explicit approval');
  const sql = source.replaceAll('\r\n', '\n');
  const hash = createHash('sha256').update(sql).digest('hex');
  if (hash !== EXPECTED_HASH) throw new Error('Reviewed notices migration changed; refusing deployment');
  const ledger = await query('SELECT hash FROM applied_migrations WHERE filename = ?', [FILENAME]);
  if (ledger.length && ledger[0].hash !== hash) throw new Error('Migration ledger hash mismatch');
  if (!ledger.length) {
    const statements = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
    for (const statement of statements) await query(statement);
  }
  const objects = await query("SELECT name FROM sqlite_master WHERE name IN ('notice_register','notice_revisions','idx_notice_register_scope','idx_notice_register_owner','idx_notice_revisions_notice','notice_register_insert','notice_register_update','notice_register_withdraw','notice_register_ack')");
  if (OBJECTS.some(name => !objects.some(row => row.name === name))) throw new Error('Notices migration objects missing');
  const missing = await query('SELECT COUNT(*) AS count FROM absence_notices a WHERE NOT EXISTS (SELECT 1 FROM notice_register n WHERE n.id=a.id)');
  if (missing[0]?.count !== 0) throw new Error('Active notices missing from retained register');
  if (!ledger.length) await query('INSERT INTO applied_migrations (filename, hash) VALUES (?, ?)', [FILENAME, hash]);
  return { filename: FILENAME, hash, status: ledger.length ? 'already-applied' : 'applied-and-verified' };
}

async function main() {
  if (process.env.NOTICES_HUB_MIGRATION_APPROVED !== 'true') throw new Error('Production notices migration requires explicit approval');
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
  console.log(JSON.stringify(await applyNoticesMigration(query, source, process.env.NOTICES_HUB_MIGRATION_APPROVED === 'true')));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
