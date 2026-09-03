import { describe, expect, it } from '@jest/globals';
import { parseSpacePath } from './space';

describe('parseSpacePath', () => {
  it('does not treat personal settings as a view tab', () => {
    expect(parseSpacePath('/settings')).toEqual({ groupId: null, tab: null });
  });

  it('does not treat group settings as a view tab', () => {
    expect(parseSpacePath('/groups/group-1/settings')).toEqual({ groupId: 'group-1', tab: null });
  });
});
