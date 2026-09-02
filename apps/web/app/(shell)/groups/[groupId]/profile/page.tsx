import { GroupInviteSettings } from '@/components/group-invite-settings';

export default async function GroupProfilePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="font-display text-xl">Invite members</h2>
        <div className="mt-4">
          <GroupInviteSettings groupId={groupId} />
        </div>
      </section>
    </div>
  );
}
