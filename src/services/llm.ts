import { cacheService } from './cache.js';
import { convert } from 'html-to-text';
import type { Article } from '../models/article.js';
import type { SummaryWithResources, ExtractedResource, Resource, ResourceInput } from '../models/resource.js';

// HTML 转纯文本
function htmlToPlainText(html: string): string {
  if (!html) return '';
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
    ],
  });
}

// 直接从环境变量读取 LLM 配置
function getLlmConfig() {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;

  if (!apiKey) {
    throw new Error('LLM_API_KEY not set in .env');
  }
  if (!baseUrl) {
    throw new Error('LLM_BASE_URL not set in .env');
  }
  if (!model) {
    throw new Error('LLM_MODEL not set in .env');
  }

  return { apiKey, baseUrl, model };
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatResponse {
  id: string;
  choices: { message: { content: string }; finish_reason: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface FilterResult {
  articleId: number;
  isInteresting: boolean;
  reason: string;
}

export interface AnalysisResult extends FilterResult {
  summary?: string;
  resources?: ExtractedResource[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AnalysisProgress {
  phase: 'filter' | 'summarize';
  current: number;
  total: number;
  articleTitle?: string;
  tokens: TokenUsage;
  elapsedMs?: number;
}

export type ProgressCallback = (progress: AnalysisProgress) => void;

export class LlmService {
  private async chatCompletion(
    messages: ChatMessage[],
    tokenUsage?: TokenUsage
  ): Promise<string> {
    const config = getLlmConfig();
    const url = `${config.baseUrl}/chat/completions`;

    console.log(`[LLM] Calling ${url} with model ${config.model}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 120s timeout

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[LLM] HTTP Error ${response.status}: ${errorText}`);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json() as ChatResponse;

      console.log(`[LLM] Response received, tokens: ${data.usage?.total_tokens || 'unknown'}`);

      // Update token usage
      if (tokenUsage && data.usage) {
        tokenUsage.promptTokens += data.usage.prompt_tokens;
        tokenUsage.completionTokens += data.usage.completion_tokens;
        tokenUsage.totalTokens += data.usage.total_tokens;
      }

      return data.choices[0]?.message?.content || '';
    } catch (err) {
      clearTimeout(timeout);
      if ((err as Error).name === 'AbortError') {
        console.error('[LLM] Request timeout after 120s');
        throw new Error('Request timeout');
      }
      console.error('[LLM] Fetch error:', (err as Error).message);
      throw err;
    }
  }

  private getModel(): string {
    return getLlmConfig().model;
  }

  private buildFilterPrompt(articles: Article[]): string {
    const preferences = cacheService.getAllPreferences();
    const interests = preferences.filter((p) => p.type === 'interest').map((p) => p.keyword);
    const ignores = preferences.filter((p) => p.type === 'ignore').map((p) => p.keyword);

    let preferencesText = '';
    if (interests.length > 0) {
      preferencesText += `\n用户特别感兴趣的主题: ${interests.join(', ')}`;
    }
    if (ignores.length > 0) {
      preferencesText += `\n用户明确不感兴趣的主题: ${ignores.join(', ')}`;
    }

    const articlesText = articles
      .map(
        (a, i) =>
          `[${i + 1}] ID:${a.id}\n标题: ${a.title}\n内容摘要: ${(a.content || '').slice(0, 1500)}...`
      )
      .join('\n\n');

    return `你是一个技术导向的 RSS 文章过滤助手。请分析以下文章，判断每篇文章是否对技术人员有价值。
${preferencesText}

## 评判标准

### 高价值内容（标记 interesting: true）:
- 开发工具、库、框架的发布或重大更新
- GitHub 热门项目介绍
- 编程语言新特性、版本更新
- 技术架构设计、最佳实践分享
- AI/ML 工具和应用实践
- 云原生、DevOps 技术文章
- 性能优化、安全实践
- 深度技术分析文章
- 技术周刊/Newsletter（通常包含大量技术资源）

### 低价值内容（标记 interesting: false）:
- 纯营销广告、产品推广
- 公司新闻、招聘信息
- 非技术话题（生活、娱乐等）
- 过于基础的入门教程
- 重复或过时的内容
- 纯新闻报道（无技术深度）

请为每篇文章提供以下 JSON 格式的结果:
{
  "results": [
    {
      "id": <文章ID>,
      "interesting": <true/false>,
      "reason": "<简短说明判断理由>",
      "isNewsletter": <true/false>  // 是否为技术周刊/Newsletter类型
    }
  ]
}

文章列表:

${articlesText}

请只返回 JSON 格式的结果，不要有其他内容。`;
  }

  async filterArticles(
    articles: Article[],
    onProgress?: ProgressCallback,
    tokenUsage?: TokenUsage
  ): Promise<(FilterResult & { isNewsletter?: boolean })[]> {
    if (articles.length === 0) return [];

    onProgress?.({
      phase: 'filter',
      current: 0,
      total: articles.length,
      tokens: tokenUsage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });

    const content = await this.chatCompletion(
      [{ role: 'user', content: this.buildFilterPrompt(articles) }],
      tokenUsage
    );

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[LLM] No JSON found in response:', content.slice(0, 200));
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        results: { id: number; interesting: boolean; reason: string; isNewsletter?: boolean }[];
      };

      return parsed.results.map((r) => ({
        articleId: r.id,
        isInteresting: r.interesting,
        reason: r.reason,
        isNewsletter: r.isNewsletter,
      }));
    } catch (error) {
      console.error('[LLM] Parse error:', (error as Error).message);
      throw new Error(`Failed to parse LLM response: ${(error as Error).message}`);
    }
  }

  async mergeResourceDescriptions(
    resourceName: string,
    resourceType: string,
    existingDescription: string,
    newDescription: string
  ): Promise<string> {
    const prompt = `你是一个技术资源描述整合助手。请将以下两个关于同一技术资源的描述合并成一个更完整的描述。

资源名称: ${resourceName}
资源类型: ${resourceType}

描述1: ${existingDescription}
描述2: ${newDescription}

要求:
- 整合两个描述的关键信息
- 去除重复内容
- 保持简洁（50-150字）
- 保持客观准确

只返回合并后的描述文本，不要有其他内容。`;

    const content = await this.chatCompletion([{ role: 'user', content: prompt }]);
    return content.trim() || existingDescription;
  }

  async addOrUpdateResourceWithMerge(input: ResourceInput): Promise<Resource> {
    const existing = cacheService.getResourceByNameAndType(input.name, input.type);

    if (existing) {
      // 检查是否需要合并描述
      const existingDesc = existing.description || '';
      const newDesc = input.description || '';

      // 只在新旧描述都有内容且内容不同时才调用 LLM 合并
      if (existingDesc && newDesc && existingDesc !== newDesc) {
        console.log(`[LLM] Merging descriptions for resource: ${input.name}`);
        try {
          const mergedDescription = await this.mergeResourceDescriptions(
            input.name,
            input.type,
            existingDesc,
            newDesc
          );
          cacheService.updateResourceDescription(existing.id, mergedDescription);
        } catch (err) {
          console.error('[LLM] Failed to merge descriptions:', (err as Error).message);
          // 合并失败时保留原描述
        }
      }

      // 增加提及次数
      cacheService.incrementResourceMentionCount(existing.id);

      // 更新其他字段（URL、GitHub URL、tags）
      return cacheService.addOrUpdateResource(input);
    }

    // 资源不存在，直接创建
    return cacheService.addOrUpdateResource(input);
  }

  async summarizeArticle(article: Article): Promise<string> {
    const content = await this.chatCompletion([
      {
        role: 'user',
        content: `请为以下文章生成一个简洁的中文摘要（100-200字），包含主要观点和关键信息：

标题: ${article.title}

内容:
${article.content || '(无内容)'}

请只返回摘要内容，不要有其他说明。`,
      },
    ]);

    return content || '无法生成摘要';
  }

  async summarizeAndExtractResources(
    article: Article,
    isNewsletter = false,
    tokenUsage?: TokenUsage
  ): Promise<SummaryWithResources> {
    const newsletterNote = isNewsletter
      ? `
注意：这是一篇技术周刊/Newsletter，通常包含大量技术资源。请尽可能完整地提取所有提到的工具、库、项目等资源。`
      : '';

    // 优先使用纯文本快照，否则使用原始内容
    const maxContentLength = 8000;
    const rawContent = article.text_snapshot || article.content || '(无内容)';
    const truncatedContent = rawContent.length > maxContentLength
      ? rawContent.slice(0, maxContentLength) + '...(内容已截断)'
      : rawContent;

    const prompt = `请分析以下技术文章，生成摘要并提取其中提到的技术资源。
${newsletterNote}

标题: ${article.title}

内容:
${truncatedContent}

请返回以下 JSON 格式：
{
  "summary": "文章摘要（100-200字，中文）",
  "keyPoints": ["关键点1", "关键点2", ...],  // 3-5个关键点
  "articleTags": ["标签1", "标签2", ...],  // 3-8个文章标签，用于分类和检索
  "resources": [
    {
      "name": "资源名称",
      "type": "tool|library|framework|project|service|other",
      "url": "主要链接（如有）",
      "github_url": "GitHub地址（如有）",
      "description": "简短描述",
      "tags": ["标签1", "标签2"],
      "relevance": "main|mentioned|compared",  // main=文章主角, mentioned=提及, compared=对比
      "context": "提及上下文（简短）"
    }
  ]
}

文章标签说明（articleTags）：
- 提取3-8个能代表文章主题的标签
- 标签应该是小写英文，如: javascript, react, ai, devops, performance
- 包含技术领域、编程语言、框架、主题等

资源类型说明：
- tool: 开发工具（IDE、CLI工具、构建工具等）
- library: 代码库（npm包、pip包等）
- framework: 框架（React、Vue、Django等）
- project: 开源项目（GitHub项目）
- service: 服务/平台（云服务、API服务等）
- other: 其他技术资源

请只返回 JSON，不要有其他内容。`;

    const responseContent = await this.chatCompletion(
      [{ role: 'user', content: prompt }],
      tokenUsage
    );

    try {
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[LLM] No JSON in summarize response:', responseContent.slice(0, 200));
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as SummaryWithResources;
      return {
        summary: parsed.summary || '无法生成摘要',
        keyPoints: parsed.keyPoints || [],
        resources: parsed.resources || [],
        articleTags: parsed.articleTags || [],
      };
    } catch (error) {
      console.error('[LLM] Parse summarize error:', (error as Error).message);
      return {
        summary: '无法解析摘要',
        keyPoints: [],
        resources: [],
        articleTags: [],
      };
    }
  }

  async analyzeArticles(
    articles: Article[],
    withSummary = false,
    onProgress?: ProgressCallback
  ): Promise<AnalysisResult[]> {
    const tokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // 为所有文章生成并保存纯文本快照（如果还没有）
    for (const article of articles) {
      if (!article.text_snapshot && article.content) {
        const plainText = htmlToPlainText(article.content);
        cacheService.saveArticleSnapshot(article.id, plainText);
        article.text_snapshot = plainText;
      }
    }

    // First, filter articles
    const filterResults = await this.filterArticles(articles, onProgress, tokenUsage);
    const results: AnalysisResult[] = [];

    const interestingArticles = filterResults.filter((f) => f.isInteresting);
    let summarizedCount = 0;

    for (const filter of filterResults) {
      const article = articles.find((a) => a.id === filter.articleId);
      if (!article) continue;

      let summary: string | undefined;
      let resources: ExtractedResource[] | undefined;

      // Generate summary and extract resources for interesting articles if requested
      if (withSummary && filter.isInteresting) {
        summarizedCount++;
        onProgress?.({
          phase: 'summarize',
          current: summarizedCount,
          total: interestingArticles.length,
          articleTitle: article.title.slice(0, 50),
          tokens: tokenUsage,
        });

        try {
          const result = await this.summarizeAndExtractResources(
            article,
            filter.isNewsletter,
            tokenUsage
          );
          summary = result.summary;
          resources = result.resources;

          // 保存文章标签
          if (result.articleTags && result.articleTags.length > 0) {
            for (const tagName of result.articleTags) {
              const tag = cacheService.getOrCreateTag(tagName, 'topic');
              cacheService.linkArticleTag({
                article_id: article.id,
                tag_id: tag.id,
                source: 'llm',
                confidence: 1.0,
              });
            }
          }

          // Save resources to database with smart description merging
          for (const res of result.resources) {
            const savedResource = await this.addOrUpdateResourceWithMerge({
              name: res.name,
              type: res.type,
              url: res.url,
              github_url: res.github_url,
              description: res.description,
              tags: res.tags,
            });

            cacheService.linkArticleResource({
              article_id: article.id,
              resource_id: savedResource.id,
              context: res.context,
              relevance: res.relevance,
            });

            // 将资源的标签也保存到规范化的 resource_tags 表
            if (res.tags && res.tags.length > 0) {
              for (const tagName of res.tags) {
                const tag = cacheService.getOrCreateTag(tagName, 'tech');
                cacheService.linkResourceTag(savedResource.id, tag.id);
              }
            }
          }
        } catch (err) {
          console.error('[LLM Error]', (err as Error).message);
          // Fallback to simple summary
          try {
            summary = await this.summarizeArticle(article);
          } catch (err2) {
            console.error('[LLM Summary Error]', (err2 as Error).message);
          }
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
        resources,
      });
    }

    return results;
  }
}

export const llmService = new LlmService();
