export interface Article {
  id: number;
  feed_id: number;
  guid: string;
  title: string;
  link: string | null;
  content: string | null;
  pub_date: string | null;
  is_read: number;
  is_interesting: number | null;
  interest_reason: string | null;
  summary: string | null;
  analyzed_at: string | null;
  created_at: string;
}

export interface ArticleInput {
  feed_id: number;
  guid: string;
  title: string;
  link?: string;
  content?: string;
  pub_date?: string;
}

export interface ArticleWithFeed extends Article {
  feed_name: string;
  feed_url: string;
}
