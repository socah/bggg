import { GroupLibrary } from '@/components/group-library';

export default async function GroupCollectionPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl">Group library</h1>
        <p className="text-sm text-text-muted">Games owned by members of this group.</p>
      </div>
      <GroupLibrary groupId={groupId} />
    </div>
  );
}
