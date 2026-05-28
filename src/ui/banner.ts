import chalk from 'chalk';

export const showWelcomeBanner = (version: string) => {
  const banner = `
  ${chalk.cyan('██╗  ██╗██████╗ ███╗   ███╗')}
  ${chalk.cyan('██║ ██╔╝██╔══██╗████╗ ████║')}
  ${chalk.cyan('█████╔╝ ██║  ██║██╔████╔██║')}
  ${chalk.cyan('██╔═██╗ ██║  ██║██║╚██╔╝██║')}
  ${chalk.cyan('██║  ██╗██████╔╝██║ ╚═╝ ██║')}
  ${chalk.cyan('╚═╝  ╚═╝╚═════╝ ╚═╝     ╚═╝')}
  `;

  const signature = chalk.gray(
    '──────────────────────────────────────────────────'
  );
  
  console.log(banner);
  console.log(signature);
  console.log(chalk.blue.bold(`  Kubernetes & Docker Monitor v${version}`));
};
