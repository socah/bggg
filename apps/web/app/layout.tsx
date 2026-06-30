// No 'use client' — this is a Server Component.
// RootLayout wraps every page in the app. It renders once on the server
// and provides the <html> and <body> tags that Next.js requires.
// Child pages slot in via the {children} prop.

import type { Metadata } from 'next';
import './globals.css';

// Metadata exported from a Server Component is picked up by Next.js and
// injected into <head> as <title> and <meta> tags — no manual <Head> needed.
export const metadata: Metadata = {
  title: 'BGGG — Board Game Group',
  description: 'Organise play sessions with your board game group',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* min-h-screen ensures the background colour fills the viewport
          even on short pages. text-gray-900 sets a default text colour
          so we don't have to repeat it on every element. */}
      <body className="min-h-screen bg-gray-50 text-gray-900">
        {children}
      </body>
    </html>
  );
}
