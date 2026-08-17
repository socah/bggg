// Mirrors apps/api/src/groups/group.entity.ts's JSON shape (camelCase
// property names, since Nest serializes entity instances as-is).
export interface Group {
  id: string;
  name: string;
  ownerId: string;
  isSolo: boolean;
  createdAt: string;
}
