import chalk from 'chalk';

export const showWelcomeBanner = (version: string) => {
  const banner = chalk.white(`
  ╔══════════════════════════════════════╗
  ║    _  _____ __  ___   _    __       ║
  ║   / |/ / _ / / / _ ) / |  / /       ║
  ║  /    / __/ _ \\ _  \\/  | / /__     ║
  ║ /_/|_/____/_//_/___/_/|_/____/      ║
  ╚══════════════════════════════════════╝
  `);

  const signature = chalk.gray(
    '──────────────────────────────────────────────────'
  );
  
  console.log(banner);
  console.log(signature);
  console.log(chalk.blue.bold(`  Kubernetes & Docker Monitor v${version}`));
};
