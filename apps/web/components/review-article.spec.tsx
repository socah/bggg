import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GamePlaySummary } from '@/lib/types';
import { ReviewArticle, ReviewEditor } from './review-article';

const play: GamePlaySummary = {
  id: 'play-1',
  sessionId: 'session-1',
  groupId: 'group-1',
  playedAt: '2026-09-10T12:00:00.000Z',
  notes: null,
  status: 'finished',
  durationMinutes: 60,
  startedAt: null,
  endedAt: null,
  canEdit: true,
  groupName: 'Thursday Games',
  photos: [{ id: 'photo-1', playId: 'play-1', url: 'https://example.test/photo' }],
};

afterEach(cleanup);

describe('ReviewArticle', () => {
  it('renders Markdown and authorized play references', () => {
    const { container } = render(<ReviewArticle body={'## Verdict\n\n**Excellent** and *tense*.\n\n[Our session](/review-play/play-1)\n\n![Final board](/review-photo/photo-1)'} plays={[play]} />);

    expect(screen.getByRole('heading', { name: 'Verdict' })).toBeTruthy();
    expect(screen.getByText('Excellent').tagName).toBe('STRONG');
    expect(screen.getByText('tense').tagName).toBe('EM');
    expect(screen.getByRole('link', { name: /Played 10 Sept 2026/ }).getAttribute('href')).toBe('#logged-play-play-1');
    expect(screen.getByRole('img', { name: 'Final board' }).getAttribute('src')).toBe('https://example.test/photo');
    expect(container.querySelector('article')?.className).toContain('[overflow-wrap:anywhere]');
  });

  it('does not render raw HTML from review articles', () => {
    const { container } = render(<ReviewArticle body={'Safe<script>alert(1)</script><img src="javascript:alert(1)" />'} plays={[]} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('uses one wrapping editor surface and inserts play references', () => {
    const onChange = jest.fn<(body: string) => void>();
    render(<ReviewEditor body="" plays={[play]} onChange={onChange} />);

    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.getByLabelText('Review article').className).toContain('[overflow-wrap:anywhere]');
    fireEvent.change(screen.getByLabelText('Reference a logged play'), { target: { value: 'play-1' } });
    expect(onChange).toHaveBeenLastCalledWith('[Played 10 Sept 2026](/review-play/play-1)');

    fireEvent.change(screen.getByLabelText('Insert a play photo'), { target: { value: 'photo-1' } });
    expect(onChange).toHaveBeenLastCalledWith('![Play photo 1](/review-photo/photo-1)');
  });
});
