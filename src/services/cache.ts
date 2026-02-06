import { eq, and, desc, like, or, sql, isNull, gte, inArray, count } from 'drizzle-orm';
import { getDb, getSqlite, schema } from '../db/index.js';
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
  ArticleTagInput,
  TagWithCount,
} from '../models/tag.js';

const { feeds, articles, tags, articleTags, resources, resourceTags, articleResources, userPreferences, config } = schema;

// 辅助函数：将 drizzle 结果转换为 snake_case 格式
function toFeed(row: typeof feeds.$inferSelect): Feed {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    category: row.category,
    proxy_mode: row.proxyMode as Feed['proxy_mode'],
    proxy_success_count: row.proxySuccessCount ?? 0,
    direct_success_count: row.directSuccessCount ?? 0,
    last_fetched_at: row.lastFetchedAt,
    created_at: row.createdAt ?? '',
  };
}

function toArticle(row: typeof articles.$inferSelect): Article {
  return {
    id: row.id,
    feed_id: row.feedId,
    guid: row.guid,
    title: row.title,
    link: row.link,
    content: row.content,
    pub_date: row.pubDate,
    is_read: row.isRead ?? 0,
    is_interesting: row.isInteresting,
    interest_reason: row.interestReason,
    summary: row.summary,
    analyzed_at: row.analyzedAt,
    text_snapshot: row.textSnapshot,
    snapshot_at: row.snapshotAt,
    created_at: row.createdAt ?? '',
  };
}

function toTag(row: typeof tags.$inferSelect): Tag {
  return {
    id: row.id,
    name: row.name,
    category: row.category as Tag['category'],
    color: row.color,
    created_at: row.createdAt ?? '',
  };
}

function toResource(row: typeof resources.$inferSelect): Resource {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Resource['type'],
    url: row.url,
    github_url: row.githubUrl,
    description: row.description,
    tags: row.tags,
    first_seen_at: row.firstSeenAt ?? '',
    mention_count: row.mentionCount ?? 1,
  };
}

function toUserPreference(row: typeof userPreferences.$inferSelect): UserPreference {
  return {
    id: row.id,
    type: row.type as UserPreference['type'],
    keyword: row.keyword,
    weight: row.weight ?? 1,
    created_at: row.createdAt ?? '',
  };
}

export class CacheService {
  // Feed operations
  addFeed(input: FeedInput): Feed {
    const db = getDb();
    const result = db.insert(feeds).values({
      name: input.name,
      url: input.url,
      category: input.category ?? null,
      proxyMode: input.proxy_mode ?? 'auto',
    }).returning().get();
    return toFeed(result);
  }

  getFeedById(id: number): Feed | null {
    const db = getDb();
    const result = db.select().from(feeds).where(eq(feeds.id, id)).get();
    return result ? toFeed(result) : null;
  }

  getFeedByUrl(url: string): Feed | null {
    const db = getDb();
    const result = db.select().from(feeds).where(eq(feeds.url, url)).get();
    return result ? toFeed(result) : null;
  }

  getAllFeeds(category?: string): Feed[] {
    const db = getDb();
    const query = category
      ? db.select().from(feeds).where(eq(feeds.category, category)).orderBy(feeds.id)
      : db.select().from(feeds).orderBy(feeds.id);
    return query.all().map(toFeed);
  }

  removeFeed(idOrUrl: string): boolean {
    const db = getDb();
    const isNumeric = /^\d+$/.test(idOrUrl);
    const result = isNumeric
      ? db.delete(feeds).where(eq(feeds.id, parseInt(idOrUrl, 10))).run()
      : db.delete(feeds).where(eq(feeds.url, idOrUrl)).run();
    return result.changes > 0;
  }

  updateFeedFetchTime(feedId: number): void {
    const db = getDb();
    db.update(feeds)
      .set({ lastFetchedAt: sql`datetime('now')` })
      .where(eq(feeds.id, feedId))
      .run();
  }

  updateFeedProxyStats(feedId: number, mode: 'direct' | 'proxy', success: boolean): void {
    if (!success) return;
    const db = getDb();
    if (mode === 'direct') {
      db.update(feeds)
        .set({ directSuccessCount: sql`${feeds.directSuccessCount} + 1` })
        .where(eq(feeds.id, feedId))
        .run();
    } else {
      db.update(feeds)
        .set({ proxySuccessCount: sql`${feeds.proxySuccessCount} + 1` })
        .where(eq(feeds.id, feedId))
        .run();
    }
  }

