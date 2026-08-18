// No 'use client' — this is a Server Component.
// RootLayout wraps every page in the app. It renders once on the server
// and provides the <html> and <body> tags that Next.js requires.
// Child pages slot in via the {children} prop.

import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';
import { StyleScript } from '@/components/style-provider';

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
// Generates: <meta name="theme-color" content="#E1553A" />
export const viewport: Viewport = {
  themeColor: '#E1553A',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* min-h-screen ensures the background colour fills the viewport
          even on short pages. bg-bg/text-text/font-body come from the
          design tokens in globals.css so we don't have to repeat them
          on every element. */}
      <body className="min-h-screen bg-bg text-text font-body">
        <StyleScript />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
