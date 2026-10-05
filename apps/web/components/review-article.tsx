'use client';

import { useRef } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GamePlaySummary } from '@/lib/types';

function playReferenceId(href?: string): string | null {
  return href?.startsWith('/review-play/') ? href.slice('/review-play/'.length) : null;
}

function photoReferenceId(src?: string): string | null {
  return src?.startsWith('/review-photo/') ? src.slice('/review-photo/'.length) : null;
}

function formatPlayDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value));
}

export function ReviewArticle({ body, plays }: { body: string; plays: GamePlaySummary[] }) {
  const playById = new Map(plays.map((play) => [play.id, play]));
  const photoById = new Map(plays.flatMap((play) => (play.photos ?? []).map((photo) => [photo.id, { photo, play }] as const)));

  return <article className="min-w-0 overflow-hidden break-words text-[0.98rem] leading-7 text-text [overflow-wrap:anywhere]">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => url.startsWith('/review-') ? url : defaultUrlTransform(url)}
      components={{
        h1: ({ children }) => <h1 className="mb-4 mt-8 font-display text-3xl first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-3 mt-7 border-b border-border pb-2 font-display text-2xl first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 mt-6 font-display text-xl">{children}</h3>,
        p: ({ children }) => <p className="my-4">{children}</p>,
        ul: ({ children }) => <ul className="my-4 list-disc space-y-1 pl-6">{children}</ul>,
        ol: ({ children }) => <ol className="my-4 list-decimal space-y-1 pl-6">{children}</ol>,
        blockquote: ({ children }) => <blockquote className="my-5 border-l-4 border-accent pl-4 italic text-text-muted">{children}</blockquote>,
        strong: ({ children }) => <strong className="font-extrabold">{children}</strong>,
        code: ({ children }) => <code className="break-all rounded-sm bg-surface px-1 py-0.5 font-mono text-sm">{children}</code>,
        pre: ({ children }) => <pre className="my-4 max-w-full overflow-x-auto rounded-sm bg-surface p-3 text-sm">{children}</pre>,
        a: ({ href, children }) => {
          const play = playById.get(playReferenceId(href) ?? '');
          if (play) return <a href={`#logged-play-${play.id}`} className="mx-0.5 inline-flex rounded-sm border border-border bg-highlight/30 px-2 py-0.5 text-sm font-semibold text-text no-underline hover:border-accent">Played {formatPlayDate(play.playedAt)} · {play.groupName}</a>;
          if (playReferenceId(href)) return <span className="text-sm italic text-text-muted">Private or deleted play</span>;
          return <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-accent-2 underline underline-offset-2">{children}</a>;
        },
        img: ({ src, alt }) => {
          const reference = photoById.get(photoReferenceId(typeof src === 'string' ? src : undefined) ?? '');
          if (!reference) return <span className="block rounded-sm border border-dashed border-border p-3 text-sm italic text-text-muted">Private or deleted play photo</span>;
          return <figure className="my-6"><a href={reference.photo.url} target="_blank" rel="noreferrer"><img src={reference.photo.url} alt={alt || 'Play photo'} className="max-h-[34rem] w-full rounded-md object-contain" /></a>{alt && <figcaption className="mt-2 text-center text-xs text-text-muted">{alt} · {formatPlayDate(reference.play.playedAt)}</figcaption>}</figure>;
        },
      }}
    >{body}</ReactMarkdown>
  </article>;
}

export function ReviewEditor({ body, plays, onChange }: { body: string; plays: GamePlaySummary[]; onChange: (body: string) => void }) {
  const textarea = useRef<HTMLTextAreaElement>(null);

  function insert(markdown: string) {
    const element = textarea.current;
    if (!element) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const next = `${body.slice(0, start)}${markdown}${body.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + markdown.length, start + markdown.length);
    });
  }

  return <div className="min-w-0">
    <textarea ref={textarea} aria-label="Review article" value={body} onChange={(event) => onChange(event.target.value)} rows={14} maxLength={20000} className="w-full resize-y overflow-x-hidden rounded-sm border-[length:var(--border-w)] border-border bg-surface p-4 font-mono text-sm leading-6 text-text [overflow-wrap:anywhere]" placeholder={'## First impressions\n\nWrite your review in Markdown...'} />
    <p className="mt-1 text-xs text-text-muted">Markdown is rendered in this same space when you return to reading view.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <select aria-label="Reference a logged play" defaultValue="" className="min-h-10 rounded-sm border border-border bg-surface px-2 text-sm" onChange={(event) => { const play = plays.find((candidate) => candidate.id === event.target.value); if (play) insert(`[Played ${formatPlayDate(play.playedAt)}](/review-play/${play.id})`); event.target.value = ''; }}>
        <option value="">Reference a logged play...</option>
        {plays.map((play) => <option key={play.id} value={play.id}>{formatPlayDate(play.playedAt)} · {play.groupName}</option>)}
      </select>
      <select aria-label="Insert a play photo" defaultValue="" className="min-h-10 rounded-sm border border-border bg-surface px-2 text-sm" onChange={(event) => { const entry = plays.flatMap((play) => (play.photos ?? []).map((photo, index) => ({ play, photo, index }))).find(({ photo }) => photo.id === event.target.value); if (entry) insert(`![Play photo ${entry.index + 1}](/review-photo/${entry.photo.id})`); event.target.value = ''; }}>
        <option value="">Insert a play photo...</option>
        {plays.flatMap((play) => (play.photos ?? []).map((photo, index) => <option key={photo.id} value={photo.id}>{formatPlayDate(play.playedAt)} · Photo {index + 1}</option>))}
      </select>
    </div>
  </div>;
}
