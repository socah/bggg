'use client';

import { useCallback, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  clockPositionMinutes,
  clockToMinutes,
  formatDuration,
  intervalDuration,
  minutesToClock,
  minutesToTime,
  timeToMinutes,
  TIME_STEP_MINUTES,
  type ClockTime,
  type Period,
} from '@/lib/time-interval';

export interface TimePickerDialogProps {
  open: boolean;
  startValue?: string;
  endValue?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (start: string, end: string) => void;
  title?: string;
}

type PickerStage = 'start' | 'end';

const DIAL_SIZE = 240;
const DIAL_RADIUS = 90;
const CENTER = DIAL_SIZE / 2;
const DEFAULT_INTERVAL_MINUTES = 4 * 60;
// One analog clock face: 12 hours with four quarter-hour positions per hour.
// AM/PM is represented by the period controls, not by duplicating the face.
const TICKS = 12 * 60 / TIME_STEP_MINUTES;

function parseValue(value: string | undefined, fallback: string): number {
  return !value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? timeToMinutes(fallback) : timeToMinutes(value);
}

function parseClock(value: string | undefined, fallback: string): ClockTime {
  return minutesToClock(parseValue(value, fallback));
}

function angleForClock(time: ClockTime): number {
  return (clockPositionMinutes(time) / (12 * 60)) * 360;
}

function clockFromPosition(position: number, period: Period): ClockTime {
  const normalized = ((position % (12 * 60)) + 12 * 60) % (12 * 60);
  return { hour: Math.floor(normalized / 60) || 12, minute: normalized % 60, period };
}

function displayClock(time: ClockTime): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')} ${time.period}`;
}

function pointForAngle(angle: number, radius: number) {
  const radians = (angle - 90) * (Math.PI / 180);
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) };
}

function arcPaths(start: number, durationMinutes: number): string[] {
  const radius = DIAL_RADIUS - 16;
  // The face is one 12-hour revolution. Longer intervals may therefore
  // contain more than one revolution, which is represented by multiple
  // fixed-center arc segments.
  let remaining = Math.min(durationMinutes / (12 * 60) * 360, 720);
  let current = start;
  const paths: string[] = [];

  while (remaining > 0) {
    const segment = Math.min(remaining, 180);
    const startPoint = pointForAngle(current, radius);
    const endPoint = pointForAngle(current + segment, radius);
    paths.push(
      `M ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 0 1 ${endPoint.x} ${endPoint.y}`,
    );
    current += segment;
    remaining -= segment;
  }

  return paths;
}

interface TimePickerInnerProps {
  startValue?: string;
  endValue?: string;
  title: string;
  onClose: () => void;
  onConfirm: (start: string, end: string) => void;
}

