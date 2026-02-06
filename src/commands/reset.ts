import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline';
import { cacheService } from '../services/cache.js';

export function createResetCommand(): Command {
  return new Command('reset')
    .description('清理所有数据（保留 RSS 源配置）')
    .option('-y, --yes', '跳过确认提示')
    .action(async (options) => {
      if (!options.yes) {
        console.log(chalk.yellow('警告：此操作将清理以下数据：'));
        console.log('  - 所有文章 (articles)');
        console.log('  - 所有标签 (tags, article_tags)');
        console.log('  - 所有资源 (resources, article_resources, resource_tags)');
        console.log('  - 用户偏好 (user_preferences)');
        console.log(chalk.green('保留：RSS 源配置 (feeds)'));

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>(resolve => {
          rl.question('确认清理？(y/N) ', resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('已取消');
          return;
        }
      }

      cacheService.resetData();
      console.log(chalk.green('✓ 数据已清理，RSS 源配置已保留'));
    });
}
