import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { GroupSwitcher } from '@/components/group-switcher';
import { ViewTabs } from '@/components/view-tabs';

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  // Belt-and-braces: proxy.ts's middleware already redirects unauthenticated
  // requests before they reach here, but a layout shouldn't assume that and
  // render a broken header if it's ever reached without a session.
  if (!session?.user) redirect('/web/login');

  // A Server Function declared inside the Server Component, per the
  // documented pattern in node_modules/next/dist/docs/01-app/02-guides/forms.md
  // ("How it works") — `<form action={...}>` takes a function that runs on
  // the server, which is how signOut() gets to run/set cookies at all (see
  // docs/reference/authentication-keycloak.md's note on signIn() having the
  // same constraint).
  async function logOut() {
    'use server';
    await signOut({ redirectTo: '/web/login' });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-4">
          <GroupSwitcher />
          <ViewTabs />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-700">{session.user.name}</span>
          <button type="button" disabled title="Coming soon" className="text-gray-400">
            Settings
          </button>
          <form action={logOut}>
            <button type="submit" className="text-gray-700 underline">
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
