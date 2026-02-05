export interface Config {
  key: string;
  value: string;
}

export interface UserPreference {
  id: number;
  type: 'interest' | 'ignore';
  keyword: string;
  weight: number;
  created_at: string;
}

export const CONFIG_KEYS = {
  OPENAI_API_KEY: 'openai_api_key',
  OPENAI_API_BASE: 'openai_api_base',
  LLM_MODEL: 'llm_model',
  PROXY_URL: 'proxy_url',
} as const;
