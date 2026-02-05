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
  LLM_API_KEY: 'llm_api_key',
  LLM_BASE_URL: 'llm_base_url',
  LLM_MODEL: 'llm_model',
  PROXY_URL: 'proxy_url',
} as const;
