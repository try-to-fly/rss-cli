import { getDb } from '../db/index.js';
import type { Config } from '../models/config.js';

export function getConfig(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as Config | undefined;
  return row?.value ?? null;
}

export function setConfig(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export function deleteConfig(key: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM config WHERE key = ?').run(key);
  return result.changes > 0;
}

export function getAllConfig(): Config[] {
  const db = getDb();
  return db.prepare('SELECT key, value FROM config ORDER BY key').all() as Config[];
}
