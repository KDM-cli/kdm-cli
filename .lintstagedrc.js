export default {
  'src/**/*.{ts,tsx}': () => 'npm run check:types',
  'src/__tests__/**/*.{test,spec}.{ts,tsx}': ['vitest run --pool=forks'],
  'agents/**/*.py': ['python3 -m py_compile']
};