function TimePickerInner({ startValue, endValue, title, onClose, onConfirm }: TimePickerInnerProps) {
  const [stage, setStage] = useState<PickerStage>('start');
  const [start, setStart] = useState(() => parseClock(startValue, '18:00'));
  const [end, setEnd] = useState(() => parseClock(endValue, '22:00'));
  const [isDragging, setIsDragging] = useState(false);
  const [animateSelection, setAnimateSelection] = useState(false);
  const dialRef = useRef<HTMLDivElement>(null);
  const lastEndPositionRef = useRef<number | null>(null);

  const selectFromPointer = useCallback((clientX: number, clientY: number, final: boolean) => {
    if (!dialRef.current) return;
    const rect = dialRef.current.getBoundingClientRect();
    const x = clientX - rect.left - CENTER;
    const y = clientY - rect.top - CENTER;
    let angle = Math.atan2(y, x) * 180 / Math.PI + 90;
    if (angle < 0) angle += 360;
    const selectedPosition =
      (Math.round(angle / (360 / TICKS)) * TIME_STEP_MINUTES) % (12 * 60);
    if (stage === 'start') {
      const nextStart = clockFromPosition(selectedPosition, start.period);
      const nextEnd = minutesToClock(clockToMinutes(nextStart) + DEFAULT_INTERVAL_MINUTES);
      setStart(nextStart);
      setEnd(nextEnd);
      if (final) {
        lastEndPositionRef.current = clockPositionMinutes(nextEnd);
        setAnimateSelection(true);
        setStage('end');
      }
    } else {
      const previousPosition = lastEndPositionRef.current;
      let crossedTwelve = false;
      if (previousPosition !== null) {
        crossedTwelve =
          (previousPosition >= 10 * 60 && selectedPosition <= 2 * 60) ||
          (previousPosition <= 2 * 60 && selectedPosition >= 10 * 60);
      }
      lastEndPositionRef.current = selectedPosition;
      setEnd((current) => {
        const period = crossedTwelve
          ? current.period === 'AM' ? 'PM' : 'AM'
          : current.period;
        return clockFromPosition(selectedPosition, period);
      });
    }
  }, [stage, start]);

  const startMinutes = clockToMinutes(start);
  const endMinutes = clockToMinutes(end);
  const duration = intervalDuration(minutesToTime(startMinutes), minutesToTime(endMinutes));
  const startAngle = angleForClock(start);
  const startPoint = pointForAngle(startAngle, DIAL_RADIUS);
  const handAngle = stage === 'end'
    ? startAngle + duration / (12 * 60) * 360
    : startAngle;

  return (
    <DialogContent className="flex max-w-xs flex-col items-center p-4 select-none">
      <DialogTitle className="mb-2 self-start text-xs font-semibold uppercase tracking-wider text-text-muted">
        {title}
      </DialogTitle>

      <div className="mb-3 flex w-full items-center justify-between px-2">
        <div className="font-display text-3xl">
          <span className={cn('rounded px-2 py-1', stage === 'start' ? 'bg-highlight font-bold' : 'text-text-muted')}>
            {displayClock(start)}
          </span>
          <span className="mx-1 text-text-muted">–</span>
          <span className={cn('rounded px-2 py-1', stage === 'end' ? 'bg-highlight font-bold' : 'text-text-muted')}>
            {displayClock(end)}
          </span>
        </div>
      </div>

      <p className="mb-1 text-xs text-text-muted">
        {stage === 'start' ? 'Choose the start time' : 'Choose the end time'}
      </p>
      {stage === 'end' && (
        <p className="mb-3 text-sm font-semibold text-text" aria-live="polite">
          {formatDuration(duration)} selected
        </p>
      )}

      <div
        ref={dialRef}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setIsDragging(true);
          // Manual rotation should track the pointer without easing.
          setAnimateSelection(false);
          selectFromPointer(event.clientX, event.clientY, false);
        }}
        onPointerMove={(event) => {
          if (isDragging) selectFromPointer(event.clientX, event.clientY, false);
        }}
        onPointerUp={(event) => {
          if (isDragging) {
            setIsDragging(false);
            selectFromPointer(event.clientX, event.clientY, true);
          }
        }}
        className="relative cursor-pointer rounded-full bg-surface touch-none"
        style={{ width: DIAL_SIZE, height: DIAL_SIZE }}
      >
        {Array.from({ length: TICKS }, (_, index) => {
          const point = pointForAngle(index * (360 / TICKS), DIAL_RADIUS);
          const label = index % 4 === 0;
          return label ? (
            <span
              key={index}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-xs font-medium text-text-muted"
              style={{ left: point.x, top: point.y }}
            >
              {clockFromPosition(index * TIME_STEP_MINUTES, 'AM').hour}
            </span>
          ) : null;
        })}

        <svg className="pointer-events-none absolute inset-0" width={DIAL_SIZE} height={DIAL_SIZE}>
          <g
            className="transition-opacity duration-300 ease-out"
            style={{ opacity: stage === 'end' ? 1 : 0 }}
          >
            {arcPaths(startAngle, duration).map((path, index) => (
              <path key={index} d={path} fill="none" stroke="currentColor" strokeWidth={12} className="text-text-muted" />
            ))}
            <circle cx={startPoint.x} cy={startPoint.y} r={12} fill="currentColor" className="text-text-muted opacity-25" />
          </g>
          <g
            style={{
              transform: `rotate(${handAngle}deg)`,
              transformOrigin: `${CENTER}px ${CENTER}px`,
              transformBox: 'view-box',
              transition: animateSelection ? 'transform 300ms ease-out' : 'none',
            }}
          >
            <line
              x1={CENTER}
              y1={CENTER}
              x2={CENTER}
              y2={CENTER - DIAL_RADIUS}
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="text-text"
            />
            <circle
              cx={CENTER}
              cy={CENTER - DIAL_RADIUS}
              r={14}
              fill="currentColor"
              stroke="var(--text)"
              strokeWidth={3}
              className="text-highlight"
            />
          </g>
          <circle cx={CENTER} cy={CENTER} r={3} fill="currentColor" className="text-text" />
        </svg>
      </div>

      <div className="mt-3 flex gap-2 text-xs">
        {(['AM', 'PM'] as const).map((period) => (
          <Button
            key={`start-${period}`}
            type="button"
            variant={start.period === period ? 'primary' : 'secondary'}
            className="px-2 py-1"
            onClick={() => setStart((current) => ({ ...current, period }))}
          >
            Start {period}
          </Button>
        ))}
      </div>

      <div className="mt-4 flex w-full justify-end gap-2">
        <Button type="button" variant="ghost" className="text-xs" onClick={onClose}>Cancel</Button>
        <Button type="button" className="px-4 text-xs" onClick={() => onConfirm(minutesToTime(startMinutes), minutesToTime(endMinutes))}>OK</Button>
      </div>
    </DialogContent>
  );
}

export function TimePickerDialog({ open, startValue, endValue, onOpenChange, onConfirm, title = 'Select interval' }: TimePickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <TimePickerInner
          key={`${startValue ?? ''}-${endValue ?? ''}`}
          startValue={startValue}
          endValue={endValue}
          title={title}
          onClose={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      )}
    </Dialog>
  );
}
