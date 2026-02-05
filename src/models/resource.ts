export type ResourceType = 'tool' | 'library' | 'framework' | 'project' | 'service' | 'other';
export type ResourceRelevance = 'main' | 'mentioned' | 'compared';

export interface Resource {
  id: number;
  name: string;
  type: ResourceType;
  url: string | null;
  github_url: string | null;
  description: string | null;
  tags: string | null;
  first_seen_at: string;
  mention_count: number;
}

export interface ResourceInput {
  name: string;
  type: ResourceType;
  url?: string;
  github_url?: string;
  description?: string;
  tags?: string[];
}

export interface ArticleResource {
  id: number;
  article_id: number;
  resource_id: number;
  context: string | null;
  relevance: ResourceRelevance;
  created_at: string;
}

export interface ArticleResourceInput {
  article_id: number;
  resource_id: number;
  context?: string;
  relevance?: ResourceRelevance;
}

export interface ResourceWithStats extends Resource {
  source_count: number;
  article_count: number;
  tags_array: string[];
}

export interface ExtractedResource {
  name: string;
  type: ResourceType;
  url?: string;
  github_url?: string;
  description?: string;
  tags?: string[];
  relevance: ResourceRelevance;
  context?: string;
}

export interface SummaryWithResources {
  summary: string;
  keyPoints: string[];
  resources: ExtractedResource[];
}
