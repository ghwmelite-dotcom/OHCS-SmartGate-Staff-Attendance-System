import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { applyNoticesMigration } from './deploy-notices-migration.mjs';
const source = await readFile(new URL('../packages/api/src/db/migration-notices-hub.sql', import.meta.url), 'utf8');
function fixture() {
 const db = new DatabaseSync(':memory:');
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,directorate_id TEXT);
 CREATE TABLE directorates(id TEXT PRIMARY KEY);
 CREATE TABLE absence_notices(id TEXT PRIMARY KEY,user_id TEXT,reason TEXT,note TEXT,notice_date TEXT,expected_return_date TEXT,created_at TEXT);
 CREATE TABLE applied_migrations(filename TEXT PRIMARY KEY, hash TEXT);
 INSERT INTO directorates VALUES ('d'); INSERT INTO users VALUES ('u','d');
 INSERT INTO absence_notices VALUES ('n','u','sick','Unwell','2026-11-23','2026-11-24','2026-11-23T08:00:00Z');`);
 return {db,query:async(sql,params=[])=>db.prepare(sql).all(...params)};
}
test('refuses to access the database without explicit approval or with changed SQL', async()=>{
 let called=false;const query=async()=>{called=true;return []};
 await assert.rejects(applyNoticesMigration(query,source),/approval/);
 await assert.rejects(applyNoticesMigration(query,source+'\nDELETE FROM users;',true),/changed/);
 assert.equal(called,false);
});
test('applies only the reviewed migration, retains active notices and safely reruns',async()=>{
 const {db,query}=fixture();
 assert.equal((await applyNoticesMigration(query,source,true)).status,'applied-and-verified');
 assert.equal((await applyNoticesMigration(query,source,true)).status,'already-applied');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM absence_notices').get().n,1);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM notice_register').get().n,1);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM notice_revisions').get().n,1);
});
test('resumes partial migration without duplicating history',async()=>{
 const {db,query}=fixture();let calls=0;
 await assert.rejects(applyNoticesMigration(async(sql,p)=>{if(++calls===11)throw Error('interrupted');return query(sql,p)},source,true),/interrupted/);
 await applyNoticesMigration(query,source,true);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM notice_revisions').get().n,1);
});
test('fails closed for mismatched ledger and missing capture trigger',async()=>{
 const {db,query}=fixture();await applyNoticesMigration(query,source,true);
 db.exec('DROP TRIGGER notice_register_insert');
 await assert.rejects(applyNoticesMigration(query,source,true),/objects missing/);
 db.exec("UPDATE applied_migrations SET hash='wrong'");
 await assert.rejects(applyNoticesMigration(query,source,true),/hash mismatch/);
});
