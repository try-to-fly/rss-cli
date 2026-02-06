import { getSqlite } from '../db/index.js';
import type { Config } from '../models/config.js';

// Map config keys to environment variable names
const ENV_KEY_MAP: Record<string, string> = {
  openai_api_key: 'OPENAI_API_KEY',
  openai_api_base: 'OPENAI_API_BASE',
  llm_model: 'LLM_MODEL',
  proxy_url: 'PROXY_URL',
};

// Default values for config keys
const DEFAULT_VALUES: Record<string, string> = {
  llm_model: 'gpt-5.2',
  proxy_url: 'http://127.0.0.1:7890',
};

export function getConfig(key: string): string | null {
  // Priority: env > db > default
  const envKey = ENV_KEY_MAP[key];
  if (envKey && process.env[envKey]) {
    return process.env[envKey]!;
  }

  const sqlite = getSqlite();
  const row = sqlite.prepare('SELECT value FROM config WHERE key = ?').get(key) as Config | undefined;
  if (row?.value) {
    return row.value;
  }

  // Return default value if available
  return DEFAULT_VALUES[key] ?? null;
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
