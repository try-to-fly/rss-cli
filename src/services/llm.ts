import OpenAI from 'openai';
import { getConfig } from '../utils/config.js';
import { cacheService } from './cache.js';
import { CONFIG_KEYS } from '../models/config.js';
import type { Article } from '../models/article.js';

export interface FilterResult {
  articleId: number;
  isInteresting: boolean;
  reason: string;
}

export interface AnalysisResult extends FilterResult {
  summary?: string;
}

export class LlmService {
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = getConfig(CONFIG_KEYS.LLM_API_KEY);
      const baseUrl = getConfig(CONFIG_KEYS.LLM_BASE_URL);

      if (!apiKey) {
        throw new Error('LLM API key not configured. Use: rss config set llm_api_key <key>');
      }

      this.client = new OpenAI({
        apiKey,
        baseURL: baseUrl || undefined,
      });
    }
    return this.client;
  }

  private getModel(): string {
    return getConfig(CONFIG_KEYS.LLM_MODEL) || 'gpt-4o-mini';
  }

  private buildFilterPrompt(articles: Article[]): string {
    const preferences = cacheService.getAllPreferences();
    const interests = preferences.filter((p) => p.type === 'interest').map((p) => p.keyword);
    const ignores = preferences.filter((p) => p.type === 'ignore').map((p) => p.keyword);

    let preferencesText = '';
    if (interests.length > 0) {
      preferencesText += `\n用户感兴趣的主题: ${interests.join(', ')}`;
    }
    if (ignores.length > 0) {
      preferencesText += `\n用户不感兴趣的主题: ${ignores.join(', ')}`;
    }

    const articlesText = articles
      .map(
        (a, i) =>
          `[${i + 1}] ID:${a.id}\n标题: ${a.title}\n内容摘要: ${(a.content || '').slice(0, 500)}...`
      )
      .join('\n\n');

    return `你是一个 RSS 文章过滤助手。请分析以下文章，判断每篇文章是否值得用户阅读。
${preferencesText}

请为每篇文章提供以下 JSON 格式的结果:
{
  "results": [
    {
      "id": <文章ID>,
      "interesting": <true/false>,
      "reason": "<简短说明为什么有趣或不有趣>"
    }
  ]
}

文章列表:

${articlesText}

请只返回 JSON 格式的结果，不要有其他内容。`;
  }

  async filterArticles(articles: Article[]): Promise<FilterResult[]> {
    if (articles.length === 0) return [];

    const client = this.getClient();
    const model = this.getModel();

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: this.buildFilterPrompt(articles),
        },
      ],
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content || '{}';

    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        results: { id: number; interesting: boolean; reason: string }[];
      };

      return parsed.results.map((r) => ({
        articleId: r.id,
        isInteresting: r.interesting,
        reason: r.reason,
      }));
    } catch (error) {
      throw new Error(`Failed to parse LLM response: ${(error as Error).message}`);
    }
  }

  async summarizeArticle(article: Article): Promise<string> {
    const client = this.getClient();
    const model = this.getModel();

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: `请为以下文章生成一个简洁的中文摘要（100-200字），包含主要观点和关键信息：

标题: ${article.title}

内容:
${article.content || '(无内容)'}

请只返回摘要内容，不要有其他说明。`,
        },
      ],
      temperature: 0.3,
    });

    return response.choices[0]?.message?.content || '无法生成摘要';
  }

  async analyzeArticles(
    articles: Article[],
    withSummary = false
  ): Promise<AnalysisResult[]> {
    // First, filter articles
    const filterResults = await this.filterArticles(articles);
    const results: AnalysisResult[] = [];

    for (const filter of filterResults) {
      const article = articles.find((a) => a.id === filter.articleId);
      if (!article) continue;

      let summary: string | undefined;

      // Generate summary for interesting articles if requested
      if (withSummary && filter.isInteresting) {
        try {
          summary = await this.summarizeArticle(article);
        } catch {
          // Ignore summary errors
        }
      }

      // Save to database
      cacheService.updateArticleAnalysis(
        filter.articleId,
        filter.isInteresting,
        filter.reason,
        summary
      );

      results.push({
        ...filter,
        summary,
      });
    }

    return results;
  }
}

export const llmService = new LlmService();
