import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import PQueue from 'p-queue';
import type { Browser, Page } from 'puppeteer';

// 启用 stealth 插件
puppeteer.use(StealthPlugin());

export interface ScrapedContent {
  title: string;
  content: string;      // HTML 内容
  textContent: string;  // 纯文本内容
  byline?: string;      // 作者
  excerpt?: string;     // 摘要
}

export interface QueueStatus {
  pending: number;
  size: number;
}

export class ScraperService {
  private queue: PQueue;
  private browser: Browser | null = null;

  constructor() {
    this.queue = new PQueue({
      concurrency: 2,           // 同时最多 2 个页面
      interval: 3000,           // 每 3 秒
      intervalCap: 1,           // 最多启动 1 个新任务
      timeout: 30000,           // 单个任务超时 30s
    });
  }

  async init(): Promise<void> {
    if (this.browser) return;

    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1920,1080',
      ],
    });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  private async setupPage(page: Page): Promise<void> {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // 模拟真实浏览器行为
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });
  }

  async fetchArticleContent(url: string): Promise<ScrapedContent | null> {
    return this.queue.add(async () => {
      if (!this.browser) {
        await this.init();
      }

      const page = await this.browser!.newPage();

      try {
        // 随机延迟 1-3 秒，模拟人类行为
        await this.randomDelay(1000, 3000);

        await this.setupPage(page);

        // 导航到页面
        await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: 20000,
        });

        // 等待页面内容加载
        await this.randomDelay(500, 1500);

        // 获取页面 HTML
        const html = await page.content();

        // 使用 Readability 提取正文
        const dom = new JSDOM(html, { url });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        if (!article) {
          console.log(`[Scraper] 无法提取正文: ${url}`);
          return null;
        }

        return {
          title: article.title,
          content: article.content,
          textContent: article.textContent,
          byline: article.byline || undefined,
          excerpt: article.excerpt || undefined,
        };
      } catch (error) {
        console.error(`[Scraper] 抓取失败 ${url}: ${(error as Error).message}`);
        return null;
      } finally {
        await page.close();
      }
    }) as Promise<ScrapedContent | null>;
  }

  async fetchBatch(
    articles: { id: number; link?: string | null }[]
  ): Promise<Map<number, string>> {
    const results = new Map<number, string>();

    const tasks = articles
      .filter(a => a.link)
      .map(async (article) => {
        const content = await this.fetchArticleContent(article.link!);
        if (content?.textContent) {
          results.set(article.id, content.textContent);
        }
      });

    await Promise.all(tasks);
    return results;
  }

  getQueueStatus(): QueueStatus {
    return {
      pending: this.queue.pending,
      size: this.queue.size,
    };
  }
}

export const scraperService = new ScraperService();
