import chalk from 'chalk';

export const logger = {
  info: (message: string) => console.log(chalk.blue(message)),
  success: (message: string) => console.log(chalk.green(`✔ ${message}`)),
  warn: (message: string) => console.error(chalk.yellow(`⚠ ${message}`)),
  error: (message: string, error?: unknown) => {
    console.error(chalk.red(`✖ ${message}`));
    if (error) {
      console.error(error);
    }
  },
  dim: (message: string) => console.log(chalk.dim(message)),
  newline: () => console.log(),
};
