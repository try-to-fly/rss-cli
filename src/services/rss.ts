import Parser from 'rss-parser';
import { proxyManager } from './proxy.js';
import { cacheService } from './cache.js';
import type { ArticleInput } from '../models/article.js';
import type { Feed } from '../models/feed.js';

export interface RssItem {
  guid: string;
  title: string;
  link?: string;
  content?: string;
  pubDate?: string;
}

export interface RssFeed {
  title: string;
  description?: string;
  link?: string;
  items: RssItem[];
}

export class RssService {
  private parser: Parser;

  constructor() {
    this.parser = new Parser({
      customFields: {
        item: [
          ['content:encoded', 'contentEncoded'],
          ['dc:creator', 'creator'],
        ],
      },
    });
  }

  async fetchFeed(feed: Feed): Promise<RssFeed> {
    const xml = await proxyManager.fetchText(feed.url, feed.id);
    const parsed = await this.parser.parseString(xml);

    return {
      title: parsed.title || feed.name,
      description: parsed.description,
      link: parsed.link,
      items: parsed.items.map((item) => ({
        guid: item.guid || item.link || item.title || '',
        title: item.title || 'Untitled',
        link: item.link,
        content: item.contentEncoded || item.content || item.contentSnippet || '',
        pubDate: item.pubDate || item.isoDate,
      })),
    };
  }

  async updateFeed(feed: Feed): Promise<number> {
    const rssFeed = await this.fetchFeed(feed);

    const articles: ArticleInput[] = rssFeed.items.map((item) => ({
      feed_id: feed.id,
      guid: item.guid,
      title: item.title,
      link: item.link,
      content: item.content,
      pub_date: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
    }));

    const newCount = cacheService.addArticles(articles);
    cacheService.updateFeedFetchTime(feed.id);

    return newCount;
  }

  async updateAllFeeds(feedId?: number): Promise<Map<string, { newCount: number; error?: string }>> {
    const results = new Map<string, { newCount: number; error?: string }>();
    const feeds = feedId
      ? [cacheService.getFeedById(feedId)].filter(Boolean) as Feed[]
      : cacheService.getAllFeeds();

    for (const feed of feeds) {
      try {
        const newCount = await this.updateFeed(feed);
        results.set(feed.name, { newCount });
      } catch (error) {
        results.set(feed.name, {
          newCount: 0,
          error: (error as Error).message,
        });
      }
    }

    return results;
  }

  async detectFeedInfo(url: string): Promise<{ title: string; description?: string } | null> {
    try {
      const xml = await proxyManager.fetchText(url);
      const parsed = await this.parser.parseString(xml);
      return {
        title: parsed.title || url,
        description: parsed.description,
      };
    } catch {
      return null;
    }
  }
}

export const rssService = new RssService();
