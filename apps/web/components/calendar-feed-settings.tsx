'use client';

import { useState } from 'react';
import { useCalendarFeedToken } from '@/hooks/use-calendar-feed-token';
import { Button } from '@/components/ui/button';
import { Dialog, DialogSheetContent, DialogClose, DialogTitle } from '@/components/ui/dialog';

// Subscribe-anywhere URL for the user's confirmed sessions across all
// their groups (Google/Apple Calendar "add by URL"). Regenerating kills
// the old link everywhere it's pasted — hence the confirm dialog.
export function CalendarFeedSettings() {
  const { feedUrl, pending, error, generate } = useCalendarFeedToken();
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!feedUrl) return;
    await navigator.clipboard.writeText(feedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="font-body text-sm">
      {!feedUrl ? (
        <>
          <p className="text-text-muted">
            Generate a private subscription URL for your calendar app. Anyone holding it sees your confirmed sessions — treat it like a password.
          </p>
          <Button type="button" className="mt-2" disabled={pending} onClick={() => void generate()}>
            {pending ? 'Generating…' : 'Generate feed URL'}
          </Button>
        </>
      ) : (
        <>
          <code className="block break-all rounded-sm bg-surface p-2 text-xs">{feedUrl}</code>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="secondary" onClick={() => void copy()}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirmRegenerate(true)}>
              Regenerate
            </Button>
          </div>
        </>
      )}

      {error && <p className="mt-2 text-accent">{error}</p>}

      <Dialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
        <DialogSheetContent aria-describedby={undefined}>
          <DialogTitle>Generate a new feed URL?</DialogTitle>
          <p className="mt-2 text-sm text-text-muted">
            The current URL stops working everywhere it&apos;s subscribed. You&apos;d re-add the new one in your calendar app.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                setConfirmRegenerate(false);
                void generate();
              }}
            >
              Regenerate
            </Button>
            <DialogClose className="self-center text-sm text-text-muted underline">Keep current</DialogClose>
          </div>
        </DialogSheetContent>
      </Dialog>
    </div>
  );
}
