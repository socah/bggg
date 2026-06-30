# Next.js Fundamentals — App Router, Server vs Client Components, API Calls

**Phase:** 3 — Frontend, Auth & Real-Time
**Topic ID:** 3_nextjs
**Date:** 2026-06-30
**SecOps:** No

---

## What Is This?

Next.js is a React framework that adds server-side capabilities to what is otherwise a purely browser-side library. The key idea is that React components can run either on the server (fetching data, rendering HTML before it reaches the browser) or on the client (handling clicks, managing local state). With the **App Router** — introduced in Next.js 13 and now the default — you organise pages as folders inside `app/`, and components are Server Components by default.

---

## Why Does It Matter for This Project?

Our board game platform needs to show group lists, game collections, and scheduling data — content that exists in our NestJS API. Server Components let us fetch that data on the server and ship ready-made HTML to the browser, which means faster initial page loads and no client-side fetch waterfall. Client Components handle the interactive parts (forms, real-time chat later). The split keeps sensitive API logic on the server where Keycloak tokens live.

---

## The Decision

Chose: **Next.js App Router** (folder-based, Server Components by default)
Because: It is the current Next.js default and aligns with how React itself is evolving — the ecosystem is moving here. Server Components give us free data-fetching without `useEffect` chains, and layouts allow us to wrap authenticated pages cleanly.
Alternative: **Pages Router** (the older `pages/` directory approach)
Drawback of alternative: Actively being de-prioritised by Vercel/Next.js; no Server Components; data fetching requires `getServerSideProps` boilerplate per page; less composable layout system.

Second decision — Chose: **Next.js** over a pure **Vite + React SPA**
Because: We need SSR for SEO (game library pages), and the API route mechanism gives us a thin BFF (Backend For Frontend) layer in front of our NestJS API — useful for handling Keycloak token exchange without exposing it to the browser.
Drawback of alternative: A pure SPA can't do SSR and requires a separate proxy setup or CORS configuration to call the API.

---

## Worked Example

This example is NOT the project code. It is a minimal standalone demo of the three core concepts: a Server Component, a Client Component, and calling an external API from the server.

### Scenario

A tiny "Recipe" app. There is a page that fetches a list of recipes from an API on the server, renders them in HTML, and has a "Favourite" button per recipe that needs client-side interactivity.

### Code / Configuration

```
app/
  layout.tsx        ← server component, wraps all pages
  recipes/
    page.tsx        ← server component, fetches recipe data
    FavButton.tsx   ← client component, handles the click
```

**app/layout.tsx** — Server Component (default)
```tsx
// This runs on the server — it is never sent as JS to the browser.
// React renders it to HTML once.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* children is where the page component slots in */}
        <main>{children}</main>
      </body>
    </html>
  );
}
```

**app/recipes/page.tsx** — Server Component that fetches data
```tsx
// No "use client" directive = Server Component by default.
// `fetch` here runs on the server at request time — the browser
// never sees this code or the API URL.
import FavButton from './FavButton';

async function getRecipes() {
  // This fetch runs server-side. The API key stays secret.
  const res = await fetch('https://api.example.com/recipes', {
    // next.revalidate tells Next.js to cache this for 60 seconds,
    // then refetch in the background — "stale while revalidate" pattern.
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error('Failed to fetch recipes');
  return res.json();
}

export default async function RecipesPage() {
  // Server Components can be async — await runs at render time on the server.
  const recipes = await getRecipes();

  return (
    <ul>
      {recipes.map((r: { id: string; name: string }) => (
        <li key={r.id}>
          {r.name}
          {/* FavButton is interactive, so it must be a Client Component.
              We pass just the id — the full recipe object stays on the server. */}
          <FavButton recipeId={r.id} />
        </li>
      ))}
    </ul>
  );
}
```

**app/recipes/FavButton.tsx** — Client Component
```tsx
'use client'; // This directive is what makes it a Client Component.
              // Next.js will bundle this file and send it to the browser.

import { useState } from 'react';

// Props must be serialisable — the server passes them across the
// server/client boundary as JSON. Passing a full object with methods
// would not work.
export default function FavButton({ recipeId }: { recipeId: string }) {
  const [faved, setFaved] = useState(false);

  return (
    <button onClick={() => setFaved(!faved)}>
      {faved ? '★ Saved' : '☆ Save'}
    </button>
  );
}
```

### What Is Happening Step by Step

1. **Request arrives** — a browser visits `/recipes`. Next.js sees `app/recipes/page.tsx`.
2. **Server renders `RecipesPage`** — because there is no `'use client'`, this runs on the Node.js process. `getRecipes()` is awaited — the API call happens here, on the server.
3. **HTML is built** — Next.js renders the list with the recipe names. For each item, it sees `<FavButton>` — a Client Component. It renders the button's initial HTML (no state yet, so it renders as `☆ Save`).
4. **Response sent** — the browser receives complete HTML. The page is readable immediately, before any JS loads.
5. **Hydration** — the browser loads the JS bundle for `FavButton`. React "attaches" the event listeners to the already-visible HTML. Now clicks work.
6. **Click** — `setFaved(true)` runs in the browser. The `★ Saved` text appears without a server round-trip.

### What Would Break If You Changed X?

If you removed `'use client'` from `FavButton.tsx`:

Next.js would treat it as a Server Component. Server Components cannot use `useState` (there is no state on the server between requests). The build would fail immediately with:

> Error: `useState` is not allowed in Server Components.

This is one of the most common early Next.js mistakes — reaching for `useState` in a file that has no `'use client'` directive.

---

## Now Apply It

In our board game platform, the same split will appear:

- Server Components will fetch group lists, game collections, and session schedules from our NestJS API (using the user's Keycloak token from the server-side session — the token never touches the browser).
- Client Components will handle forms (create group, RSVP), the invite flow UI, and eventually the chat window.

Files to look at after this note:
- `apps/web/` — this is the directory we are about to create; it will become the Next.js app
- `apps/api/src/groups/groups.controller.ts` — the REST endpoints the web app will call; understand the shape of the responses before building the fetch layer

---

## Checkpoint Questions

1. What is the difference between a Server Component and a Client Component in Next.js? What determines which one a file is?
2. If a Server Component fetches data and passes it to a Client Component as a prop, what constraint applies to that prop? Why?
3. What would happen if you tried to call `fetch` with a secret API key inside a Client Component? Why is that a problem?
4. Explain the sequence of events from "browser requests `/recipes`" to "user can click the Favourite button." What happens on the server, what happens in the browser?
5. What does the `next: { revalidate: 60 }` option on a `fetch` call do, and why is it useful for a game library page?

---

## Summary

Built: Next.js app scaffold inside `apps/web/` — `package.json`, `tsconfig.json`, `next.config.ts`, Tailwind config, `app/layout.tsx`, and `app/page.tsx`. Updated `devcontainer.json` to forward ports 3000 and 3001, and root `package.json` with `dev:api` and `dev:web` scripts.
Demonstrated understanding of: Server vs Client Component distinction; the role of the `'use client'` directive; why the proxy rewrite in `next.config.ts` avoids CORS (same-origin policy — port difference between `localhost:3000` and `localhost:3001` counts as different origin); the sequence from server render to hydration.
To revisit: The CORS answer took two prompts — the same-origin policy and what CORS actually is (server opt-in via headers) is worth solidifying before the Keycloak topic, where token handling across origins will come up again.
