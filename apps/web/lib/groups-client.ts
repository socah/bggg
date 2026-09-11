'use client';

import { apiFetch } from '@/lib/api';
import type { Group } from '@/lib/types';

let cachedGroups: Group[] | null = null;
let groupsRequest: Promise<Group[]> | null = null;

export function peekGroups(): Group[] | null {
  return cachedGroups;
}

export function fetchGroups(force = false): Promise<Group[]> {
  if (groupsRequest) return groupsRequest;
  if (!force && cachedGroups) return Promise.resolve(cachedGroups);
  groupsRequest = apiFetch('/groups')
    .then(async (response) => {
      if (!response.ok) {
        cachedGroups = null;
        throw new Error(`Unexpected status ${response.status}`);
      }
      cachedGroups = await response.json() as Group[];
      return cachedGroups;
    })
    .finally(() => { groupsRequest = null; });
  return groupsRequest;
}
