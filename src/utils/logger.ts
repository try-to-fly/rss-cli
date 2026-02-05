import chalk from 'chalk';

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'debug';

class Logger {
  private debugMode = false;

  setDebug(enabled: boolean): void {
    this.debugMode = enabled;
  }

  info(message: string): void {
    console.log(chalk.blue('ℹ'), message);
  }

  success(message: string): void {
    console.log(chalk.green('✓'), message);
  }

  warn(message: string): void {
    console.log(chalk.yellow('⚠'), message);
  }

  error(message: string): void {
    console.error(chalk.red('✗'), message);
  }

  debug(message: string): void {
    if (this.debugMode) {
      console.log(chalk.gray('[DEBUG]'), message);
    }
  }

  table(data: Record<string, unknown>[]): void {
    console.table(data);
  }
}

export const logger = new Logger();
