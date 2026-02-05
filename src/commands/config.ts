import { Command } from 'commander';
import chalk from 'chalk';
import { getConfig, setConfig, deleteConfig, getAllConfig } from '../utils/config.js';
import { cacheService } from '../services/cache.js';
import { logger } from '../utils/logger.js';
import { CONFIG_KEYS } from '../models/config.js';

export function createConfigCommand(): Command {
  const config = new Command('config').description('配置管理');

  config
    .command('set')
    .description('设置配置项')
    .argument('<key>', '配置键')
    .argument('<value>', '配置值')
    .option('--json', 'Output as JSON')
    .action((key: string, value: string, options) => {
      setConfig(key, value);

      if (options.json) {
        console.log(JSON.stringify({ success: true, key, value }));
      } else {
        logger.success(`Configuration set: ${key} = ${value}`);
      }
    });

  config
    .command('get')
    .description('获取配置项')
    .argument('<key>', '配置键')
    .option('--json', 'Output as JSON')
    .action((key: string, options) => {
      const value = getConfig(key);

      if (options.json) {
        console.log(JSON.stringify({ key, value }));
      } else if (value !== null) {
        console.log(`${key} = ${value}`);
      } else {
        logger.warn(`Configuration not found: ${key}`);
      }
    });

  config
    .command('delete')
    .description('删除配置项')
    .argument('<key>', '配置键')
    .option('--json', 'Output as JSON')
    .action((key: string, options) => {
      const success = deleteConfig(key);

      if (options.json) {
        console.log(JSON.stringify({ success }));
      } else if (success) {
        logger.success(`Configuration deleted: ${key}`);
      } else {
        logger.warn(`Configuration not found: ${key}`);
      }
    });

  config
    .command('list')
    .description('列出所有配置项')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const configs = getAllConfig();

      if (options.json) {
        console.log(JSON.stringify(configs));
        return;
      }

      if (configs.length === 0) {
        logger.info('No configurations found');
        console.log();
        console.log(chalk.dim('Available configuration keys:'));
        for (const [name, key] of Object.entries(CONFIG_KEYS)) {
          console.log(chalk.dim(`  ${name}: ${key}`));
        }
        return;
      }

      console.log();
      console.log(chalk.bold('Configurations:'));
      console.log();

      for (const cfg of configs) {
        // Mask sensitive values
        const displayValue =
          cfg.key.includes('key') || cfg.key.includes('secret')
            ? cfg.value.slice(0, 8) + '...'
            : cfg.value;
        console.log(`  ${chalk.cyan(cfg.key)} = ${displayValue}`);
      }
      console.log();
    });

  return config;
}

export function createPrefCommand(): Command {
  const pref = new Command('pref').description('用户偏好管理');

  pref
    .command('add')
    .description('添加偏好关键词')
    .argument('<keyword>', '要添加的关键词')
    .requiredOption('-t, --type <type>', '类型: interest 或 ignore')
    .option('-w, --weight <n>', '权重（重要程度）', '1')
    .option('--json', 'Output as JSON')
    .action((keyword: string, options) => {
      if (!['interest', 'ignore'].includes(options.type)) {
        logger.error('Type must be "interest" or "ignore"');
        return;
      }

      const pref = cacheService.addPreference(
        options.type as 'interest' | 'ignore',
        keyword,
        parseInt(options.weight, 10)
      );

      if (options.json) {
        console.log(JSON.stringify(pref));
      } else {
        logger.success(`Preference added: ${pref.type} - ${pref.keyword}`);
      }
    });

  pref
    .command('list')
    .description('列出所有偏好设置')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const prefs = cacheService.getAllPreferences();

      if (options.json) {
        console.log(JSON.stringify(prefs));
        return;
      }

      if (prefs.length === 0) {
        logger.info('No preferences found. Use "rss pref add <keyword> --type <interest|ignore>" to add one.');
        return;
      }

      console.log();
      console.log(chalk.bold('User Preferences:'));
      console.log();

      const interests = prefs.filter((p) => p.type === 'interest');
      const ignores = prefs.filter((p) => p.type === 'ignore');

      if (interests.length > 0) {
        console.log(chalk.green('Interests:'));
        for (const p of interests) {
          console.log(`  ${chalk.cyan(p.id.toString().padStart(3))} ${p.keyword} (weight: ${p.weight})`);
        }
        console.log();
      }

      if (ignores.length > 0) {
        console.log(chalk.red('Ignore:'));
        for (const p of ignores) {
          console.log(`  ${chalk.cyan(p.id.toString().padStart(3))} ${p.keyword} (weight: ${p.weight})`);
        }
        console.log();
      }
    });

  pref
    .command('remove')
    .description('移除偏好设置')
    .argument('<id>', '偏好设置 ID')
    .option('--json', 'Output as JSON')
    .action((id: string, options) => {
      const success = cacheService.removePreference(parseInt(id, 10));

      if (options.json) {
        console.log(JSON.stringify({ success }));
      } else if (success) {
        logger.success(`Preference removed: ${id}`);
      } else {
        logger.error(`Preference not found: ${id}`);
      }
    });

  return pref;
}
