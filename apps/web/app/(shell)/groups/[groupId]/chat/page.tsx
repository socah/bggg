import { GroupChatView } from '@/components/group-chat-view';

export default async function GroupChatPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  return <GroupChatView groupId={groupId} />;
}
