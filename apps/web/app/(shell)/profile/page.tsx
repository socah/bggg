import { ComingSoon } from '@/components/coming-soon';
import { AppearanceSettings } from '@/components/appearance-settings';

export default function PersonalProfilePage() {
  return (
    <div className="flex flex-col gap-10">
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
