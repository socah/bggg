import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('invite link route', () => {
  it('has a page for the public invite URL', () => {
    expect(existsSync(join(process.cwd(), 'app', 'invites', '[token]', 'page.tsx'))).toBe(true);
  });
});
