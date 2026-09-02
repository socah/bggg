import { redirect } from 'next/navigation';

export default async function GroupProfilePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  redirect(`/groups/${groupId}/settings`);
}
