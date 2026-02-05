import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { rssService } from "../services/rss.js";
import { llmService, type ProgressCallback } from "../services/llm.js";
import { cacheService } from "../services/cache.js";
import { exportAnalyzedArticles, EXPORTS_DIR } from "../services/export.js";
import { logger } from "../utils/logger.js";

export function createRunCommand(): Command {
  const run = new Command("run")
    .description("更新订阅源、分析文章并显示有趣的内容")
    .option("-d, --days <n>", "分析最近 N 天的文章", "3")
    .option(
      "-s, --summary",
      "为有趣的文章生成摘要",
      true,
    )
    .option(
      "-f, --force",
      "强制重新分析所有文章（忽略之前的分析结果）",
    )
    .option("--skip-update", "跳过订阅源更新")
    .option("--skip-analyze", "跳过 LLM 分析")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const results: {
        updated?: Record<string, { newCount: number; error?: string }>;
        analyzed?: { total: number; interesting: number };
        articles?: unknown[];
      } = {};

      try {
        // Step 1: Update feeds
        if (!options.skipUpdate) {
          const spinner = ora("Updating feeds...").start();
          const updateResults = await rssService.updateAllFeeds();

          let totalNew = 0;
          const updateOutput: Record<
            string,
            { newCount: number; error?: string }
          > = {};

          for (const [name, result] of updateResults) {
            updateOutput[name] = result;
            totalNew += result.newCount;
          }

          results.updated = updateOutput;
          spinner.succeed(`Feeds updated: ${totalNew} new articles`);
        }

        // Step 2: Analyze with LLM (if configured)
        if (!options.skipAnalyze) {
          const hasLlmKey = process.env.OPENAI_API_KEY;

          if (hasLlmKey) {
            const spinner = ora("Analyzing articles with LLM...").start();
            const days = parseInt(options.days, 10);

            // Get articles to analyze
            let articles;
            if (options.force) {
              // Force mode: get all articles from the period
              articles = cacheService.getArticles({ days, limit: 500 });
              spinner.text = `Force re-analyzing ${articles.length} articles...`;
            } else {
              // Normal mode: only unanalyzed articles
              articles = cacheService.getUnanalyzedArticles(undefined, days);
            }

            if (articles.length > 0) {
              let lastProgress: {
                phase: string;
                current: number;
                total: number;
                title: string;
                tokens: number;
              } = {
                phase: "filter",
                current: 0,
                total: articles.length,
                title: "",
                tokens: 0,
              };
              const startTime = Date.now();

              // Timer to show elapsed time
              const updateSpinner = () => {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                const timeStr = `${elapsed}s`;
                const tokenInfo = `[${lastProgress.tokens} tokens | ${timeStr}]`;

                if (lastProgress.phase === "filter") {
                  spinner.text = `过滤文章中... ${tokenInfo}`;
                } else {
                  const title = lastProgress.title
                    ? ` "${lastProgress.title}..."`
                    : "";
                  spinner.text = `摘要生成 (${lastProgress.current}/${lastProgress.total})${title} ${tokenInfo}`;
                }
              };

              const timer = setInterval(updateSpinner, 1000);

              // Progress callback to update spinner
              const onProgress: ProgressCallback = (progress) => {
                lastProgress = {
                  phase: progress.phase,
                  current: progress.current,
                  total: progress.total,
                  title: progress.articleTitle?.slice(0, 40) || "",
                  tokens: progress.tokens.totalTokens,
                };
                updateSpinner();
              };

              try {
                const analysisResults = await llmService.analyzeArticles(
                  articles,
                  options.summary,
                  onProgress,
                );
                const interestingCount = analysisResults.filter(
                  (r) => r.isInteresting,
                ).length;

                results.analyzed = {
                  total: articles.length,
                  interesting: interestingCount,
                };

                spinner.succeed(
                  `Analyzed ${articles.length} articles: ${interestingCount} interesting`,
                );
              } finally {
                clearInterval(timer);
              }
            } else {
              spinner.info("No unanalyzed articles found");
              results.analyzed = { total: 0, interesting: 0 };
            }
          } else {
            if (!options.json) {
              logger.warn(
                "LLM not configured. Skipping analysis. Use: rss config set openai_api_key <key>",
              );
            }
          }
        }

        // Step 3: Export analyzed articles
        const days = parseInt(options.days, 10);

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
