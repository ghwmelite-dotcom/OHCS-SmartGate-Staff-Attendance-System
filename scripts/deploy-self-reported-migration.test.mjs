import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { applyApprovedMigration } from './deploy-self-reported-migration.mjs';

const source = await readFile(new URL('../packages/api/src/db/migration-clock-self-reported.sql', import.meta.url), 'utf8');
function fixture(extra = '') {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE clock_records (id TEXT PRIMARY KEY, timestamp TEXT ${extra});
    INSERT INTO clock_records (id,timestamp) VALUES ('existing','2026-10-02T08:00:00Z');
    CREATE TABLE applied_migrations (filename TEXT PRIMARY KEY, hash TEXT);`);
  const query = async (sql, params = []) => db.prepare(sql).all(...params);
  return { db, query };
}
test('applies exact migration, retains attendance and safely reruns', async () => {
  const { db, query } = fixture();
  assert.equal((await applyApprovedMigration(query, source)).status, 'applied-and-verified');
  assert.equal((await applyApprovedMigration(query, source)).status, 'already-applied');
  assert.deepEqual({ ...db.prepare('SELECT * FROM clock_records').get() }, { id: 'existing', timestamp: '2026-10-02T08:00:00Z', reported_departure_at: null });
});
test('repairs interruption between column addition and ledger insertion', async () => {
  const { query } = fixture(', reported_departure_at TEXT');
  assert.equal((await applyApprovedMigration(query, source)).status, 'applied-and-verified');
});
test('refuses unexpected schema, modified migration and ledger mismatch', async () => {
  const wrongSchema = fixture(', reported_departure_at INTEGER');
  await assert.rejects(applyApprovedMigration(wrongSchema.query, source), /differs/);
  const { db, query } = fixture();
  await assert.rejects(applyApprovedMigration(query, source + '\nDELETE FROM clock_records;'), /SQL changed/);
  db.prepare('INSERT INTO applied_migrations VALUES (?,?)').run('migration-clock-self-reported.sql', 'wrong');
  await assert.rejects(applyApprovedMigration(query, source), /hash mismatch/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM clock_records').get().n, 1);
});
