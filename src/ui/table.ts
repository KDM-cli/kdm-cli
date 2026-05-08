import Table from 'cli-table3';
import chalk from 'chalk';

export interface TableOptions {
  head: string[];
  rows: (string | number)[][];
}

export const renderTable = ({ head, rows }: TableOptions) => {
  const table = new Table({
    head: head.map(h => chalk.bold.cyan(h)),
    style: {
      head: [], // Disable default colors to use chalk
      border: ['dim'],
    },
    chars: {
      top: '─',
      'top-mid': '┬',
      'top-left': '╭',
      'top-right': '╮',
      bottom: '─',
      'bottom-mid': '┴',
      'bottom-left': '╰',
      'bottom-right': '╯',
      left: '│',
      'left-mid': '├',
      mid: '─',
      'mid-mid': '┼',
      right: '│',
      'right-mid': '┤',
      middle: '│',
    },
  });

  rows.forEach(row => table.push(row));

  console.log(table.toString());
};
