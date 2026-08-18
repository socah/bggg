export function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <p className="font-display text-lg text-text">{label}</p>
      <p className="text-sm text-text-muted">Coming soon.</p>
    </div>
  );
}
