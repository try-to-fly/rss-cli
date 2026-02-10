import { cacheService } from './cache.js';
import { convert } from 'html-to-text';
import type { Article } from '../models/article.js';
import type { SummaryWithResources, ExtractedResource, Resource, ResourceInput } from '../models/resource.js';
import { getConfig } from '../utils/config.js';
import { CONFIG_KEYS } from '../models/config.js';

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

// 标准化资源名称
function normalizeResourceName(name: string): string {
  // 移除公司名后缀
  const patterns = [
    /\s*\(Anthropic\)$/i,
    /\s*\(Google\)$/i,
    /\s*\(OpenAI\)$/i,
    /\s*\(Microsoft\)$/i,
    /\s*\(Meta\)$/i,
    /\s*\(Facebook\)$/i,
    /\s*\(Amazon\)$/i,
    /\s*\(Apple\)$/i,
    /\s*\(Netflix\)$/i,
    /\s*\(Vercel\)$/i,
    /\s*\(GitHub\)$/i,
    /\s*by\s+\w+$/i,
  ];
  let normalized = name.trim();
  for (const pattern of patterns) {
    normalized = normalized.replace(pattern, '');
  }
  return normalized.trim();
}

// 直接从环境变量读取 LLM 配置
function getLlmConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_API_BASE;
  const model = getConfig(CONFIG_KEYS.LLM_MODEL);

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set in .env');
  }
  if (!baseUrl) {
    throw new Error('OPENAI_API_BASE not set in .env');
  }

  return { apiKey, baseUrl, model: model! };
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

      const error = err as Error;
      let detailedMessage = error.message;

      // 提取 Node.js fetch 底层错误详情
      if ('cause' in error && error.cause) {
        const cause = error.cause as { code?: string; message?: string };
        if (cause.code) {
          detailedMessage += ` (${cause.code})`;
        }
        if (cause.message && cause.message !== error.message) {
          detailedMessage += `: ${cause.message}`;
        }
      }

      console.error('[LLM] Fetch error:', detailedMessage);
      throw new Error(`LLM request failed: ${detailedMessage}`);
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
- AI/ML 工具和应用实践（包含技术细节的案例）
- 云原生、DevOps 技术文章
- 性能优化、安全实践
- 深度技术分析文章
- 技术周刊/Newsletter（通常包含大量技术资源）
- 独立开发者/创业者的技术实践分享（有技术细节）
- 开源项目的开发历程与技术决策
- 安全漏洞、事件响应与修复指南

### 低价值内容（标记 interesting: false）:
- 纯营销广告、产品推广（无任何技术细节）
- 公司新闻、招聘信息、并购交易
- 非技术话题（生活、娱乐、消费电子评测）
- 过于基础的入门教程（面向完全初学者）
- 重复或过时的内容
- 纯新闻报道（无技术深度）
- 产品发布传闻、价格促销信息
- **注意：如果文章包含技术实现细节，即使是产品介绍也应标记为有趣**

### 边界案例处理
- **内容不完整的文章**（只有标题或很短的摘要）：
  - 如果标题明确表明是技术更新/发布（如"XXX 9.0"、"XXX released"）→ interesting: true
  - 如果标题模糊或偏向新闻报道（如"公司 A 收购公司 B"）→ interesting: false
  - 如果无法判断 → interesting: false（宁可漏掉也不要误判）

### 判断理由要求
- 理由应该简短（20-50字）
- 理由应该具体说明为什么有趣或不感兴趣
- 避免使用模糊的表述（如"可能有价值"、"不确定"）
- 示例：
  - ✅ "软件版本发布：Ardour 9.0 更新对音频软件开发/工具用户有价值，通常包含新特性与变更。"
  - ✅ "AI 图片增强应用推广/介绍，缺少算法/实现细节。"
  - ❌ "这篇文章可能对技术人员有一定参考价值。"

