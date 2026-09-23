import { describe, it, expect, vi } from 'vitest';
import { createCustomAnalyzer, type CustomAnalyzerConfig } from '../analyzers/custom';

describe('Custom Analyzers', () => {
  it('returns error when neither command nor URL is set', async () => {
    const config: CustomAnalyzerConfig = { name: 'test-empty' };
    const analyzer = createCustomAnalyzer(config);
    const results = await analyzer.analyze({});
    expect(results).toHaveLength(1);
    expect(results[0].errors[0].text).toContain('neither command nor URL');
  });

  it('returns error when command fails', async () => {
    const config: CustomAnalyzerConfig = { name: 'test-fail', command: 'false' };
    const analyzer = createCustomAnalyzer(config);
    const results = await analyzer.analyze({});
    expect(results).toHaveLength(1);
    expect(results[0].errors[0].text).toContain('failed');
  });

  it('returns error when HTTP URL is unreachable', async () => {
    const config: CustomAnalyzerConfig = {
      name: 'test-http-fail',
      url: 'http://localhost:99999/nonexistent',
    };
    const analyzer = createCustomAnalyzer(config);
    const results = await analyzer.analyze({});
    expect(results).toHaveLength(1);
    expect(results[0].errors[0].text).toContain('HTTP call failed');
  });

  it('creates analyzer with correct name', () => {
    const config: CustomAnalyzerConfig = { name: 'my-custom', command: 'echo {}' };
    const analyzer = createCustomAnalyzer(config);
    expect(analyzer.name).toBe('my-custom');
  });

  it('returns empty array when command exits with empty stdout', async () => {
    const config: CustomAnalyzerConfig = { name: 'clean-check', command: 'true' };
    const analyzer = createCustomAnalyzer(config);
    const results = await analyzer.analyze({});
    expect(results).toEqual([]);
  });

  it('returns empty array when command produces only whitespace', async () => {
    const config: CustomAnalyzerConfig = { name: 'whitespace-check', command: 'node -e "console.log(\'  \\n  \')"' };
    const analyzer = createCustomAnalyzer(config);
    const results = await analyzer.analyze({});
    expect(results).toEqual([]);
  });

  it('returns parsed results when command outputs valid JSON', async () => {
    const config: CustomAnalyzerConfig = {
      name: 'valid-json-check',
      command: 'node -e "console.log(JSON.stringify([{ kind: \'Custom\', name: \'valid-json-check\', errors: [] }]))"',
    };
    const analyzer = createCustomAnalyzer(config);
    const results = await analyzer.analyze({});
    expect(results).toEqual([{ kind: 'Custom', name: 'valid-json-check', errors: [] }]);
  });

  it('returns error with HTTP status message when HTTP call returns non-ok status', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementationOnce(async () => {
      return {
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: async () => '<html>502 Bad Gateway</html>',
      } as Response;
    });

    const config: CustomAnalyzerConfig = {
      name: 'http-error-check',
      url: 'http://example.com/webhook',
    };
    const analyzer = createCustomAnalyzer(config);
    const results = await analyzer.analyze({});
    expect(results).toHaveLength(1);
    expect(results[0].errors[0].text).toContain('HTTP 502 Bad Gateway');
    fetchSpy.mockRestore();
  });

  it('returns empty array when HTTP call returns ok with empty body', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementationOnce(async () => {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '',
      } as Response;
    });

    const config: CustomAnalyzerConfig = {
      name: 'http-empty-check',
      url: 'http://example.com/webhook',
    };
    const analyzer = createCustomAnalyzer(config);
    const results = await analyzer.analyze({});
    expect(results).toEqual([]);
    fetchSpy.mockRestore();
  });
});
