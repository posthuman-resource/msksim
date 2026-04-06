import { describe, it, expect } from 'vitest';
import { sanitizeFilename, exportFilename, mergeFieldErrors } from './config-helpers';

describe('sanitizeFilename', () => {
  it('passes alphanumerics through', () => {
    expect(sanitizeFilename('my_config')).toBe('my_config');
  });

  it('replaces spaces with hyphens', () => {
    expect(sanitizeFilename('Baseline Test')).toBe('Baseline-Test');
  });

  it('strips hostile characters', () => {
    expect(sanitizeFilename('A/B\\C"D')).toBe('ABCD');
  });

  it('strips path traversal characters', () => {
    const result = sanitizeFilename('../etc/passwd');
    expect(result).not.toContain('..');
    expect(result).not.toContain('/');
  });

  it('returns safe default for empty string', () => {
    expect(sanitizeFilename('')).toBe('config');
  });

  it('caps length at 100 characters', () => {
    const result = sanitizeFilename('a'.repeat(500));
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('handles string that becomes empty after stripping', () => {
    expect(sanitizeFilename('//\\"')).toBe('config');
  });
});

describe('exportFilename', () => {
  it('concatenates sanitized name and first 8 hash chars with .json', () => {
    expect(exportFilename('Baseline', 'abc12345efg')).toBe('Baseline-abc12345.json');
  });

  it('sanitizes the name portion', () => {
    expect(exportFilename('Baseline Test /v1', 'abc12345efg')).toBe(
      'Baseline-Test-v1-abc12345.json',
    );
  });
});

describe('mergeFieldErrors', () => {
  it('server errors take precedence over client errors on the same path', () => {
    const client = { 'world1.agentCount': 'client error' };
    const server = { 'world1.agentCount': ['server error'] };
    const merged = mergeFieldErrors(client, server);
    expect(merged['world1.agentCount']).toBe('server error');
  });

  it('combines disjoint paths from client and server', () => {
    const client = { tickCount: 'too small' };
    const server = { seed: ['must be integer'] };
    const merged = mergeFieldErrors(client, server);
    expect(merged.tickCount).toBe('too small');
    expect(merged.seed).toBe('must be integer');
  });

  it('returns empty object for both empty inputs', () => {
    expect(mergeFieldErrors({}, {})).toEqual({});
  });

  it('returns client errors unchanged when server errors are empty', () => {
    const client = { tickCount: 'error' };
    const merged = mergeFieldErrors(client, {});
    expect(merged).toEqual(client);
  });

  it('returns server errors when client errors are empty', () => {
    const server = { seed: ['bad value'] };
    const merged = mergeFieldErrors({}, server);
    expect(merged.seed).toBe('bad value');
  });
});
