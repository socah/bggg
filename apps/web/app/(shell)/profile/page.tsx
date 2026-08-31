import { ComingSoon } from '@/components/coming-soon';
import { AppearanceSettings } from '@/components/appearance-settings';
import { BggAccountSettings } from '@/components/bgg-account-settings';

export default function PersonalProfilePage() {
  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="font-display text-xl">BoardGameGeek</h2>
        <div className="mt-4">
          <BggAccountSettings />
        </div>
      </section>
      <section>
        <h2 className="font-display text-xl">Appearance</h2>
        <div className="mt-4">
          <AppearanceSettings />
        </div>
      </section>
      <ComingSoon label="Profile" />
    </div>
  );
}
