import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ShellContextControl } from '@/components/shell-context-control';
import { ViewTabs } from '@/components/view-tabs';
import { UserMenu } from '@/components/user-menu';
import { BottomNav } from '@/components/bottom-nav';

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  // Belt-and-braces: proxy.ts's middleware already redirects unauthenticated
  // requests before they reach here, but a layout shouldn't assume that and
  // render a broken header if it's ever reached without a session.
  if (!session?.user) redirect('/web/login');

  const name = session.user.username ?? session.user.name ?? 'Account';

  return (
    <div className="flex min-h-screen flex-col">
      <header
        className="flex items-center justify-between gap-3 bg-surface-raised px-4 py-3"
        style={{ borderBottom: 'var(--border-w) solid var(--border)' }}
      >
        <ShellContextControl />
        <div className="hidden md:block">
          <ViewTabs />
        </div>
        <UserMenu name={name} />
      </header>
      <main className="flex-1 p-4 pb-20 md:pb-4">{children}</main>
      <BottomNav />
    </div>
  );
}
