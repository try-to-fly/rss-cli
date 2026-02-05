import { getSqlite } from '../db/index.js';
import type { Config } from '../models/config.js';

// Map config keys to environment variable names
const ENV_KEY_MAP: Record<string, string> = {
  openai_api_key: 'OPENAI_API_KEY',
  openai_api_base: 'OPENAI_API_BASE',
  llm_model: 'LLM_MODEL',
  proxy_url: 'PROXY_URL',
};

export function getConfig(key: string): string | null {
  // Priority: env > db
  const envKey = ENV_KEY_MAP[key];
  if (envKey && process.env[envKey]) {
    return process.env[envKey]!;
  }

  const sqlite = getSqlite();
  const row = sqlite.prepare('SELECT value FROM config WHERE key = ?').get(key) as Config | undefined;
  return row?.value ?? null;
}

export function setConfig(key: string, value: string): void {
  const sqlite = getSqlite();
  sqlite.prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export function deleteConfig(key: string): boolean {
  const sqlite = getSqlite();
  const result = sqlite.prepare('DELETE FROM config WHERE key = ?').run(key);
  return result.changes > 0;
}

export function getAllConfig(): Config[] {
  const sqlite = getSqlite();
  return sqlite.prepare('SELECT key, value FROM config ORDER BY key').all() as Config[];
}
