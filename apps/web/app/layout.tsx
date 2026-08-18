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
      {/* Every family referenced by the five styles in globals.css, loaded in
          one Google Fonts request. Next.js hoists <link> elements rendered
          anywhere in the Server Component tree into the real <head>, so these
          belong here as siblings of <body>. display=swap means text paints in
          the fallback stack immediately rather than blocking on the webfont. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font -- that rule
          is about pages/_document; in the App Router a <link> in RootLayout
          already applies to every page, which is exactly what it asks for. */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..700&family=Karla:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Fredoka:wght@500;600;700&family=Nunito:wght@400;600;700;800&family=Space+Mono:wght@400;700&family=Comic+Neue:wght@400;700&family=Titan+One&family=Rubik:wght@400;500;600;700&family=Share+Tech+Mono&family=Baloo+2:wght@500;600;700&family=Quicksand:wght@400;500;600;700&display=swap"
      />
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
