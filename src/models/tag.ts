export type TagCategory = 'tech' | 'topic' | 'language' | 'framework' | 'other';
export type TagSource = 'llm' | 'manual' | 'auto';

export interface Tag {
  id: number;
  name: string;
  category: TagCategory | null;
  color: string | null;
  created_at: string;
}

export interface TagInput {
  name: string;
  category?: TagCategory;
  color?: string;
}

export interface ArticleTag {
  id: number;
  article_id: number;
  tag_id: number;
  source: TagSource;
  confidence: number;
  created_at: string;
}

export interface ArticleTagInput {
  article_id: number;
  tag_id: number;
  source?: TagSource;
  confidence?: number;
}

export interface ResourceTag {
  id: number;
  resource_id: number;
  tag_id: number;
  created_at: string;
}

export interface TagWithCount extends Tag {
  article_count: number;
  resource_count: number;
}
