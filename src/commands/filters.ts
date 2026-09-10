import { Command } from 'commander';
import chalk from 'chalk';
import { getActiveFilters, setActiveFilters } from '../config/store';
import { registry } from '../analyzers';
import { DEFAULT_FILTERS } from '../ui/FiltersDashboard';

export { DEFAULT_FILTERS };

/**
 * Lists the configured active filters and the available inactive ones.
 */
const handleListFilters = (): void => {
  const active = getActiveFilters();
  const allAvailable = registry.list().map((a) => a.name);

  const activeDisplay = active.length > 0 ? active : DEFAULT_FILTERS;
  const inactiveDisplay = allAvailable.filter((name) => !activeDisplay.includes(name));

  console.log(chalk.bold('Active filters:'));
  activeDisplay.forEach((f) => console.log(`- ${f}`));

  console.log();
  console.log(chalk.bold('Available but inactive filters:'));
  if (inactiveDisplay.length > 0) {
    inactiveDisplay.forEach((f) => console.log(`- ${f}`));
  } else {
    console.log('(none)');
  }
};

/**
 * Adds a filter name to the active filters config.
 * @param name Name of the filter to add.
 */
const handleAddFilter = (name: string): void => {
  if (!registry.has(name)) {
    console.error(
      chalk.red(
        `Error: Unknown filter name "${name}". Available filters: ${registry
          .list()
          .map((a) => a.name)
          .join(', ')}`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const active = getActiveFilters();
  if (active.includes(name)) {
    console.log(`Filter "${name}" is already active.`);
    return;
  }

  active.push(name);
  setActiveFilters(active);
  console.log(chalk.green(`Successfully added filter "${name}" to active filters.`));
};

/**
 * Removes a filter that was explicitly added to active filters.
 * @param active Currently configured active filters.
 * @param name Name of the filter to remove.
 */
const removeExplicitFilter = (active: string[], name: string): void => {
  if (!active.includes(name)) {
    console.log(`Filter "${name}" is not currently active.`);
    return;
  }
  const updated = active.filter((f) => f !== name);
  setActiveFilters(updated);
  console.log(chalk.green(`Successfully removed filter "${name}" from active filters.`));
};

/**
 * Removes a default filter when activeFilters configuration is empty.
 * Initializes configuration with remaining defaults.
 * @param name Name of the filter to remove.
 */
const removeDefaultFilter = (name: string): void => {
  const updated = DEFAULT_FILTERS.filter((f) => f !== name);
  setActiveFilters(updated);
  console.log(chalk.green(`Successfully removed default filter "${name}" from active filters.`));
};

/**
 * Removes a filter name from the active filters config.
 * @param name Name of the filter to remove.
 */
const handleRemoveFilter = (name: string): void => {
  if (!registry.has(name)) {
    console.error(chalk.red(`Error: Unknown filter name "${name}".`));
    process.exitCode = 1;
    return;
  }

  const active = getActiveFilters();
  if (active.length > 0) {
    removeExplicitFilter(active, name);
  } else {
    removeDefaultFilter(name);
  }
};

/**
 * Registers the filters subcommands on the Commander program.
 * @param program Commander program instance.
 */
export const registerFiltersCommand = (program: Command): void => {
  const filters = program
    .command('filters')
    .alias('filter')
    .description('Manage active analyzers filters for kdm analyze')
    .action(async () => {
      if (!process.stdout.isTTY || !process.stdin.isTTY) {
        console.error('Interactive filters dashboard requires a TTY terminal.');
        process.exitCode = 1;
        return;
      }
      process.stdout.write('\x1Bc');
      const { default: React } = await import('react');
      const { render } = await import('ink');
      const { FiltersDashboard } = await import('../ui/FiltersDashboard');
      const app = render(React.createElement(FiltersDashboard));
      await app.waitUntilExit();
    });

  filters
    .command('list')
    .description('List active and available but inactive filters')
    .action(handleListFilters);

  filters
    .command('add <name>')
    .description('Add a filter to default active filters list')
    .action(handleAddFilter);

  filters
    .command('remove <name>')
    .description('Remove a filter from default active filters list')
    .action(handleRemoveFilter);
};
