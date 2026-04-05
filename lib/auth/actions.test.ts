// Unit tests for the pure helpers in app/login/helpers.ts.
// helpers.ts has no server-side imports, so no env stubs or mocks are needed.
//
// See docs/plan/07-login-and-app-shell.md §9 for the full test specification.

import { describe, expect, it } from 'vitest';

import { sanitizeNext, validateLoginInput } from '../../app/login/helpers';

// ---------------------------------------------------------------------------
// validateLoginInput
// ---------------------------------------------------------------------------

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.append(key, value);
  }
  return fd;
}

describe('validateLoginInput', () => {
  it('succeeds for valid username and password', () => {
    const fd = makeFormData({ username: 'alice', password: 'hunter2' });
    const result = validateLoginInput(fd);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.username).toBe('alice');
      expect(result.data.password).toBe('hunter2');
    }
  });

  it('fails when username is missing', () => {
    const fd = makeFormData({ password: 'hunter2' });
    expect(validateLoginInput(fd).ok).toBe(false);
  });

  it('fails when password is missing', () => {
    const fd = makeFormData({ username: 'alice' });
    expect(validateLoginInput(fd).ok).toBe(false);
  });

  it('fails when username is empty string', () => {
    const fd = makeFormData({ username: '', password: 'hunter2' });
    expect(validateLoginInput(fd).ok).toBe(false);
  });

  it('fails when password is empty string', () => {
    const fd = makeFormData({ username: 'alice', password: '' });
    expect(validateLoginInput(fd).ok).toBe(false);
  });

  it('passes through optional next field', () => {
    const fd = makeFormData({
      username: 'alice',
      password: 'hunter2',
      next: '/runs',
    });
    const result = validateLoginInput(fd);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.next).toBe('/runs');
    }
  });
});

// ---------------------------------------------------------------------------
// sanitizeNext
// ---------------------------------------------------------------------------

describe('sanitizeNext', () => {
  it('returns a simple relative path unchanged', () => {
    expect(sanitizeNext('/runs')).toBe('/runs');
  });

  it('returns a nested relative path unchanged', () => {
    expect(sanitizeNext('/playground/foo')).toBe('/playground/foo');
  });

  it('rejects an absolute http URL', () => {
    expect(sanitizeNext('http://evil.example/x')).toBeNull();
  });

  it('rejects an absolute https URL', () => {
    expect(sanitizeNext('https://evil.example/x')).toBeNull();
  });

  it('rejects a protocol-relative URL (open-redirect vector)', () => {
    expect(sanitizeNext('//evil.example/x')).toBeNull();
  });

  it('rejects javascript: scheme', () => {
    expect(sanitizeNext('javascript:alert(1)')).toBeNull();
  });

  it('rejects data: scheme', () => {
    expect(sanitizeNext('data:text/html,<h1>x</h1>')).toBeNull();
  });

  it('rejects a string containing CR (header injection)', () => {
    expect(sanitizeNext('/foo\rSet-Cookie: x=y')).toBeNull();
  });

  it('rejects a string containing LF (header injection)', () => {
    expect(sanitizeNext('/foo\nSet-Cookie: x=y')).toBeNull();
  });

  it('rejects CRLF sequence (header injection)', () => {
    expect(sanitizeNext('/foo\r\nSet-Cookie: x=y')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(sanitizeNext(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(sanitizeNext('')).toBeNull();
  });

  it('returns null for null (cast)', () => {
    expect(sanitizeNext(null as unknown as string)).toBeNull();
  });
});
