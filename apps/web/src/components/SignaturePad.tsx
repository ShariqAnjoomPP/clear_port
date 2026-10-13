import { useEffect, useRef } from 'react';
import { Button } from './ui';

/** Touch/mouse signature capture for proof of delivery. Emits a PNG data URL. */
export function SignaturePad({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f1b2a';
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  return (
    <div>
      <canvas
        ref={canvas}
        className="h-36 w-full touch-none rounded-lg border border-dashed border-line bg-canvas"
        aria-label="Signature area"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = canvas.current!.getContext('2d')!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          canvas.current!.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvas.current!.getContext('2d')!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          onChange(canvas.current!.toDataURL('image/png'));
        }}
      />
      <div className="mt-1 flex items-center justify-between text-xs text-muted">
        <span>{value ? 'Signature captured' : 'Ask the receiver to sign above'}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            const c = canvas.current!;
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
            onChange('');
          }}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