请为每篇文章提供以下 JSON 格式的结果:
{
  "results": [
    {
      "id": <文章ID>,
      "interesting": <true/false>,
      "reason": "<简短说明判断理由（20-50字）>",
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
    // 标准化资源名称
    const normalizedName = normalizeResourceName(input.name);
    const normalizedInput = { ...input, name: normalizedName };

    const existing = cacheService.getResourceByNameAndType(normalizedName, input.type);

    if (existing) {
      // 检查是否需要合并描述
      const existingDesc = existing.description || '';
      const newDesc = input.description || '';

      // 只在新旧描述都有内容且内容不同时才调用 LLM 合并
      if (existingDesc && newDesc && existingDesc !== newDesc) {
        console.log(`[LLM] Merging descriptions for resource: ${normalizedName}`);
        try {
          const mergedDescription = await this.mergeResourceDescriptions(
            normalizedName,
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
      return cacheService.addOrUpdateResource(normalizedInput);
    }

    // 资源不存在，直接创建
    return cacheService.addOrUpdateResource(normalizedInput);
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

## 摘要质量要求

1. **长度**：严格控制在 100-200 字之间
2. **结构**：
   - 第一句：文章主题/背景（20-30字）
   - 核心内容：技术细节/关键点（60-120字）
   - 最后一句：意义/价值（20-30字）
3. **必须包含**：
   - 具体的技术名称（如 React、Docker、Claude）
   - 版本号（如有，如 "9.0"、"v2.0"）
   - 关键特性或改进点
4. **避免**：
   - 空泛描述（如"介绍了一个工具"、"讨论了某个话题"）
   - 重复标题内容
   - 无意义的总结（如"值得关注"、"很有价值"）
   - 元信息（如"本文由 AI 生成"、"你看到的内容可能..."）

## 内容预处理

在生成摘要前，请过滤掉以下内容：
- AI 生成声明（如"这是一个可以快速检测..."、"你看到的内容可能由第三方 AI..."）
- 版权声明、免责声明
- 广告信息、推广链接
- 评论链接（如"<a href=...>Comments</a>"）
- HTML 标签和属性

## 内容完整性处理

如果文章内容不完整（只有标题或很短的摘要）：
1. 基于标题和已有信息推断文章主题
2. 生成一个简短的推测性摘要，格式为："【基于标题】+ 推测内容"
3. keyPoints 可以为空数组
4. resources 只提取能从标题明确识别的资源
5. 不要生成"无法提取"或"内容不完整"这类无效摘要

## 资源提取规范

1. **数量限制**：
   - 普通文章：最多提取 10 个资源
   - 技术周刊/Newsletter：最多提取 20 个资源
   - 优先提取 relevance 为 "main" 的资源

2. **名称标准化**：
   - 使用资源的官方/标准名称
   - 去除公司/组织后缀：
     * "Claude by Anthropic" → "Claude"
     * "GitHub Copilot by GitHub" → "GitHub Copilot"
   - 去除版本号：
     * "Python 3.12" → "Python"（版本号放在描述中）
   - 去除冗余词汇：
     * "飞牛下载中心" → "FNOS"
     * "在线视频压缩工具" → "在线视频压缩"

3. **过滤规则**：
   - 不要将文章来源链接作为资源
   - 不要提取通用概念（如 "AI"、"机器学习"、"云计算"）
   - 不要提取公司名称（除非是技术产品名）
   - 不要提取人名、作者名
   - 只提取具体的工具、库、框架、项目、服务

4. **去重原则**：
   - 同一资源只提取一次
   - 如果不确定是否为同一资源，宁可不提取

## 文章标签说明（articleTags）

1. **数量**：严格要求 3-8 个标签
2. **层级**：
   - 技术领域（1-2个）：frontend, backend, devops, ai, database, security, networking
   - 编程语言（0-2个）：javascript, python, rust, go, java, typescript
   - 框架/工具（1-3个）：react, nextjs, docker, kubernetes, postgresql
   - 主题（1-2个）：performance, security, architecture, testing, monitoring
3. **格式**：
   - 小写英文
   - 用连字符连接多个单词（如 machine-learning, static-site-generator）
4. **标准化**：
   - js → javascript
   - ts → typescript
   - ai/artificial-intelligence → ai
   - ml/machine-learning → machine-learning
5. **避免**：
   - 过于宽泛（tech, programming, software, development）
   - 过于具体（react-hooks-useeffect, python-list-comprehension）
   - 重复或近义词（只保留一个，如 js 和 javascript 只用 javascript）

## 资源类型说明

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
          // 只保存 main 类型的资源，过滤掉 mentioned 和 compared 类型以减少噪音
          for (const res of result.resources) {
            if (res.relevance !== 'main') {
              continue;
            }
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

  async generateKnowledgePoints(
    articles: { title: string; summary?: string | null; feed_name: string; link?: string | null }[],
    days: number
  ): Promise<{ points: ({ text: string; url?: string } | string)[]; highlights: { name: string; desc: string; url?: string }[] }> {
    const articleSummaries = articles.map((a, i) =>
      `[${i + 1}] 标题: ${a.title}\n来源: ${a.feed_name}\n摘要: ${(a.summary || '').slice(0, 300)}\n链接: ${a.link || '无'}`
    ).join('\n\n');

    const prompt = `你是一个技术信息提炼专家。以下是最近 ${days} 天的 ${articles.length} 篇精选技术文章。

## 文章分类

请先识别每篇文章的类型：
1. **周刊/Newsletter 类**：汇总多个项目/工具/新闻，应拆解为多个独立知识点
2. **深度分析类**：详细讲解一个技术主题，应作为一个整体知识点概括

## 任务一：提炼知识点（10-15 条）

要求：
1. 每条知识点一句话，不超过 40 字
2. **周刊类文章**：拆解其中的独立项目/工具为单独知识点
3. **深度分析类文章**：整篇文章概括为一条知识点，突出核心观点
4. 跨文章去重——同一话题只保留一条（如多篇都提到 OpenClaw，合并为一条）
5. 包含具体信息（技术名称、版本号、关键特性）
6. 按重要性排序

## 任务二：挑选值得关注的项目/工具（3-5 个）

要求：
1. 必须是具体的项目/工具/库
2. 优先选择**新发布**或**有重大更新**的
3. 避免选择通用工具（如 GitHub、Node.js、VS Code）
4. 每个包含：名称、一句话描述（≤30字）、链接

## 文章列表

${articleSummaries}

## 输出格式

返回 JSON：
{
  "points": [
    { "text": "知识点（<=40字）", "url": "原文链接" }
  ],
  "highlights": [
    { "name": "项目名", "desc": "一句话描述", "url": "链接" }
  ]
}

只返回 JSON。`;

    try {
      const content = await this.chatCompletion([{ role: 'user', content: prompt }]);
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[LLM] No JSON found in knowledge points response');
        return { points: [], highlights: [] };
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        points: ({ text: string; url?: string } | string)[];
        highlights: { name: string; desc: string; url?: string }[];
      };

      // Backward compatibility: allow points to be string[]
      const points = (parsed.points || []).map((p) => {
        if (typeof p === 'string') return { text: p };
        return p;
      });

      return {
        // Return as string[] is handled by report generator; here we preserve structure in JSON
        // but TypeScript signature expects string[] (kept elsewhere). The caller will render.
        points: points as any,
        highlights: parsed.highlights || [],
      };
    } catch (error) {
      console.error('[LLM] Failed to parse knowledge points JSON:', (error as Error).message);
      return { points: [], highlights: [] };
    }
  }

  async generateBriefSummaries(
    articles: { id: number; title: string; summary?: string | null }[]
  ): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    if (articles.length === 0) return result;

    const articlesText = articles.slice(0, 15).map(a =>
      `[${a.id}] ${a.title}\n原摘要: ${a.summary?.slice(0, 200) || '无'}`
    ).join('\n\n');

    const prompt = `请为以下文章生成简短摘要，每篇 **30-50 字**，突出核心信息。

${articlesText}

返回 JSON 格式：
{
  "summaries": [
    { "id": <文章ID>, "brief": "30-50字简短摘要" }
  ]
}

只返回 JSON，不要其他内容。`;

    try {
      const content = await this.chatCompletion([{ role: 'user', content: prompt }]);
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[LLM] No JSON found in brief summaries response');
        return result;
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        summaries: { id: number; brief: string }[];
      };

      for (const item of parsed.summaries) {
        result.set(item.id, item.brief);
      }
    } catch (error) {
      console.error('[LLM] Failed to generate brief summaries:', (error as Error).message);
    }

    return result;
  }

  async generateKnowledgePointsFromResources(
    resources: { name: string; type: string; description: string | null; url: string | null; github_url: string | null }[],
    days: number
  ): Promise<{ points: { text: string; url?: string }[] }> {
    const resourceSummaries = resources.map((r, i) =>
      `[${i + 1}] ${r.name} (${r.type}): ${r.description || '无描述'}\n链接: ${r.url || r.github_url || '无'}`
    ).join('\n\n');

    const prompt = `你是一个技术信息提炼专家。以下是最近 ${days} 天发现的 ${resources.length} 个技术资源。

## 任务：提炼要点（5-10 条）

要求：
1. 每条要点一句话，不超过 40 字
2. 突出资源的核心价值和用途
3. 按重要性/实用性排序
4. 包含具体信息（技术名称、关键特性）

## 资源列表

${resourceSummaries}

## 输出格式

返回 JSON：
{
  "points": [
    { "text": "要点（<=40字）", "url": "资源链接" }
  ]
}

只返回 JSON。`;

    try {
      const content = await this.chatCompletion([{ role: 'user', content: prompt }]);
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[LLM] No JSON found in resource knowledge points response');
        return { points: [] };
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        points: { text: string; url?: string }[];
      };

      return { points: parsed.points || [] };
    } catch (error) {
      console.error('[LLM] Failed to parse resource knowledge points JSON:', (error as Error).message);
      return { points: [] };
    }
  }
}

export const llmService = new LlmService();
