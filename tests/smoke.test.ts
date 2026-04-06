import { describe, it, expect } from 'vitest';
import { greet } from '@/lib/smoke';

describe('smoke', () => {
  it('greet returns hello', () => {
    expect(greet()).toBe('hello');
  });
});
