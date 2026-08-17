import { redirect } from 'next/navigation';

// The shell's default landing state is the user-level (personal, no group
// selected) calendar — see the design spec's "Two spaces" section. By the
// time this runs, proxy.ts's middleware has already confirmed a session
// exists.
export default function HomePage() {
  redirect('/calendar');
}
