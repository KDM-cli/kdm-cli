import { Spinner } from '@vr_patel/tui';

export const createSpinner = (text: string) => {
  const spinner = new Spinner({
    text,
    style: 'dots',
    color: 'cyan',
  });
  return spinner;
};
