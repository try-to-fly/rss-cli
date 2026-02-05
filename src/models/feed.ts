export interface Feed {
  id: number;
  name: string;
  url: string;
  category: string | null;
  proxy_mode: 'auto' | 'direct' | 'proxy';
  proxy_success_count: number;
  direct_success_count: number;
  last_fetched_at: string | null;
  created_at: string;
}

export interface FeedInput {
  name: string;
  url: string;
  category?: string;
  proxy_mode?: 'auto' | 'direct' | 'proxy';
}
