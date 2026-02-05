import { getDb } from '../db/index.js';
import type { Feed, FeedInput } from '../models/feed.js';
import type { Article, ArticleInput, ArticleWithFeed, ArticleWithTags } from '../models/article.js';
import type { UserPreference } from '../models/config.js';
import type {
  Resource,
  ResourceInput,
  ArticleResourceInput,
  ResourceWithStats,
} from '../models/resource.js';
import type {
  Tag,
  TagInput,
  ArticleTagInput,
  TagWithCount,
  TagSource,
} from '../models/tag.js';

export class CacheService {
  // Feed operations
  addFeed(input: FeedInput): Feed {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO feeds (name, url, category, proxy_mode)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(
      input.name,
      input.url,
      input.category ?? null,
      input.proxy_mode ?? 'auto'
    );
    return this.getFeedById(result.lastInsertRowid as number)!;
  }

  getFeedById(id: number): Feed | null {
    const db = getDb();
    return db.prepare('SELECT * FROM feeds WHERE id = ?').get(id) as Feed | undefined ?? null;
  }

  getFeedByUrl(url: string): Feed | null {
    const db = getDb();
    return db.prepare('SELECT * FROM feeds WHERE url = ?').get(url) as Feed | undefined ?? null;
  }

  getAllFeeds(category?: string): Feed[] {
    const db = getDb();
    if (category) {
      return db.prepare('SELECT * FROM feeds WHERE category = ? ORDER BY id').all(category) as Feed[];
    }
    return db.prepare('SELECT * FROM feeds ORDER BY id').all() as Feed[];
  }

  removeFeed(idOrUrl: string): boolean {
    const db = getDb();
    const isNumeric = /^\d+$/.test(idOrUrl);
    let result;
    if (isNumeric) {
      result = db.prepare('DELETE FROM feeds WHERE id = ?').run(parseInt(idOrUrl, 10));
    } else {
      result = db.prepare('DELETE FROM feeds WHERE url = ?').run(idOrUrl);
    }
    return result.changes > 0;
  }

  updateFeedFetchTime(feedId: number): void {
    const db = getDb();
    db.prepare('UPDATE feeds SET last_fetched_at = datetime("now") WHERE id = ?').run(feedId);
  }

  updateFeedProxyStats(feedId: number, mode: 'direct' | 'proxy', success: boolean): void {
    const db = getDb();
    const field = mode === 'direct' ? 'direct_success_count' : 'proxy_success_count';
    if (success) {
      db.prepare(`UPDATE feeds SET ${field} = ${field} + 1 WHERE id = ?`).run(feedId);
    }
  }

