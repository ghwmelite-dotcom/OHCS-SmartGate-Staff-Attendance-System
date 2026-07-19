/**
 * Tests for the kiosk returning-visitor fast lane (`GET /kiosk/visitor-by-phone`).
 *
 * Runs the REAL lookup statement (VISITOR_BY_PHONE_SQL, imported from kiosk.ts —
 * single source of truth, same pattern as go-live-reset.test.ts) against a real
 * in-memory SQLite DB seeded with the full schema. Covers the two properties the
 * endpoint is privacy-rated on:
 *
 *   1. Normalization: local (`0XXXXXXXXX`) and international (`+233XXXXXXXXX`)
 *      inputs — with or without spaces/dashes/parens — match EITHER stored form.
 *   2. No oracle: unknown numbers, invalid input, and visitors with no COMPLETED
 *      visit all produce the same empty result (the route maps all of these to
 *      the same 404).
 *
 * Uses Node's built-in node:sqlite — no app boot, no new dependency.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeKioskPhone, VISITOR_BY_PHONE_SQL } from './kiosk';

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
}
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

function newDb(): SqliteDb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const db: SqliteDb = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;'); // mirror D1, which forces FKs on
  const schema = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

function addVisitor(db: SqliteDb, id: string, phone: string | null): void {
  db.prepare('INSERT INTO visitors (id, first_name, last_name, phone, organisation) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'Ama', 'Mensah', phone, 'Ghana Cocoa Board');
}

function addVisit(db: SqliteDb, id: string, visitorId: string, status: string): void {
  db.prepare('INSERT INTO visits (id, visitor_id, status) VALUES (?, ?, ?)').run(id, visitorId, status);
}

function lookup(db: SqliteDb, rawPhone: string): Record<string, unknown> | null {
  const forms = normalizeKioskPhone(rawPhone);
  if (!forms) return null; // the route returns the same 404 for invalid input
  const row = db.prepare(VISITOR_BY_PHONE_SQL).get(forms.local, forms.intl);
  return (row ?? null) as Record<string, unknown> | null;
}

describe('normalizeKioskPhone', () => {
  it('accepts the local form and derives both canonical forms', () => {
    expect(normalizeKioskPhone('0241234567')).toEqual({ local: '0241234567', intl: '+233241234567' });
  });

  it('accepts the +233 form and derives the local form', () => {
    expect(normalizeKioskPhone('+233241234567')).toEqual({ local: '0241234567', intl: '+233241234567' });
  });

  it('strips spaces, dashes and parens', () => {
    const expected = { local: '0241234567', intl: '+233241234567' };
    expect(normalizeKioskPhone('024 123 4567')).toEqual(expected);
    expect(normalizeKioskPhone('024-123-4567')).toEqual(expected);
    expect(normalizeKioskPhone('(024) 123 4567')).toEqual(expected);
    expect(normalizeKioskPhone('+233 24 123 4567')).toEqual(expected);
  });

  it('rejects anything that is not a Ghana number', () => {
    expect(normalizeKioskPhone('')).toBeNull();
    expect(normalizeKioskPhone('12345')).toBeNull();          // too short
    expect(normalizeKioskPhone('02412345678')).toBeNull();    // too long
    expect(normalizeKioskPhone('233241234567')).toBeNull();   // missing + or 0 prefix
    expect(normalizeKioskPhone('+14155552671')).toBeNull();   // non-Ghana
    expect(normalizeKioskPhone('not-a-number')).toBeNull();
  });
});

describe('VISITOR_BY_PHONE_SQL', () => {
  it('finds a returning visitor by either input form, whichever form was stored', () => {
    const db = newDb();
    addVisitor(db, 'v_local', '0241234567');   // stored local
    addVisitor(db, 'v_intl', '+233201234567'); // stored international
    addVisit(db, 's1', 'v_local', 'checked_out');
    addVisit(db, 's2', 'v_intl', 'checked_out');

    expect((lookup(db, '024 123 4567') as { id: string }).id).toBe('v_local');
    expect((lookup(db, '+233241234567') as { id: string }).id).toBe('v_local');
    expect((lookup(db, '0201234567') as { id: string }).id).toBe('v_intl');
    expect((lookup(db, '+233 20 123 4567') as { id: string }).id).toBe('v_intl');
  });

  it('returns only the minimal kiosk fields (no phone echo, no history)', () => {
    const db = newDb();
    addVisitor(db, 'v1', '0241234567');
    addVisit(db, 's1', 'v1', 'checked_out');
    const row = lookup(db, '0241234567');
    expect(row).not.toBeNull();
    expect(Object.keys(row!).sort()).toEqual(['first_name', 'id', 'last_name', 'organisation', 'photo_url']);
    expect(row).toMatchObject({ id: 'v1', first_name: 'Ama', last_name: 'Mensah', organisation: 'Ghana Cocoa Board' });
  });

  it('ignores visitors whose visits are all still active (no oracle)', () => {
    const db = newDb();
    addVisitor(db, 'v_active', '0241234567');
    addVisit(db, 's1', 'v_active', 'checked_in');
    expect(lookup(db, '0241234567')).toBeNull();
  });

  it('ignores visitors with only cancelled visits', () => {
    const db = newDb();
    addVisitor(db, 'v_cancel', '0241234567');
    addVisit(db, 's1', 'v_cancel', 'cancelled');
    expect(lookup(db, '0241234567')).toBeNull();
  });

  it('matches once any completed visit exists, even alongside an active one', () => {
    const db = newDb();
    addVisitor(db, 'v1', '0241234567');
    addVisit(db, 's1', 'v1', 'checked_out');
    addVisit(db, 's2', 'v1', 'checked_in');
    expect((lookup(db, '0241234567') as { id: string }).id).toBe('v1');
  });

  it('returns nothing for unknown numbers, registered-but-visitless visitors, and invalid input — identically', () => {
    const db = newDb();
    addVisitor(db, 'v_never', '0241234567'); // registered, never visited
    expect(lookup(db, '0209999999')).toBeNull();  // unknown number
    expect(lookup(db, '0241234567')).toBeNull();  // known number, no completed visit
    expect(lookup(db, 'junk')).toBeNull();        // invalid input
    expect(lookup(db, '')).toBeNull();            // missing input
  });

  it('matches stored numbers that carry spaces or dashes', () => {
    const db = newDb();
    addVisitor(db, 'v_spaced', '024 123 4567');
    addVisit(db, 's1', 'v_spaced', 'checked_out');
    expect((lookup(db, '0241234567') as { id: string }).id).toBe('v_spaced');
    expect((lookup(db, '+233241234567') as { id: string }).id).toBe('v_spaced');
  });
});
