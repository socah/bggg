// No 'use client' — this is a Server Component.
// RootLayout wraps every page in the app. It renders once on the server
// and provides the <html> and <body> tags that Next.js requires.
// Child pages slot in via the {children} prop.

import type { Metadata, Viewport } from 'next';
import './globals.css';

// Metadata exported from a Server Component is picked up by Next.js and
// injected into <head> as <title>, <meta>, and <link> tags server-side.
export const metadata: Metadata = {
  title: 'BGGG — Board Game Group',
  description: 'Organise play sessions with your board game group',
  // Generates: <link rel="manifest" href="/manifest.json" />
  // The browser reads this to discover the app's name, icons, and display mode.
  manifest: '/manifest.json',
};

// themeColor lives in viewport (not metadata) in Next.js 14+ because it
// also affects the browser viewport meta tag, not just a <head> entry.
// Generates: <meta name="theme-color" content="#4f46e5" />
export const viewport: Viewport = {
  themeColor: '#4f46e5',
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
