import { AppearanceSettings } from '@/components/appearance-settings';
import { BggAccountSettings } from '@/components/bgg-account-settings';
import { CalendarFeedSettings } from '@/components/calendar-feed-settings';
import { ProfileSettings } from '@/components/profile-settings';
import { DeleteAccountSettings } from '@/components/delete-account-settings';
import { NotificationSettings } from '@/components/notification-settings';

export default function PersonalSettingsPage() {
  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="font-display text-xl">Profile</h2>
        <div className="mt-4">
          <ProfileSettings />
        </div>
      </section>
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
      <section>
        <h2 className="font-display text-xl">Notifications</h2>
        <p className="mt-1 text-sm text-text-muted">Choose which updates can reach this device.</p>
        <div className="mt-4">
          <NotificationSettings />
        </div>
      </section>
      <section>
        <h2 className="font-display text-xl">Calendar feed</h2>
        <div className="mt-4">
          <CalendarFeedSettings />
        </div>
      </section>
      <section>
        <h2 className="font-display text-xl text-accent">Delete account</h2>
        <div className="mt-4">
          <DeleteAccountSettings />
        </div>
      </section>
    </div>
  );
}
