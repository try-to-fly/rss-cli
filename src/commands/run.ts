import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import PQueue from "p-queue";
import { rssService } from "../services/rss.js";
import { llmService, type ProgressCallback, type TokenUsage } from "../services/llm.js";
import { cacheService } from "../services/cache.js";
import { scraperService } from "../services/scraper.js";
import { exportAnalyzedArticles, EXPORTS_DIR } from "../services/export.js";
import { logger } from "../utils/logger.js";
import type { Article } from "../models/article.js";
import type { Feed } from "../models/feed.js";

// 队列配置
const RSS_CONCURRENCY = 5;  // RSS 采集并发数
const LLM_CONCURRENCY = 1;  // LLM 分析并发数（API 通常有速率限制）

// 当前默认：尽量抓取每篇文章正文
function needsScraping(): boolean {
  return true;
}

export function createRunCommand(): Command {
  const run = new Command("run")
    .description("更新订阅源、分析文章并显示有趣的内容")
    .option("-d, --days <n>", "分析最近 N 天的文章", "3")
    .option("-s, --summary", "为有趣的文章生成摘要", true)
    .option("-f, --force", "强制重新分析所有文章（忽略之前的分析结果）")
    .option("--skip-update", "跳过订阅源更新")
    .option("--skip-analyze", "跳过 LLM 分析")
    .option("--skip-scrape", "跳过正文抓取")
    .option("--json", "Output as JSON")
    .option("--rss-concurrency <n>", "RSS 采集并发数", String(RSS_CONCURRENCY))
    .option("--llm-concurrency <n>", "LLM 分析并发数", String(LLM_CONCURRENCY))
    .action(async (options) => {
      const results: {
        updated?: Record<string, { newCount: number; error?: string }>;
        analyzed?: { total: number; interesting: number };
        articles?: unknown[];
      } = {};

      const rssConcurrency = parseInt(options.rssConcurrency, 10) || RSS_CONCURRENCY;
      const llmConcurrency = parseInt(options.llmConcurrency, 10) || LLM_CONCURRENCY;
      const days = parseInt(options.days, 10);
      const hasLlmKey = process.env.OPENAI_API_KEY;

      try {
        // 创建两个独立的队列
        const rssQueue = new PQueue({ concurrency: rssConcurrency });
        const llmQueue = new PQueue({ concurrency: llmConcurrency });

        // 状态追踪
        const updateOutput: Record<string, { newCount: number; error?: string }> = {};
        let totalNewArticles = 0;
        let rssCompleted = 0;
        let rssTotal = 0;
        let llmTotalArticles = 0;
        let llmAnalyzed = 0;
        let llmInteresting = 0;
        let llmPendingFeeds = 0;
        const tokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

        // Spinner 状态
        const spinner = ora("初始化...").start();
        const startTime = Date.now();

        const updateSpinnerText = () => {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const parts: string[] = [];

          if (!options.skipUpdate && rssTotal > 0) {
            const rssStatus = rssCompleted === rssTotal ? "✓" : `${rssCompleted}/${rssTotal}`;
            parts.push(`RSS: ${rssStatus} (+${totalNewArticles}篇)`);
          }

          if (!options.skipAnalyze && hasLlmKey && (llmTotalArticles > 0 || llmPendingFeeds > 0)) {
            const llmStatus = llmPendingFeeds > 0
              ? `${llmAnalyzed}篇 (队列:${llmPendingFeeds})`
              : `${llmAnalyzed}篇`;
            parts.push(`LLM: ${llmStatus} (${llmInteresting}篇有趣)`);
          }

          if (tokenUsage.totalTokens > 0) {
            parts.push(`${tokenUsage.totalTokens} tokens`);
          }

          if (parts.length > 0) {
            spinner.text = `${parts.join(" | ")} [${elapsed}s]`;
          }
        };

        const timer = setInterval(updateSpinnerText, 500);

        try {
          const feeds = cacheService.getAllFeeds();
          rssTotal = feeds.length;

          if (!options.skipUpdate) {
            spinner.text = `开始采集 ${rssTotal} 个订阅源...`;
          }

          // 流水线处理：RSS 采集完成后立即加入 LLM 队列
          const llmPromises: Promise<void>[] = [];

          const processRssFeed = async (feed: Feed) => {
            let newArticles: Article[] = [];

            // Step 1: RSS 采集
            if (!options.skipUpdate) {
              try {
                const newCount = await rssService.updateFeed(feed);
                updateOutput[feed.name] = { newCount };
                totalNewArticles += newCount;
              } catch (error) {
                updateOutput[feed.name] = {
                  newCount: 0,
                  error: (error as Error).message,
                };
              } finally {
                rssCompleted++;
                updateSpinnerText();
              }
            }

            // Step 2: 获取该 feed 的待分析文章（无论是否有新文章）
            if (!options.skipAnalyze && hasLlmKey) {
              if (options.force) {
                newArticles = cacheService.getArticles({ feedId: feed.id, days, limit: 100 });
              } else {
                newArticles = cacheService.getUnanalyzedArticles(feed.id, days);
              }
            }

            // Step 2.5: 对内容不完整的文章抓取正文
            if (newArticles.length > 0 && !options.skipScrape) {
              const articlesToScrape = newArticles.filter(
                a => a.link && needsScraping()
              );

              if (articlesToScrape.length > 0) {
                for (const article of articlesToScrape) {
                  try {
                    const scraped = await scraperService.fetchArticleContent(article.link!);
                    if (scraped?.textContent) {
                      cacheService.saveArticleSnapshot(article.id, scraped.textContent);
                      article.text_snapshot = scraped.textContent;
                    }
                  } catch (err) {
                    // 抓取失败不影响后续流程
                  }
                }
              }
            }

            // Step 3: 将文章加入 LLM 队列
            if (newArticles.length > 0 && !options.skipAnalyze && hasLlmKey) {
              llmTotalArticles += newArticles.length;
              llmPendingFeeds++;
              updateSpinnerText();

              const llmPromise = llmQueue.add(async () => {
                try {
                  const onProgress: ProgressCallback = (progress) => {
                    if (progress.phase === "summarize") {
                      // 更新 token 使用量
                      tokenUsage.promptTokens = progress.tokens.promptTokens;
                      tokenUsage.completionTokens = progress.tokens.completionTokens;
                      tokenUsage.totalTokens = progress.tokens.totalTokens;
                    }
                    updateSpinnerText();
                  };

                  const analysisResults = await llmService.analyzeArticles(
                    newArticles,
                    options.summary,
                    onProgress,
                  );

                  const interesting = analysisResults.filter((r) => r.isInteresting).length;
                  llmAnalyzed += newArticles.length;
                  llmInteresting += interesting;
                } catch (error) {
                  logger.error(`[LLM] ${feed.name}: ${(error as Error).message}`);
                } finally {
                  llmPendingFeeds--;
                  updateSpinnerText();
                }
              });

              llmPromises.push(llmPromise as Promise<void>);
            }
          };

          // 将所有 feed 加入 RSS 队列
          const rssPromises = feeds.map((feed) => rssQueue.add(() => processRssFeed(feed)));

          // 等待所有 RSS 采集完成
          await Promise.all(rssPromises);
          results.updated = updateOutput;

          // 等待所有 LLM 分析完成
          if (llmPromises.length > 0) {
            await Promise.all(llmPromises);
          }

          results.analyzed = {
            total: llmAnalyzed,
            interesting: llmInteresting,
          };

          if (!options.skipAnalyze && !hasLlmKey && !options.json) {
            logger.warn(
              "LLM not configured. Skipping analysis. Use: rss config set openai_api_key <key>",
            );
          }
        } finally {
          clearInterval(timer);
          // 关闭 scraper 浏览器
          await scraperService.close();
        }

        // 完成信息
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const summaryParts: string[] = [];

        if (!options.skipUpdate) {
          summaryParts.push(`采集完成: +${totalNewArticles}篇新文章`);
        }
        if (results.analyzed && results.analyzed.total > 0) {
          summaryParts.push(`分析完成: ${results.analyzed.interesting}/${results.analyzed.total}篇有趣`);
        }
        if (tokenUsage.totalTokens > 0) {
          summaryParts.push(`${tokenUsage.totalTokens} tokens`);
        }

        spinner.succeed(`${summaryParts.join(" | ")} [${elapsed}s]`);

        // Step 3: Export analyzed articles
        if (!options.json) {
          const exportSpinner = ora("Exporting articles...").start();
          const exportCount = exportAnalyzedArticles(days);
          exportSpinner.succeed(
            `Exported ${exportCount} articles to ${EXPORTS_DIR}`,
          );
        }

        // Step 4: Show interesting articles
        const interestingArticles = cacheService.getArticles({
          interesting: true,
          days,
          limit: 20,
        });

        results.articles = interestingArticles;

        if (options.json) {
          console.log(JSON.stringify(results));
          return;
        }

        // Display interesting articles
        console.log();
        console.log(
          chalk.bold.yellow(
            "═══════════════════════════════════════════════════════════════",
          ),
        );
        console.log(
          chalk.bold.yellow(
            "                     Interesting Articles                       ",
          ),
        );
        console.log(
          chalk.bold.yellow(
            "═══════════════════════════════════════════════════════════════",
          ),
        );
        console.log();

        if (interestingArticles.length === 0) {
          logger.info("No interesting articles found");
          return;
        }

        for (const article of interestingArticles) {
          const date = article.pub_date
            ? new Date(article.pub_date).toLocaleDateString()
            : "Unknown";

          console.log(chalk.green("►") + " " + chalk.bold(article.title));
          console.log(
            `  ${chalk.dim(`[${article.feed_name}]`)} ${chalk.dim(date)}`,
          );

          if (article.link) {
            console.log(`  ${chalk.blue(article.link)}`);
          }

          if (article.interest_reason) {
            console.log(
              `  ${chalk.yellow("为什么有趣:")} ${article.interest_reason}`,
            );
          }

          if (article.summary) {
            console.log(`  ${chalk.cyan("摘要:")} ${article.summary}`);
          }

          console.log();
        }

        console.log(chalk.dim(`共 ${interestingArticles.length} 篇有趣的文章`));
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: (error as Error).message }));
        } else {
          logger.error((error as Error).message);
        }
      }
    });

  return run;
}