  // Article operations
  addArticle(input: ArticleInput): Article | null {
    const db = getDb();
    try {
      const result = db.insert(articles).values({
        feedId: input.feed_id,
        guid: input.guid,
        title: input.title,
        link: input.link ?? null,
        content: input.content ?? null,
        pubDate: input.pub_date ?? null,
      }).returning().get();
      return toArticle(result);
    } catch (error) {
      if ((error as Error).message.includes('UNIQUE constraint failed')) {
        return null;
      }
      throw error;
    }
  }

  addArticles(inputs: ArticleInput[]): number {
    const sqlite = getSqlite();
    const stmt = sqlite.prepare(`
      INSERT OR IGNORE INTO articles (feed_id, guid, title, link, content, pub_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = sqlite.transaction((articleInputs: ArticleInput[]) => {
      let insertedCount = 0;
      for (const article of articleInputs) {
        const result = stmt.run(
          article.feed_id,
          article.guid,
          article.title,
          article.link ?? null,
          article.content ?? null,
          article.pub_date ?? null
        );
        if (result.changes > 0) insertedCount++;
      }
      return insertedCount;
    });

    return insertMany(inputs);
  }

  getArticleById(id: number): Article | null {
    const db = getDb();
    const result = db.select().from(articles).where(eq(articles.id, id)).get();
    return result ? toArticle(result) : null;
  }

  getArticlesByFeed(feedId: number, limit = 50): Article[] {
    const db = getDb();
    return db.select()
      .from(articles)
      .where(eq(articles.feedId, feedId))
      .orderBy(desc(articles.pubDate), desc(articles.id))
      .limit(limit)
      .all()
      .map(toArticle);
  }

  getUnanalyzedArticles(feedId?: number, days = 7): Article[] {
    const db = getDb();
    const conditions = [
      isNull(articles.analyzedAt),
      gte(articles.pubDate, sql`datetime('now', '-' || ${days} || ' days')`),
    ];
    if (feedId) {
      conditions.push(eq(articles.feedId, feedId));
    }
    return db.select()
      .from(articles)
      .where(and(...conditions))
      .orderBy(desc(articles.pubDate))
      .all()
      .map(toArticle);
  }

  getArticles(options: {
    feedId?: number;
    unread?: boolean;
    interesting?: boolean;
    days?: number;
    limit?: number;
  }): ArticleWithFeed[] {
    const sqlite = getSqlite();
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

    const sqlQuery = `
      SELECT a.*, f.name as feed_name, f.url as feed_url
      FROM articles a
      JOIN feeds f ON a.feed_id = f.id
      ${whereClause}
      ORDER BY a.pub_date DESC, a.id DESC
      LIMIT ?
    `;
    params.push(limit);

    return sqlite.prepare(sqlQuery).all(...params) as ArticleWithFeed[];
  }

  searchArticles(keyword: string, searchIn: 'title' | 'content' | 'all' = 'all'): ArticleWithFeed[] {
    const sqlite = getSqlite();
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

    const sqlQuery = `
      SELECT a.*, f.name as feed_name, f.url as feed_url
      FROM articles a
      JOIN feeds f ON a.feed_id = f.id
      WHERE ${condition}
      ORDER BY a.pub_date DESC, a.id DESC
      LIMIT 100
    `;

    if (searchIn === 'all') {
      return sqlite.prepare(sqlQuery).all(pattern, pattern) as ArticleWithFeed[];
    }
    return sqlite.prepare(sqlQuery).all(pattern) as ArticleWithFeed[];
  }

  updateArticleAnalysis(
    articleId: number,
    isInteresting: boolean,
    reason: string,
    summary?: string
  ): void {
    const db = getDb();
    db.update(articles)
      .set({
        isInteresting: isInteresting ? 1 : 0,
        interestReason: reason,
        summary: summary ?? null,
        analyzedAt: sql`datetime('now')`,
      })
      .where(eq(articles.id, articleId))
      .run();
  }

  markArticleAsRead(articleId: number): void {
    const db = getDb();
    db.update(articles)
      .set({ isRead: 1 })
      .where(eq(articles.id, articleId))
      .run();
  }

  // User preference operations
  addPreference(type: 'interest' | 'ignore', keyword: string, weight = 1): UserPreference {
    const db = getDb();
    const result = db.insert(userPreferences).values({
      type,
      keyword,
      weight,
    }).returning().get();
    return toUserPreference(result);
  }

  getPreferenceById(id: number): UserPreference | null {
    const db = getDb();
    const result = db.select().from(userPreferences).where(eq(userPreferences.id, id)).get();
    return result ? toUserPreference(result) : null;
  }

  getAllPreferences(): UserPreference[] {
    const db = getDb();
    return db.select()
      .from(userPreferences)
      .orderBy(userPreferences.type, userPreferences.id)
      .all()
      .map(toUserPreference);
  }

  removePreference(id: number): boolean {
    const db = getDb();
    const result = db.delete(userPreferences).where(eq(userPreferences.id, id)).run();
    return result.changes > 0;
  }

  // Resource operations
  addOrUpdateResource(input: ResourceInput): Resource {
    const db = getDb();
    const tagsStr = input.tags?.join(',') ?? null;

    const existing = db.select()
      .from(resources)
      .where(and(eq(resources.name, input.name), eq(resources.type, input.type)))
      .get();

    if (existing) {
      db.update(resources)
        .set({
          mentionCount: sql`${resources.mentionCount} + 1`,
          url: input.url ?? existing.url,
          githubUrl: input.github_url ?? existing.githubUrl,
          description: input.description ?? existing.description,
          tags: tagsStr ?? existing.tags,
        })
        .where(eq(resources.id, existing.id))
        .run();
      return this.getResourceById(existing.id)!;
    }

    const result = db.insert(resources).values({
      name: input.name,
      type: input.type,
      url: input.url ?? null,
      githubUrl: input.github_url ?? null,
      description: input.description ?? null,
      tags: tagsStr,
    }).returning().get();
    return toResource(result);
  }

  getResourceById(id: number): Resource | null {
    const db = getDb();
    const result = db.select().from(resources).where(eq(resources.id, id)).get();
    return result ? toResource(result) : null;
  }

  getResourceByNameAndType(name: string, type: string): Resource | null {
    const db = getDb();
    const result = db.select()
      .from(resources)
      .where(and(eq(resources.name, name), eq(resources.type, type)))
      .get();
    return result ? toResource(result) : null;
  }

  updateResourceDescription(id: number, description: string): void {
    const db = getDb();
    db.update(resources)
      .set({ description })
      .where(eq(resources.id, id))
      .run();
  }

  incrementResourceMentionCount(id: number): void {
    const db = getDb();
    db.update(resources)
      .set({ mentionCount: sql`${resources.mentionCount} + 1` })
      .where(eq(resources.id, id))
      .run();
  }

  linkArticleResource(input: ArticleResourceInput): boolean {
    const db = getDb();
    try {
      db.insert(articleResources).values({
        articleId: input.article_id,
        resourceId: input.resource_id,
        context: input.context ?? null,
        relevance: input.relevance ?? 'mentioned',
      }).run();
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
    const sqlite = getSqlite();
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

    const sqlQuery = `
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

    const rows = sqlite.prepare(sqlQuery).all(...params) as (Resource & { source_count: number; article_count: number })[];
    return rows.map(row => ({
      ...row,
      tags_array: row.tags ? row.tags.split(',') : [],
    }));
  }

  searchResources(keyword: string, limit = 20): ResourceWithStats[] {
    const sqlite = getSqlite();
    const pattern = `%${keyword}%`;

    const sqlQuery = `
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

    const rows = sqlite.prepare(sqlQuery).all(pattern, pattern, pattern, limit) as (Resource & { source_count: number; article_count: number })[];
    return rows.map(row => ({
      ...row,
      tags_array: row.tags ? row.tags.split(',') : [],
    }));
  }

  getArticlesByResource(resourceId: number, limit = 20): ArticleWithFeed[] {
    const sqlite = getSqlite();
    const sqlQuery = `
      SELECT a.*, f.name as feed_name, f.url as feed_url
      FROM articles a
      JOIN article_resources ar ON a.id = ar.article_id
      JOIN feeds f ON a.feed_id = f.id
      WHERE ar.resource_id = ?
      ORDER BY a.pub_date DESC
      LIMIT ?
    `;
    return sqlite.prepare(sqlQuery).all(resourceId, limit) as ArticleWithFeed[];
  }

  getResourceWithStats(id: number): ResourceWithStats | null {
    const sqlite = getSqlite();
    const sqlQuery = `
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
    const row = sqlite.prepare(sqlQuery).get(id) as (Resource & { source_count: number; article_count: number }) | undefined;
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

    const existing = db.select().from(tags).where(eq(tags.name, normalizedName)).get();
    if (existing) {
      return toTag(existing);
    }

    const result = db.insert(tags).values({
      name: normalizedName,
      category: category ?? null,
    }).returning().get();
    return toTag(result);
  }

  getAllTags(): Tag[] {
    const db = getDb();
    return db.select().from(tags).orderBy(tags.name).all().map(toTag);
  }

  getTagsWithCounts(): TagWithCount[] {
    const sqlite = getSqlite();
    const sqlQuery = `
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
    return sqlite.prepare(sqlQuery).all() as TagWithCount[];
  }

  getTagByName(name: string): Tag | null {
    const db = getDb();
    const normalizedName = name.toLowerCase().trim();
    const result = db.select().from(tags).where(eq(tags.name, normalizedName)).get();
    return result ? toTag(result) : null;
  }

  searchTags(keyword: string): TagWithCount[] {
    const sqlite = getSqlite();
    const pattern = `%${keyword.toLowerCase()}%`;
    const sqlQuery = `
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
    return sqlite.prepare(sqlQuery).all(pattern) as TagWithCount[];
  }

  linkArticleTag(input: ArticleTagInput): boolean {
    const db = getDb();
    try {
      db.insert(articleTags).values({
        articleId: input.article_id,
        tagId: input.tag_id,
        source: input.source ?? 'llm',
        confidence: input.confidence ?? 1.0,
      }).run();
      return true;
    } catch (error) {
      if ((error as Error).message.includes('UNIQUE constraint failed')) {
        return false;
      }
      throw error;
    }
  }

  getArticleTags(articleId: number): Tag[] {
    const sqlite = getSqlite();
    const sqlQuery = `
      SELECT t.*
      FROM tags t
      JOIN article_tags at ON t.id = at.tag_id
      WHERE at.article_id = ?
      ORDER BY t.name
    `;
    const rows = sqlite.prepare(sqlQuery).all(articleId) as (typeof tags.$inferSelect)[];
    return rows.map(toTag);
  }

  getArticlesByTag(tagId: number, limit = 50): ArticleWithFeed[] {
    const sqlite = getSqlite();
    const sqlQuery = `
      SELECT a.*, f.name as feed_name, f.url as feed_url
      FROM articles a
      JOIN article_tags at ON a.id = at.article_id
      JOIN feeds f ON a.feed_id = f.id
      WHERE at.tag_id = ?
      ORDER BY a.pub_date DESC
      LIMIT ?
    `;
    return sqlite.prepare(sqlQuery).all(tagId, limit) as ArticleWithFeed[];
  }

  getArticlesByTagName(tagName: string, limit = 50): ArticleWithFeed[] {
    const tag = this.getTagByName(tagName);
    if (!tag) return [];
    return this.getArticlesByTag(tag.id, limit);
  }

  linkResourceTag(resourceId: number, tagId: number): boolean {
    const db = getDb();
    try {
      db.insert(resourceTags).values({
        resourceId,
        tagId,
      }).run();
      return true;
    } catch (error) {
      if ((error as Error).message.includes('UNIQUE constraint failed')) {
        return false;
      }
      throw error;
    }
  }

  getResourceTags(resourceId: number): Tag[] {
    const sqlite = getSqlite();
    const sqlQuery = `
      SELECT t.*
      FROM tags t
      JOIN resource_tags rt ON t.id = rt.tag_id
      WHERE rt.resource_id = ?
      ORDER BY t.name
    `;
    const rows = sqlite.prepare(sqlQuery).all(resourceId) as (typeof tags.$inferSelect)[];
    return rows.map(toTag);
  }

  getResourcesByTag(tagId: number, limit = 50): ResourceWithStats[] {
    const sqlite = getSqlite();
    const sqlQuery = `
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
    const rows = sqlite.prepare(sqlQuery).all(tagId, limit) as (Resource & { source_count: number; article_count: number })[];
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

  // Reset operations
  resetData(): void {
    const sqlite = getSqlite();
    sqlite.exec(`
      DELETE FROM article_tags;
      DELETE FROM article_resources;
      DELETE FROM resource_tags;
      DELETE FROM articles;
      DELETE FROM tags;
      DELETE FROM resources;
      DELETE FROM user_preferences;
    `);
  }

  // Snapshot operations
  saveArticleSnapshot(articleId: number, textContent: string): void {
    const db = getDb();
    db.update(articles)
      .set({
        textSnapshot: textContent,
        snapshotAt: sql`datetime('now')`,
      })
      .where(eq(articles.id, articleId))
      .run();
  }

  getArticleSnapshot(articleId: number): string | null {
    const db = getDb();
    const result = db.select({ textSnapshot: articles.textSnapshot })
      .from(articles)
      .where(eq(articles.id, articleId))
      .get();
    return result?.textSnapshot ?? null;
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
    const sqlite = getSqlite();
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

    const sqlQuery = `
      SELECT a.*, f.name as feed_name, f.url as feed_url
      FROM articles a
      JOIN feeds f ON a.feed_id = f.id
      ${whereClause}
      ORDER BY a.pub_date DESC, a.id DESC
      LIMIT ?
    `;
    params.push(limit);

    const articleRows = sqlite.prepare(sqlQuery).all(...params) as ArticleWithFeed[];

    return articleRows.map(article => ({
      ...article,
      tags: this.getArticleTags(article.id),
    }));
  }
}

export const cacheService = new CacheService();