  // Article operations
  addArticle(input: ArticleInput): Article | null {
    const db = getDb();
    try {
      const stmt = db.prepare(`
        INSERT INTO articles (feed_id, guid, title, link, content, pub_date)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        input.feed_id,
        input.guid,
        input.title,
        input.link ?? null,
        input.content ?? null,
        input.pub_date ?? null
      );
      return this.getArticleById(result.lastInsertRowid as number);
    } catch (error) {
      // Duplicate article (unique constraint violation)
      if ((error as Error).message.includes('UNIQUE constraint failed')) {
        return null;
      }
      throw error;
    }
  }

  addArticles(inputs: ArticleInput[]): number {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO articles (feed_id, guid, title, link, content, pub_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((articles: ArticleInput[]) => {
      let count = 0;
      for (const article of articles) {
        const result = stmt.run(
          article.feed_id,
          article.guid,
          article.title,
          article.link ?? null,
          article.content ?? null,
          article.pub_date ?? null
        );
        if (result.changes > 0) count++;
      }
      return count;
    });

    return insertMany(inputs);
  }

  getArticleById(id: number): Article | null {
    const db = getDb();
    return db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as Article | undefined ?? null;
  }

  getArticlesByFeed(feedId: number, limit = 50): Article[] {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM articles
      WHERE feed_id = ?
      ORDER BY pub_date DESC, id DESC
      LIMIT ?
    `).all(feedId, limit) as Article[];
  }

  getUnanalyzedArticles(feedId?: number, days = 7): Article[] {
    const db = getDb();
    let sql = `
      SELECT * FROM articles
      WHERE analyzed_at IS NULL
      AND pub_date >= datetime('now', '-' || ? || ' days')
    `;
    const params: (number | string)[] = [days];

    if (feedId) {
      sql += ' AND feed_id = ?';
      params.push(feedId);
    }

    sql += ' ORDER BY pub_date DESC';
    return db.prepare(sql).all(...params) as Article[];
  }

  getArticles(options: {
    feedId?: number;
    unread?: boolean;
    interesting?: boolean;
    days?: number;
    limit?: number;
  }): ArticleWithFeed[] {
    const db = getDb();
    const conditions: string[] = [];
    const params: (number | string)[] = [];

    if (options.feedId) {
      conditions.push('a.feed_id = ?');
      params.push(options.feedId);
    }

    if (options.unread) {
      conditions.push('a.is_read = 0');
    }

    if (options.interesting !== undefined) {
      conditions.push('a.is_interesting = ?');
      params.push(options.interesting ? 1 : 0);
    }

    if (options.days) {
      conditions.push(`a.pub_date >= datetime('now', '-' || ? || ' days')`);
      params.push(options.days);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 50;

    const sql = `
      SELECT a.*, f.name as feed_name, f.url as feed_url
      FROM articles a
      JOIN feeds f ON a.feed_id = f.id
      ${whereClause}
      ORDER BY a.pub_date DESC, a.id DESC
      LIMIT ?
    `;
    params.push(limit);

    return db.prepare(sql).all(...params) as ArticleWithFeed[];
  }

  searchArticles(keyword: string, searchIn: 'title' | 'content' | 'all' = 'all'): ArticleWithFeed[] {
    const db = getDb();
    const pattern = `%${keyword}%`;
    let condition: string;

    switch (searchIn) {
      case 'title':
        condition = 'a.title LIKE ?';
        break;
      case 'content':
        condition = 'a.content LIKE ?';
        break;
      default:
        condition = '(a.title LIKE ? OR a.content LIKE ?)';
    }

    const sql = `
      SELECT a.*, f.name as feed_name, f.url as feed_url
      FROM articles a
      JOIN feeds f ON a.feed_id = f.id
      WHERE ${condition}
      ORDER BY a.pub_date DESC, a.id DESC
      LIMIT 100
    `;

    if (searchIn === 'all') {
      return db.prepare(sql).all(pattern, pattern) as ArticleWithFeed[];
    }
    return db.prepare(sql).all(pattern) as ArticleWithFeed[];
  }

  updateArticleAnalysis(
    articleId: number,
    isInteresting: boolean,
    reason: string,
    summary?: string
  ): void {
    const db = getDb();
    db.prepare(`
      UPDATE articles
      SET is_interesting = ?, interest_reason = ?, summary = ?, analyzed_at = datetime('now')
      WHERE id = ?
    `).run(isInteresting ? 1 : 0, reason, summary ?? null, articleId);
  }

  markArticleAsRead(articleId: number): void {
    const db = getDb();
    db.prepare('UPDATE articles SET is_read = 1 WHERE id = ?').run(articleId);
  }

  // User preference operations
  addPreference(type: 'interest' | 'ignore', keyword: string, weight = 1): UserPreference {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO user_preferences (type, keyword, weight)
      VALUES (?, ?, ?)
    `).run(type, keyword, weight);
    return this.getPreferenceById(result.lastInsertRowid as number)!;
  }

  getPreferenceById(id: number): UserPreference | null {
    const db = getDb();
    return db.prepare('SELECT * FROM user_preferences WHERE id = ?').get(id) as UserPreference | undefined ?? null;
  }

  getAllPreferences(): UserPreference[] {
    const db = getDb();
    return db.prepare('SELECT * FROM user_preferences ORDER BY type, id').all() as UserPreference[];
  }

  removePreference(id: number): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM user_preferences WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // Resource operations
  addOrUpdateResource(input: ResourceInput): Resource {
    const db = getDb();
    const tagsStr = input.tags?.join(',') ?? null;

    const existing = db
      .prepare('SELECT * FROM resources WHERE name = ? AND type = ?')
      .get(input.name, input.type) as Resource | undefined;

    if (existing) {
      db.prepare(`
        UPDATE resources
        SET mention_count = mention_count + 1,
            url = COALESCE(?, url),
            github_url = COALESCE(?, github_url),
            description = COALESCE(?, description),
            tags = COALESCE(?, tags)
        WHERE id = ?
      `).run(
        input.url ?? null,
        input.github_url ?? null,
        input.description ?? null,
        tagsStr,
        existing.id
      );
      return this.getResourceById(existing.id)!;
    }

    const result = db.prepare(`
      INSERT INTO resources (name, type, url, github_url, description, tags)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.name,
      input.type,
      input.url ?? null,
      input.github_url ?? null,
      input.description ?? null,
      tagsStr
    );
    return this.getResourceById(result.lastInsertRowid as number)!;
  }

  getResourceById(id: number): Resource | null {
    const db = getDb();
    return db.prepare('SELECT * FROM resources WHERE id = ?').get(id) as Resource | undefined ?? null;
  }

  getResourceByNameAndType(name: string, type: string): Resource | null {
    const db = getDb();
    return db.prepare('SELECT * FROM resources WHERE name = ? AND type = ?').get(name, type) as Resource | undefined ?? null;
  }

  updateResourceDescription(id: number, description: string): void {
    const db = getDb();
    db.prepare('UPDATE resources SET description = ? WHERE id = ?').run(description, id);
  }

  incrementResourceMentionCount(id: number): void {
    const db = getDb();
    db.prepare('UPDATE resources SET mention_count = mention_count + 1 WHERE id = ?').run(id);
  }

  linkArticleResource(input: ArticleResourceInput): boolean {
    const db = getDb();
    try {
      db.prepare(`
        INSERT INTO article_resources (article_id, resource_id, context, relevance)
        VALUES (?, ?, ?, ?)
      `).run(
        input.article_id,
        input.resource_id,
        input.context ?? null,
        input.relevance ?? 'mentioned'
      );
      return true;
    } catch (error) {
      if ((error as Error).message.includes('UNIQUE constraint failed')) {
        return false;
      }
      throw error;
    }
  }

  getHotResources(options: {
    days?: number;
    type?: string;
    limit?: number;
  } = {}): ResourceWithStats[] {
    const db = getDb();
    const conditions: string[] = [];
    const params: (number | string)[] = [];

    if (options.days) {
      conditions.push(`r.first_seen_at >= datetime('now', '-' || ? || ' days')`);
      params.push(options.days);
    }

    if (options.type) {
      conditions.push('r.type = ?');
      params.push(options.type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 20;

    const sql = `
      SELECT
        r.*,
        COUNT(DISTINCT ar.article_id) as article_count,
        COUNT(DISTINCT a.feed_id) as source_count
      FROM resources r
      LEFT JOIN article_resources ar ON r.id = ar.resource_id
      LEFT JOIN articles a ON ar.article_id = a.id
      ${whereClause}
      GROUP BY r.id
      ORDER BY source_count DESC, article_count DESC, r.mention_count DESC
      LIMIT ?
    `;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as (Resource & { source_count: number; article_count: number })[];
    return rows.map(row => ({
      ...row,
      tags_array: row.tags ? row.tags.split(',') : [],
    }));
  }

  searchResources(keyword: string, limit = 20): ResourceWithStats[] {
    const db = getDb();
    const pattern = `%${keyword}%`;

    const sql = `
      SELECT
        r.*,
        COUNT(DISTINCT ar.article_id) as article_count,
        COUNT(DISTINCT a.feed_id) as source_count
      FROM resources r
      LEFT JOIN article_resources ar ON r.id = ar.resource_id
      LEFT JOIN articles a ON ar.article_id = a.id
      WHERE r.name LIKE ? OR r.description LIKE ? OR r.tags LIKE ?
      GROUP BY r.id
      ORDER BY source_count DESC, article_count DESC
      LIMIT ?
    `;

    const rows = db.prepare(sql).all(pattern, pattern, pattern, limit) as (Resource & { source_count: number; article_count: number })[];
    return rows.map(row => ({
      ...row,
      tags_array: row.tags ? row.tags.split(',') : [],
    }));
  }

  getArticlesByResource(resourceId: number, limit = 20): ArticleWithFeed[] {
    const db = getDb();
    const sql = `
      SELECT a.*, f.name as feed_name, f.url as feed_url
      FROM articles a
      JOIN article_resources ar ON a.id = ar.article_id
      JOIN feeds f ON a.feed_id = f.id
      WHERE ar.resource_id = ?
      ORDER BY a.pub_date DESC
      LIMIT ?
    `;
    return db.prepare(sql).all(resourceId, limit) as ArticleWithFeed[];
  }

  getResourceWithStats(id: number): ResourceWithStats | null {
    const db = getDb();
    const sql = `
      SELECT
        r.*,
        COUNT(DISTINCT ar.article_id) as article_count,
        COUNT(DISTINCT a.feed_id) as source_count
      FROM resources r
      LEFT JOIN article_resources ar ON r.id = ar.resource_id
      LEFT JOIN articles a ON ar.article_id = a.id
      WHERE r.id = ?
      GROUP BY r.id
    `;
    const row = db.prepare(sql).get(id) as (Resource & { source_count: number; article_count: number }) | undefined;
    if (!row) return null;
    return {
      ...row,
      tags_array: row.tags ? row.tags.split(',') : [],
    };
  }

  // Tag operations
  getOrCreateTag(name: string, category?: string): Tag {
    const db = getDb();
    const normalizedName = name.toLowerCase().trim();

    const existing = db.prepare('SELECT * FROM tags WHERE name = ?').get(normalizedName) as Tag | undefined;
    if (existing) {
      return existing;
    }

    const result = db.prepare(`
      INSERT INTO tags (name, category)
      VALUES (?, ?)
    `).run(normalizedName, category ?? null);

    return db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid) as Tag;
  }

  getAllTags(): Tag[] {
    const db = getDb();
    return db.prepare('SELECT * FROM tags ORDER BY name').all() as Tag[];
  }

  getTagsWithCounts(): TagWithCount[] {
    const db = getDb();
    const sql = `
      SELECT
        t.*,
        COUNT(DISTINCT at.article_id) as article_count,
        COUNT(DISTINCT rt.resource_id) as resource_count
      FROM tags t
      LEFT JOIN article_tags at ON t.id = at.tag_id
      LEFT JOIN resource_tags rt ON t.id = rt.tag_id
      GROUP BY t.id
      ORDER BY article_count DESC, t.name
    `;
    return db.prepare(sql).all() as TagWithCount[];
  }

  getTagByName(name: string): Tag | null {
    const db = getDb();
    const normalizedName = name.toLowerCase().trim();
    return db.prepare('SELECT * FROM tags WHERE name = ?').get(normalizedName) as Tag | undefined ?? null;
  }

  searchTags(keyword: string): TagWithCount[] {
    const db = getDb();
    const pattern = `%${keyword.toLowerCase()}%`;
    const sql = `
      SELECT
        t.*,
        COUNT(DISTINCT at.article_id) as article_count,
        COUNT(DISTINCT rt.resource_id) as resource_count
      FROM tags t
      LEFT JOIN article_tags at ON t.id = at.tag_id
      LEFT JOIN resource_tags rt ON t.id = rt.tag_id
      WHERE t.name LIKE ?
      GROUP BY t.id
      ORDER BY article_count DESC
    `;
    return db.prepare(sql).all(pattern) as TagWithCount[];
  }

  linkArticleTag(input: ArticleTagInput): boolean {
    const db = getDb();
    try {
      db.prepare(`
        INSERT INTO article_tags (article_id, tag_id, source, confidence)
        VALUES (?, ?, ?, ?)
      `).run(
        input.article_id,
        input.tag_id,
        input.source ?? 'llm',
        input.confidence ?? 1.0
      );
      return true;
    } catch (error) {
      if ((error as Error).message.includes('UNIQUE constraint failed')) {
        return false;
      }
      throw error;
    }
  }

  getArticleTags(articleId: number): Tag[] {
    const db = getDb();
    const sql = `
      SELECT t.*
      FROM tags t
      JOIN article_tags at ON t.id = at.tag_id
      WHERE at.article_id = ?
      ORDER BY t.name
    `;
    return db.prepare(sql).all(articleId) as Tag[];
  }

  getArticlesByTag(tagId: number, limit = 50): ArticleWithFeed[] {
    const db = getDb();
    const sql = `
      SELECT a.*, f.name as feed_name, f.url as feed_url
      FROM articles a
      JOIN article_tags at ON a.id = at.article_id
      JOIN feeds f ON a.feed_id = f.id
      WHERE at.tag_id = ?
      ORDER BY a.pub_date DESC
      LIMIT ?
    `;
    return db.prepare(sql).all(tagId, limit) as ArticleWithFeed[];
  }

  getArticlesByTagName(tagName: string, limit = 50): ArticleWithFeed[] {
    const tag = this.getTagByName(tagName);
    if (!tag) return [];
    return this.getArticlesByTag(tag.id, limit);
  }

  linkResourceTag(resourceId: number, tagId: number): boolean {
    const db = getDb();
    try {
      db.prepare(`
        INSERT INTO resource_tags (resource_id, tag_id)
        VALUES (?, ?)
      `).run(resourceId, tagId);
      return true;
    } catch (error) {
      if ((error as Error).message.includes('UNIQUE constraint failed')) {
        return false;
      }
      throw error;
    }
  }

  getResourceTags(resourceId: number): Tag[] {
    const db = getDb();
    const sql = `
      SELECT t.*
      FROM tags t
      JOIN resource_tags rt ON t.id = rt.tag_id
      WHERE rt.resource_id = ?
      ORDER BY t.name
    `;
    return db.prepare(sql).all(resourceId) as Tag[];
  }

  getResourcesByTag(tagId: number, limit = 50): ResourceWithStats[] {
    const db = getDb();
    const sql = `
      SELECT
        r.*,
        COUNT(DISTINCT ar.article_id) as article_count,
        COUNT(DISTINCT a.feed_id) as source_count
      FROM resources r
      JOIN resource_tags rt ON r.id = rt.resource_id
      LEFT JOIN article_resources ar ON r.id = ar.resource_id
      LEFT JOIN articles a ON ar.article_id = a.id
      WHERE rt.tag_id = ?
      GROUP BY r.id
      ORDER BY source_count DESC, article_count DESC
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(tagId, limit) as (Resource & { source_count: number; article_count: number })[];
    return rows.map(row => ({
      ...row,
      tags_array: row.tags ? row.tags.split(',') : [],
    }));
  }

  getResourcesByTagName(tagName: string, limit = 50): ResourceWithStats[] {
    const tag = this.getTagByName(tagName);
    if (!tag) return [];
    return this.getResourcesByTag(tag.id, limit);
  }

  // Snapshot operations
  saveArticleSnapshot(articleId: number, textContent: string): void {
    const db = getDb();
    db.prepare(`
      UPDATE articles
      SET text_snapshot = ?, snapshot_at = datetime('now')
      WHERE id = ?
    `).run(textContent, articleId);
  }

  getArticleSnapshot(articleId: number): string | null {
    const db = getDb();
    const row = db.prepare('SELECT text_snapshot FROM articles WHERE id = ?').get(articleId) as { text_snapshot: string | null } | undefined;
    return row?.text_snapshot ?? null;
  }

  // Enhanced getArticles with tag filtering
  getArticlesWithTags(options: {
    feedId?: number;
    unread?: boolean;
    interesting?: boolean;
    days?: number;
    limit?: number;
    tags?: string[];
  }): ArticleWithTags[] {
    const db = getDb();
    const conditions: string[] = [];
    const params: (number | string)[] = [];

    if (options.feedId) {
      conditions.push('a.feed_id = ?');
      params.push(options.feedId);
    }

    if (options.unread) {
      conditions.push('a.is_read = 0');
    }

    if (options.interesting !== undefined) {
      conditions.push('a.is_interesting = ?');
      params.push(options.interesting ? 1 : 0);
    }

    if (options.days) {
      conditions.push(`a.pub_date >= datetime('now', '-' || ? || ' days')`);
      params.push(options.days);
    }

    if (options.tags && options.tags.length > 0) {
      const tagPlaceholders = options.tags.map(() => '?').join(',');
      conditions.push(`a.id IN (
        SELECT at.article_id FROM article_tags at
        JOIN tags t ON at.tag_id = t.id
        WHERE t.name IN (${tagPlaceholders})
      )`);
      params.push(...options.tags.map(t => t.toLowerCase().trim()));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 50;

    const sql = `
      SELECT a.*, f.name as feed_name, f.url as feed_url
      FROM articles a
      JOIN feeds f ON a.feed_id = f.id
      ${whereClause}
      ORDER BY a.pub_date DESC, a.id DESC
      LIMIT ?
    `;
    params.push(limit);

    const articles = db.prepare(sql).all(...params) as ArticleWithFeed[];

    // Fetch tags for each article
    return articles.map(article => ({
      ...article,
      tags: this.getArticleTags(article.id),
    }));
  }
}

export const cacheService = new CacheService();
