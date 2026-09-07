import { describe, expect, it } from '@jest/globals';
import { parseSpacePath, spaceHref } from './space';

describe('parseSpacePath', () => {
  it('does not treat personal settings as a view tab', () => {
    expect(parseSpacePath('/settings')).toEqual({ groupId: null, userId: null, tab: null });
  });

  it('does not treat group settings as a view tab', () => {
    expect(parseSpacePath('/groups/group-1/settings')).toEqual({ groupId: 'group-1', userId: null, tab: null });
  });

  it('recognizes selected-user profile and collection routes', () => {
    expect(parseSpacePath('/groups/group-1/profile/user%2F2')).toEqual({
      groupId: 'group-1', userId: 'user/2', tab: 'profile',
    });
    expect(parseSpacePath('/groups/group-1/collection/user-2')).toEqual({
      groupId: 'group-1', userId: 'user-2', tab: 'collection',
    });
    expect(spaceHref('group-1', 'collection', 'user/2')).toBe('/groups/group-1/collection/user%2F2');
  });

  it('does not create a selected-user calendar route', () => {
    expect(spaceHref('group-1', 'calendar', 'user-2')).toBe('/groups/group-1/calendar');
  });
});
