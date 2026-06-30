// No 'use client' — Server Component by default.
// This is the root page: it renders when the user visits '/'.
// Right now it is a static placeholder. In the next topic (Keycloak)
// we will fetch the user's groups from the NestJS API here.

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-bold tracking-tight">Board Game Group</h1>
      <p className="text-gray-600">Select or create a group to get started.</p>
    </main>
  );
}
