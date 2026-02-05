import { getDb } from '../db/index.js';
import type { Feed, FeedInput } from '../models/feed.js';
import type { Article, ArticleInput, ArticleWithFeed } from '../models/article.js';
import type { UserPreference } from '../models/config.js';

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
}

export const cacheService = new CacheService();
