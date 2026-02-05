import fetch, { RequestInit, Response } from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getConfig } from '../utils/config.js';
import { cacheService } from './cache.js';
import { CONFIG_KEYS } from '../models/config.js';
import type { Feed } from '../models/feed.js';

export class ProxyManager {
  private proxyUrl: string | null = null;

  constructor() {
    this.proxyUrl = getConfig(CONFIG_KEYS.PROXY_URL);
  }

  refreshProxyUrl(): void {
    this.proxyUrl = getConfig(CONFIG_KEYS.PROXY_URL);
  }

  private determineMode(feed: Feed): 'direct' | 'proxy' {
    if (feed.proxy_mode === 'direct') return 'direct';
    if (feed.proxy_mode === 'proxy') return 'proxy';

    // Auto mode: prefer the method with higher success rate
    const directRate = feed.direct_success_count;
    const proxyRate = feed.proxy_success_count;

    // If no history, try direct first
    if (directRate === 0 && proxyRate === 0) return 'direct';

    return directRate >= proxyRate ? 'direct' : 'proxy';
  }

  private async doFetch(url: string, mode: 'direct' | 'proxy'): Promise<Response> {
    const options: RequestInit = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSS-CLI/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    };

    if (mode === 'proxy' && this.proxyUrl) {
      options.agent = new HttpsProxyAgent(this.proxyUrl);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
  }

  async fetch(url: string, feedId?: number): Promise<Response> {
    this.refreshProxyUrl();

    // If no feed context, just try direct then proxy
    if (!feedId) {
      try {
        return await this.doFetch(url, 'direct');
      } catch {
        if (this.proxyUrl) {
          return await this.doFetch(url, 'proxy');
        }
        throw new Error('Direct connection failed and no proxy configured');
      }
    }

    const feed = cacheService.getFeedById(feedId);
    if (!feed) {
      throw new Error(`Feed with id ${feedId} not found`);
    }

    const mode = this.determineMode(feed);

    try {
      const response = await this.doFetch(url, mode);
      cacheService.updateFeedProxyStats(feedId, mode, true);
      return response;
    } catch (error) {
      // Try the other mode
      const altMode = mode === 'direct' ? 'proxy' : 'direct';

      // Only try alternative if proxy is configured or we're switching to direct
      if (altMode === 'direct' || this.proxyUrl) {
        try {
          const response = await this.doFetch(url, altMode);
          cacheService.updateFeedProxyStats(feedId, altMode, true);
          return response;
        } catch {
          throw new Error(`Both direct and proxy connections failed for ${url}`);
        }
      }

      throw error;
    }
  }

  async fetchText(url: string, feedId?: number): Promise<string> {
    const response = await this.fetch(url, feedId);
    return response.text();
  }
}

export const proxyManager = new ProxyManager();
