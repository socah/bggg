import { PersonalHostingStats } from '@/components/hosting-stats';
import { PersonalCollectionStats } from '@/components/collection-stats';

export default function PersonalProfilePage() {
  return <div className="flex flex-col gap-5"><PersonalHostingStats /><PersonalCollectionStats /></div>;
}
