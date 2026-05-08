import { program } from 'commander';
import chalk from 'chalk';
import { checkDockerConnection } from '../docker/client';
import { checkK8sConnection } from '../kubernetes/client';
import { registerShowCommand } from './show';
import { registerHealthCommand } from './health';
import { registerWatchCommand } from './watch';
import { registerLogsCommand } from './logs';
import { logger } from '../utils/logger';

program
  .name('kdm')
  .description('Kubernetes and Docker Monitoring CLI')
  .version('1.0.0');

// Register modular commands
registerShowCommand(program);
registerHealthCommand(program);
registerWatchCommand(program);
registerLogsCommand(program);

const run = async () => {
  if (!process.argv.slice(2).length) {
    const [dockerStatus, k8sStatus] = await Promise.all([
      checkDockerConnection(),
      checkK8sConnection()
    ]);

    const dockerStr = dockerStatus.connected ? chalk.green('Connected') : chalk.red('Disconnected');
    const k8sStr = k8sStatus.connected ? chalk.green('Connected') : chalk.red('Disconnected');

    console.log(chalk.bold.blue('KDM v1.0\n'));
    console.log(`Docker: ${dockerStr}`);
    console.log(`Kubernetes: ${k8sStr}\n`);
    console.log(`Running Containers: ${chalk.yellow(dockerStatus.containerCount)}`);
    console.log(`Running Pods: ${chalk.yellow(k8sStatus.podCount)}`);
    console.log(`Unhealthy Services: ${chalk.yellow('0')} (Mocked)\n`);
    console.log(chalk.bold('Commands:\n'));
    console.log(`  kdm show runners\n  kdm health all\n  kdm watch\n  kdm logs <name>\n`);
    
    program.outputHelp();
    process.exit(0);
  }

  program.parse(process.argv);
};

run();


