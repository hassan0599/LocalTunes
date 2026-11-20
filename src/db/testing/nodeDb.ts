/// <reference types="node" />
/**
 * Test helper: an in-memory node:sqlite database exposing the subset of expo-sqlite's
 * async API that the app uses, so migrations and queries run against real SQLite + FTS5.
 * Requires Node 22.5+ (node:sqlite).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export function openTestDb(): SQLiteDatabase & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const db = {
    raw,
    async execAsync(sql: string) {
      raw.exec(sql);
    },
    async getFirstAsync(sql: string, ...params: SQLInputValue[]) {
      return raw.prepare(sql).get(...params) ?? null;
    },
    async getAllAsync(sql: string, ...params: SQLInputValue[]) {
      return raw.prepare(sql).all(...params);
    },
    async runAsync(sql: string, ...params: SQLInputValue[]) {
      const r = raw.prepare(sql).run(...params);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    async withTransactionAsync(fn: () => Promise<void>) {
      raw.exec('BEGIN');
      try {
        await fn();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return db as unknown as SQLiteDatabase & { raw: DatabaseSync };
}
