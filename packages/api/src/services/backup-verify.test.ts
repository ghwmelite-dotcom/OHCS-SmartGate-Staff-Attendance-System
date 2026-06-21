import { describe, it, expect } from 'vitest';
import { verifyLatestBackup, getLatestBackupDate, BACKUP_TABLES } from './backup';
import { encryptText } from './backup-crypto';
import type { Env } from '../types';

const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));

// Minimal in-memory R2 supporting the subset verifyLatestBackup/getLatestBackupDate use.
class MockR2 {
  store = new Map<string, string>();
  async put(key: string, value: string) { this.store.set(key, value); }
  async get(key: string) {
    const v = this.store.get(key);
    return v === undefined ? null : { text: async () => v };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async list({ prefix, delimiter }: { prefix: string; delimiter?: string; cursor?: string }): Promise<any> {
    const keys = [...this.store.keys()].filter((k) => k.startsWith(prefix));
    if (delimiter) {
      const prefixes = new Set<string>();
      for (const k of keys) {
        const rest = k.slice(prefix.length);
        const idx = rest.indexOf(delimiter);
        if (idx >= 0) prefixes.add(prefix + rest.slice(0, idx + 1));
      }
      return { objects: [], delimitedPrefixes: [...prefixes], truncated: false };
    }
    return { objects: keys.map((k) => ({ key: k })), truncated: false };
  }
}

function envWith(r2: MockR2, key: string | undefined = KEY): Env {
  return { STORAGE: r2, BACKUP_ENCRYPTION_KEY: key } as unknown as Env;
}

// Write a full, valid (optionally encrypted) backup for `date`, `rowsPerTable` empty-or-N rows.
async function writeFullBackup(r2: MockR2, date: string, rowsPerTable = 0, key: string | undefined = KEY) {
  for (const t of BACKUP_TABLES) {
    const rows = Array.from({ length: rowsPerTable }, (_, i) => ({ id: `${t}-${i}` }));
    await r2.put(`backups/${date}/${t}.json`, await encryptText(JSON.stringify(rows), key));
  }
}

describe('verifyLatestBackup', () => {
  it('a full encrypted backup verifies ok with correct row totals', async () => {
    const r2 = new MockR2();
    await writeFullBackup(r2, '2026-06-21', 2);
    const v = await verifyLatestBackup(envWith(r2));
    expect(v.date).toBe('2026-06-21');
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
    expect(v.totalRows).toBe(BACKUP_TABLES.length * 2);
  });

  it('picks the most recent date when several backups exist', async () => {
    const r2 = new MockR2();
    await writeFullBackup(r2, '2026-06-19', 1);
    await writeFullBackup(r2, '2026-06-21', 1);
    await writeFullBackup(r2, '2026-06-20', 1);
    expect(await getLatestBackupDate(envWith(r2))).toBe('2026-06-21');
  });

  it('flags a missing table as not ok', async () => {
    const r2 = new MockR2();
    await writeFullBackup(r2, '2026-06-21', 1);
    r2.store.delete('backups/2026-06-21/users.json');
    const v = await verifyLatestBackup(envWith(r2));
    expect(v.ok).toBe(false);
    expect(v.missing).toContain('users');
  });

  it('flags a corrupt / unparseable table as not ok', async () => {
    const r2 = new MockR2();
    await writeFullBackup(r2, '2026-06-21', 1);
    r2.store.set('backups/2026-06-21/visits.json', 'not-json-at-all');
    const v = await verifyLatestBackup(envWith(r2));
    expect(v.ok).toBe(false);
    expect(v.tables.find((t) => t.name === 'visits')!.ok).toBe(false);
  });

  it('verifies a legacy plaintext backup (no key configured)', async () => {
    const r2 = new MockR2();
    await writeFullBackup(r2, '2026-06-21', 1, undefined); // plaintext arrays
    const v = await verifyLatestBackup(envWith(r2, undefined));
    expect(v.ok).toBe(true);
  });

  it('reports not ok when there are no backups at all', async () => {
    const v = await verifyLatestBackup(envWith(new MockR2()));
    expect(v.date).toBeNull();
    expect(v.ok).toBe(false);
    expect(v.missing.length).toBe(BACKUP_TABLES.length);
  });
});
