import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { cacheService } from './cache.js';
import type { ArticleWithFeed } from '../models/article.js';

const EXPORTS_DIR = join(homedir(), '.rss-cli', 'exports');

// 将字符串转换为安全的文件名
function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')  // 替换非法字符
    .replace(/\s+/g, '_')            // 空格转下划线
    .replace(/_+/g, '_')             // 多个下划线合并
    .replace(/^_|_$/g, '')           // 去除首尾下划线
    .slice(0, 100);                  // 限制长度
}

// 确保目录存在
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export interface ArticleExportData {
  id: number;
  title: string;
  link: string | null;
  pub_date: string | null;
  feed_name: string;
  feed_url: string;
  is_interesting: boolean | null;
  interest_reason: string | null;
  summary: string | null;
  analyzed_at: string | null;
  tags: string[];
  resources: {
    name: string;
    type: string;
    url: string | null;
    github_url: string | null;
    description: string | null;
    tags: string[];
  }[];
}

// 导出单篇文章
function exportArticle(article: ArticleWithFeed): void {
  const feedDir = join(EXPORTS_DIR, sanitizeFileName(article.feed_name));
  const articleDir = join(feedDir, sanitizeFileName(article.title));

  ensureDir(articleDir);

  // 保存快照
  const snapshot = article.text_snapshot || '';
  if (snapshot) {
    writeFileSync(join(articleDir, 'snapshot.txt'), snapshot, 'utf-8');
  }

  // 获取文章标签
  const tags = cacheService.getArticleTags(article.id).map(t => t.name);

  // 获取文章关联的资源
  const resources = getArticleResources(article.id);

  // 构建分析数据
  const analysisData: ArticleExportData = {
    id: article.id,
    title: article.title,
    link: article.link,
    pub_date: article.pub_date,
    feed_name: article.feed_name,
    feed_url: article.feed_url,
    is_interesting: article.is_interesting === 1 ? true : article.is_interesting === 0 ? false : null,
    interest_reason: article.interest_reason,
    summary: article.summary,
    analyzed_at: article.analyzed_at,
    tags,
    resources,
  };

  writeFileSync(
    join(articleDir, 'analysis.json'),
    JSON.stringify(analysisData, null, 2),
    'utf-8'
  );
}

// 获取文章关联的资源
function getArticleResources(articleId: number): ArticleExportData['resources'] {
  const db = require('../db/index.js').getDb();
  const sql = `
    SELECT r.*, ar.context, ar.relevance
    FROM resources r
    JOIN article_resources ar ON r.id = ar.resource_id
    WHERE ar.article_id = ?
  `;
  const rows = db.prepare(sql).all(articleId) as {
    id: number;
    name: string;
    type: string;
    url: string | null;
    github_url: string | null;
    description: string | null;
    tags: string | null;
  }[];

  return rows.map(r => ({
    name: r.name,
    type: r.type,
    url: r.url,
    github_url: r.github_url,
    description: r.description,
    tags: r.tags ? r.tags.split(',') : [],
  }));
}

// 导出指定文章列表
export function exportArticles(articles: ArticleWithFeed[]): number {
  let count = 0;
  for (const article of articles) {
    try {
      exportArticle(article);
      count++;
    } catch (err) {
      console.error(`[Export] Failed to export article ${article.id}: ${(err as Error).message}`);
    }
  }
  return count;
}

// 导出最近更新的文章（用于 update 命令后）
export function exportRecentArticles(days = 7): number {
  const articles = cacheService.getArticles({ days, limit: 500 });
  return exportArticles(articles);
}

// 导出已分析的文章（用于 run 命令后）
export function exportAnalyzedArticles(days = 7): number {
  const articles = cacheService.getArticles({ days, limit: 500 })
    .filter(a => a.analyzed_at !== null);
  return exportArticles(articles);
}

export { EXPORTS_DIR };
