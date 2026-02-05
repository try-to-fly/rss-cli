import { getDb } from '../db/index.js';
import type { Config } from '../models/config.js';

// Map config keys to environment variable names
const ENV_KEY_MAP: Record<string, string> = {
  llm_api_key: 'LLM_API_KEY',
  llm_base_url: 'LLM_BASE_URL',
  llm_model: 'LLM_MODEL',
  proxy_url: 'PROXY_URL',
};

export function getConfig(key: string): string | null {
  // Priority: env > db
  const envKey = ENV_KEY_MAP[key];
  if (envKey && process.env[envKey]) {
    return process.env[envKey]!;
  }

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
