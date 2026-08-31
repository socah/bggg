'use client';

import { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export interface TimePickerDialogProps {
  open: boolean;
  value?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (value: string) => void;
  title?: string;
}

type PickerMode = 'hours' | 'minutes';
type Period = 'AM' | 'PM';

function parseTimeString(val?: string): { hour: number; minute: number; period: Period } {
  if (val) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(val.trim());
    if (match) {
      const h24 = parseInt(match[1], 10);
      const minute = Math.min(59, Math.max(0, parseInt(match[2], 10)));
      if (h24 >= 0 && h24 < 24) {
        const period: Period = h24 >= 12 ? 'PM' : 'AM';
        const hour = h24 % 12 === 0 ? 12 : h24 % 12;
        return { hour, minute, period };
      }
    }
  }
  return { hour: 6, minute: 0, period: 'PM' };
}

function formatTimeString(hour: number, minute: number, period: Period): string {
  let h24 = hour % 12;
  if (period === 'PM') {
    h24 += 12;
  }
  const hh = String(h24).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${hh}:${mm}`;
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

const DIAL_SIZE = 240;
const DIAL_RADIUS = 90;
const CENTER = DIAL_SIZE / 2;

interface TimePickerInnerProps {
  initialValue?: string;
  title: string;
  onClose: () => void;
  onConfirm: (val: string) => void;
}

function TimePickerInner({ initialValue, title, onClose, onConfirm }: TimePickerInnerProps) {
  const initial = parseTimeString(initialValue);
  const [mode, setMode] = useState<PickerMode>('hours');
  const [hour, setHour] = useState<number>(initial.hour);
  const [minute, setMinute] = useState<number>(initial.minute);
  const [period, setPeriod] = useState<Period>(initial.period);
  const [isDragging, setIsDragging] = useState(false);
  const dialRef = useRef<HTMLDivElement>(null);

  const handleDialPointer = useCallback(
    (clientX: number, clientY: number, isFinalSelection: boolean) => {
      if (!dialRef.current) return;
      const rect = dialRef.current.getBoundingClientRect();
      const x = clientX - rect.left - CENTER;
      const y = clientY - rect.top - CENTER;

      // Calculate angle from 12 o'clock in radians (0 to 2*PI)
      let angle = Math.atan2(y, x) + Math.PI / 2;
      if (angle < 0) {
        angle += 2 * Math.PI;
      }

      if (mode === 'hours') {
        const step = (2 * Math.PI) / 12;
        let selectedHour = Math.round(angle / step);
        if (selectedHour === 0) selectedHour = 12;
        if (selectedHour > 12) selectedHour = 12;
        setHour(selectedHour);
        if (isFinalSelection) {
          setMode('minutes');
        }
      } else {
        const step = (2 * Math.PI) / 60;
        let selectedMinute = Math.round(angle / step);
        if (selectedMinute >= 60) selectedMinute = 0;
        setMinute(selectedMinute);
      }
    },
    [mode]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    handleDialPointer(e.clientX, e.clientY, false);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    handleDialPointer(e.clientX, e.clientY, false);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      handleDialPointer(e.clientX, e.clientY, true);
    }
  };

  const currentAngle =
    mode === 'hours'
      ? (hour % 12) * (360 / 12)
      : minute * (360 / 60);

  const handRad = (currentAngle - 90) * (Math.PI / 180);
  const handX = CENTER + DIAL_RADIUS * Math.cos(handRad);
  const handY = CENTER + DIAL_RADIUS * Math.sin(handRad);

  return (
    <DialogContent className="max-w-xs p-4 flex flex-col items-center select-none">
      <DialogTitle className="text-xs font-semibold text-text-muted uppercase tracking-wider self-start mb-2">
        {title}
      </DialogTitle>

      {/* Digital display & AM/PM switch */}
      <div className="flex items-center justify-between w-full mb-4 px-2">
        <div className="flex items-center text-3xl font-display">
          <button
            type="button"
            onClick={() => setMode('hours')}
            className={cn(
              'rounded px-2 py-1 transition-colors',
              mode === 'hours'
                ? 'bg-highlight text-text font-bold'
                : 'bg-surface text-text-muted hover:text-text'
            )}
          >
            {String(hour).padStart(2, '0')}
          </button>
          <span className="mx-1 text-text-muted">:</span>
          <button
            type="button"
            onClick={() => setMode('minutes')}
            className={cn(
              'rounded px-2 py-1 transition-colors',
              mode === 'minutes'
                ? 'bg-highlight text-text font-bold'
                : 'bg-surface text-text-muted hover:text-text'
            )}
          >
            {String(minute).padStart(2, '0')}
          </button>
        </div>

        <div className="flex flex-col rounded border border-border overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setPeriod('AM')}
            className={cn(
              'px-2 py-1 transition-colors',
              period === 'AM'
                ? 'bg-highlight text-text font-semibold'
                : 'bg-surface text-text-muted hover:text-text'
            )}
          >
            AM
          </button>
          <button
            type="button"
            onClick={() => setPeriod('PM')}
            className={cn(
              'px-2 py-1 transition-colors border-t border-border',
              period === 'PM'
                ? 'bg-highlight text-text font-semibold'
                : 'bg-surface text-text-muted hover:text-text'
            )}
          >
            PM
          </button>
        </div>
      </div>

      {/* Clock Dial Face */}
      <div
        ref={dialRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="relative rounded-full bg-surface cursor-pointer touch-none"
        style={{ width: DIAL_SIZE, height: DIAL_SIZE }}
      >
        {/* Numbers */}
        {(mode === 'hours' ? HOURS : MINUTES).map((num, i) => {
          const angleDeg = i * (360 / 12);
          const rad = (angleDeg - 90) * (Math.PI / 180);
          const numX = CENTER + DIAL_RADIUS * Math.cos(rad);
          const numY = CENTER + DIAL_RADIUS * Math.sin(rad);
          const isSelected = mode === 'hours' ? hour === num : minute === num;

          return (
            <span
              key={num}
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 text-xs font-medium pointer-events-none',
                isSelected ? 'text-text font-bold z-10' : 'text-text-muted'
              )}
              style={{ left: numX, top: numY }}
            >
              {mode === 'hours' ? num : String(num).padStart(2, '0')}
            </span>
          );
        })}

        {/* SVG pointer line and selector knob */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={DIAL_SIZE}
          height={DIAL_SIZE}
        >
          {/* Center dot */}
          <circle cx={CENTER} cy={CENTER} r={3} fill="currentColor" className="text-text" />
          {/* Hand line */}
          <line
            x1={CENTER}
            y1={CENTER}
            x2={handX}
            y2={handY}
            stroke="currentColor"
            strokeWidth={2}
            className="text-text"
          />
          {/* Knob circle */}
          <circle
            cx={handX}
            cy={handY}
            r={14}
            fill="currentColor"
            className="text-highlight opacity-60"
          />
        </svg>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 w-full mt-4">
        <Button
          type="button"
          variant="ghost"
          className="text-xs"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className="text-xs px-4"
          onClick={() => {
            onConfirm(formatTimeString(hour, minute, period));
            onClose();
          }}
        >
          OK
        </Button>
      </div>
    </DialogContent>
  );
}

export function TimePickerDialog({
  open,
  value,
  onOpenChange,
  onConfirm,
  title = 'Select time',
}: TimePickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <TimePickerInner
          key={value || 'default'}
          initialValue={value}
          title={title}
          onClose={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      )}
    </Dialog>
  );
}
