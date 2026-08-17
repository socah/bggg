import { GroupCalendarView } from '@/components/group-calendar-view';

export default async function GroupCalendarPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  return <GroupCalendarView groupId={groupId} />;
}
