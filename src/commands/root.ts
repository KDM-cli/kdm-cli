import { program } from 'commander';
import chalk from 'chalk';
import { checkDockerConnection } from '../docker/client';
import { checkK8sConnection } from '../kubernetes/client';
import { checkMinikubeConnection } from '../minikube/client';
import { registerShowCommand } from './show';
import { registerHealthCommand } from './health';
import { registerWatchCommand } from './watch';
import { registerLogsCommand } from './logs';
import { registerConfigCommand } from './config';
import { logger } from '../utils/logger';
import { showWelcomeBanner } from '../ui/banner';
import { createSpinner } from '../ui/spinner';
import { checkForUpdates } from '../utils/version-check';

program
  .name('kdm')
  .description('Kubernetes and Docker Monitoring CLI')
  .version('1.1.0');

// Register modular commands
registerShowCommand(program);
registerHealthCommand(program);
registerWatchCommand(program);
registerLogsCommand(program);
registerConfigCommand(program);

const run = async () => {
  if (!process.argv.slice(2).length) {
    showWelcomeBanner('1.1.0');

    const spinner = createSpinner('Checking connections...').start();
    let hadError = false;
    try {
      const [dockerStatus, k8sStatus, minikubeStatus] = await Promise.all([
        checkDockerConnection(),
        checkK8sConnection(),
        checkMinikubeConnection()
      ]);
      spinner.stop('Connection check complete');
      console.log();

      const badge = (text: string, color: 'green' | 'red' | 'yellow') => {
        const styles = {
          green: chalk.bgGreen.black.bold,
          red: chalk.bgRed.white.bold,
          yellow: chalk.bgYellow.black.bold,
        };
        return styles[color](` ${text} `);
      };

      const dockerStr = dockerStatus.connected ? badge('CONNECTED', 'green') : badge('DISCONNECTED', 'red');
      const k8sStr = k8sStatus.connected ? badge('CONNECTED', 'green') : badge('DISCONNECTED', 'red');
      
      let minikubeStr = badge('NOT INSTALLED', 'red');
      if (minikubeStatus.installed) {
        minikubeStr = minikubeStatus.running ? badge('RUNNING', 'green') : badge('STOPPED', 'yellow');
      }

      console.log(`${chalk.bold('Docker:')}      ${dockerStr}`);
      console.log(`${chalk.bold('Kubernetes:')}  ${k8sStr}`);
      console.log(`${chalk.bold('Minikube:')}    ${minikubeStr}\n`);
      
      console.log(`${chalk.cyan('󰡨')} Running Containers: ${chalk.yellow.bold(dockerStatus.containerCount)}`);
      console.log(`${chalk.blue('󱔎')} Running Pods:       ${chalk.yellow.bold(k8sStatus.podCount)}`);
      console.log(`${chalk.red('󰒑')} Unhealthy Services: ${chalk.yellow.bold('0')} (Mocked)\n`);
      console.log(chalk.bold('Commands:\n'));
      console.log(`  kdm show runners\n  kdm health all\n  kdm watch\n  kdm logs <name>\n`);
    } catch (error) {
      hadError = true;
      spinner.fail(`Connection check failed: ${(error as Error).message}`);
    } finally {
      program.outputHelp();
      process.exit(hadError ? 1 : 0);
    }
  }

  program.parse(process.argv);

  // Non-blocking version check (fires after command execution)
  checkForUpdates();
};

run();


