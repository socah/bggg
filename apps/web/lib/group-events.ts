export const GROUP_DELETED_EVENT = 'bggg:group-deleted';

export function announceGroupDeleted(groupId: string) {
  window.dispatchEvent(new CustomEvent(GROUP_DELETED_EVENT, { detail: { groupId } }));
}
