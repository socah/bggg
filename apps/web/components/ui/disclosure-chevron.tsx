export function DisclosureChevron({ expanded }: { expanded: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 20 20" className={`size-4 shrink-0 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 7.5 5 5 5-5" /></svg>;
}
