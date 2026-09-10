import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Offline | BGGG' };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-6 py-12">
      <p className="font-mono text-xs font-semibold uppercase tracking-widest text-accent">Connection lost</p>
      <h1 className="font-display text-4xl">The table is still here.</h1>
      <p className="text-text-muted">BGGG needs a connection to load live group data or save changes. Previously loaded app resources remain available.</p>
      <Link href="/" className="mt-2 inline-flex min-h-11 w-fit items-center rounded-sm bg-accent px-4 text-sm font-semibold text-accent-ink">Try again</Link>
    </main>
  );
}
