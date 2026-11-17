import clsx from 'clsx';
import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Check, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { ApiProblem } from '../lib/api';

/*
 * Material 3 building blocks for a phone-first PWA: pill buttons, 48 px touch targets, 56 px fields,
 * rounded cards, bottom sheets on phones and centred dialogs on wide screens.
 */

// ── Buttons ──
type Variant = 'primary' | 'tonal' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', size = 'md', loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-[0.01em] whitespace-nowrap transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' && 'h-9 px-4 text-sm', size === 'md' && 'h-10 px-5 text-sm', size === 'lg' && 'h-12 px-6 text-base',
        variant === 'primary' && 'bg-primary text-on-primary shadow-[var(--shadow-1)] hover:brightness-110',
        variant === 'tonal' && 'bg-primary-container text-on-primary-container hover:brightness-95',
        variant === 'secondary' && 'border border-outline-variant bg-transparent text-primary hover:bg-primary/8',
        variant === 'ghost' && 'text-primary hover:bg-primary/8',
        variant === 'danger' && 'bg-error text-white hover:brightness-110',
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** Round icon button (48 px target). */
export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button {...rest} aria-label={label} title={label} className={clsx('relative inline-flex size-12 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-on-surface/8 active:bg-on-surface/12', className)}>
      {children}
    </button>
  );
}

/** Floating action button; `label` makes it an extended FAB. Sits above the bottom navigation on phones. */
export function Fab({ icon, label, onClick, className }: { icon: ReactNode; label?: string; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label ?? 'Add'}
      className={clsx(
        'fixed end-4 z-30 inline-flex h-14 items-center gap-3 rounded-2xl bg-primary-container px-4 font-medium text-on-primary-container shadow-[var(--shadow-3)] transition active:scale-95',
        'bottom-[calc(env(safe-area-inset-bottom)+88px)] lg:bottom-8 lg:end-8',
        !label && 'w-14 justify-center px-0',
        className,
      )}
    >
      {icon}
      {label && <span className="pe-1">{label}</span>}
    </button>
  );
}

// ── Surfaces ──
export function Card({ className, children, title, actions, padded = true }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode; padded?: boolean }) {
  return (
    // min-w-0 lets a card shrink inside grids, so wide tables scroll inside the card instead of widening the page.
    <section className={clsx('min-w-0 rounded-[var(--radius-card)] border border-outline-variant/60 bg-surface-container-lowest', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4 pb-2">
          <h2 className="text-base font-semibold text-on-surface">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={clsx(padded && 'p-4', padded && (title || actions) && 'pt-1')}>{children}</div>
    </section>
  );
}

/** Small heading above a group of cards or list items. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex items-center justify-between px-1">
      <h2 className="text-sm font-semibold text-on-surface-variant">{children}</h2>
      {action}
    </div>
  );
}

// ── Chips and badges ──
const tones = {
  neutral: 'bg-surface-container-high text-on-surface-variant',
  ok: 'bg-success-container text-success',
  warn: 'bg-warning-container text-warning',
  bad: 'bg-error-container text-error',
  info: 'bg-info-container text-info-role',
  brand: 'bg-primary-container text-on-primary-container',
} as const;
export type Tone = keyof typeof tones;
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex h-6 items-center gap-1 rounded-lg px-2 text-xs font-medium whitespace-nowrap', tones[tone], className)}>{children}</span>;
}

/** Horizontally scrolling filter chips (single choice). */
export function FilterChips<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1" role="listbox">
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            role="option"
            aria-selected={on}
            onClick={() => onChange(it.value)}
            className={clsx('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition', on ? 'border-transparent bg-secondary-container text-on-secondary-container' : 'border-outline-variant text-on-surface-variant hover:bg-on-surface/5')}
          >
            {on && <Check className="size-4" aria-hidden />}
            {it.label}
            {it.count !== undefined && <span className="text-xs opacity-70">{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── Lists ──
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).filter((w) => /^[A-Za-z؀-ۿ]/.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  return <span className={clsx('inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary-container text-sm font-semibold text-on-secondary-container', className)} aria-hidden>{initials}</span>;
}

/** A list row: optional leading avatar/icon, up to three lines, optional trailing content, chevron when tappable. */
export function ListItem({ leading, title, subtitle, meta, trailing, onClick, className }: { leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; meta?: ReactNode; trailing?: ReactNode; onClick?: () => void; className?: string }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={clsx('flex w-full items-center gap-3 px-4 py-3 text-start', onClick && 'transition hover:bg-on-surface/4 active:bg-on-surface/8', className)}>
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-on-surface">{title}</div>
        {subtitle && <div className="truncate text-sm text-on-surface-variant">{subtitle}</div>}
        {meta && <div className="mt-1 flex flex-wrap items-center gap-1.5">{meta}</div>}
      </div>
      {trailing}
      {onClick && !trailing && <ChevronRight className="size-5 shrink-0 text-outline rtl:rotate-180" aria-hidden />}
    </Tag>
  );
}

/** A card holding list items separated by dividers. */
export function ListCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('divide-y divide-outline-variant/50 overflow-hidden rounded-[var(--radius-card)] border border-outline-variant/60 bg-surface-container-lowest', className)}>{children}</div>;
}

// ── Inputs ──
export function Field({ label, hint, error, required, children, className }: { label: string; hint?: string; error?: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1.5 block text-sm font-medium text-on-surface-variant">
        {label}
        {required && <span className="text-error"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-on-surface-variant">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-error">{error}</span>}
    </label>
  );
}

/** Full width unless the caller sets its own width. */
const width = (c?: string) => (c && /(^|\s)(w-|max-w-|flex-1|min-w-)/.test(c) ? '' : 'w-full');
const inputCls = 'rounded-xl border border-outline-variant bg-surface-container-lowest px-4 text-base text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:bg-surface-container sm:text-sm';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} {...rest} className={clsx(inputCls, width(className), 'h-12', className)} />;
});
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={clsx(inputCls, width(className), 'h-12 pe-8', className)}>
      {children}
    </select>
  );
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={clsx(inputCls, 'min-h-24 w-full py-3', className)} />;
}

/** M3 search bar (pill). */
export function SearchBar({ value, onChange, onSubmit, placeholder, autoFocus, trailing }: { value: string; onChange: (v: string) => void; onSubmit?: () => void; placeholder: string; autoFocus?: boolean; trailing?: ReactNode }) {
  return (
    <form
      role="search"
      className="flex h-14 items-center gap-3 rounded-full bg-surface-container-high px-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <Search className="size-5 shrink-0 text-on-surface-variant" aria-hidden />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-base text-on-surface placeholder:text-on-surface-variant focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} className="rounded-full p-1 text-on-surface-variant hover:bg-on-surface/8" aria-label="Clear search">
          <X className="size-5" />
        </button>
      )}
      {trailing}
    </form>
  );
}

// ── Feedback ──
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-on-surface-variant" role="status">
      <Loader2 className="size-5 animate-spin text-primary" aria-hidden /> {label ?? 'Loading…'}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-xl bg-surface-container-high', className)} aria-hidden />;
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 rounded-full bg-surface-container-high p-4 text-on-surface-variant">{icon}</div>}
      <p className="text-base font-medium text-on-surface">{title}</p>
      {children && <div className="max-w-sm text-sm text-on-surface-variant">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Page title block (headline) with optional actions. The app bar above it carries back and notifications. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-on-surface">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Dialog built on <dialog> (focus trap and Escape handled by the browser).
 * On phones it is a bottom sheet anchored to the screen bottom; on wide screens a centred dialog.
 */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // tap on the scrim closes
      }}
      className={clsx(
        'animate-sheet bg-surface-container-low p-0 text-on-surface shadow-[var(--shadow-3)] backdrop:bg-black/40',
        // Phone: bottom sheet
        'mx-0 mt-auto mb-0 w-full max-w-none rounded-t-[var(--radius-sheet)]',
        // Wide screens: centred dialog
        'sm:m-auto sm:w-[calc(100%-2rem)] sm:rounded-[var(--radius-sheet)]',
        wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col">
          <div className="flex justify-center pt-3 sm:hidden" aria-hidden><span className="h-1 w-8 rounded-full bg-outline-variant" /></div>
          <header className="flex items-center justify-between gap-2 px-5 pt-3 pb-2 sm:pt-5">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded-full p-2 text-on-surface-variant hover:bg-on-surface/8" aria-label="Close">
              <X className="size-5" />
            </button>
          </header>
          <div className="overflow-y-auto px-5 pb-4">{children}</div>
          {footer && <footer className="pb-safe flex justify-end gap-2 border-t border-outline-variant/60 px-5 py-3 [&>button]:flex-1 sm:[&>button]:flex-none">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** Shows the API's problem details verbatim — including every unmet gate condition. */
export function ProblemAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const p = error instanceof ApiProblem ? error : null;
  return (
    <div role="alert" className="rounded-xl bg-error-container px-4 py-3 text-sm text-error">
      <p className="font-medium">{p?.detail ?? p?.title ?? (error as Error).message ?? 'Something went wrong'}</p>
      {p && p.errors.length > 0 && (
        <ul className="mt-1 list-disc ps-5">
          {p.errors.map((e, i) => (
            <li key={i}>{e.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Scrollable tabs (M3 secondary tabs). */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[] }) {
  return (
    <div role="tablist" className="no-scrollbar -mx-4 flex overflow-x-auto border-b border-outline-variant/70 px-2 sm:mx-0 sm:px-0">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx('relative flex h-12 shrink-0 items-center gap-2 px-4 text-sm font-medium whitespace-nowrap transition', value === it.value ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface')}
        >
          {it.label}
          {it.count !== undefined && <span className={clsx('rounded-full px-1.5 text-xs', value === it.value ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-high')}>{it.count}</span>}
          {value === it.value && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-primary" />}
        </button>
      ))}
    </div>
  );
}

/** Data table on wide screens; scrolls sideways inside its card on phones rather than widening the page. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className="w-full text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-start [&_th]:text-xs [&_th]:font-medium [&_th]:text-on-surface-variant [&_th]:whitespace-nowrap [&_tbody_tr]:border-t [&_tbody_tr]:border-outline-variant/50 [&_tbody_tr:hover]:bg-on-surface/3">
        {children}
      </table>
    </div>
  );
}

export function Stat({ label, value, tone, hint, onClick }: { label: string; value: ReactNode; tone?: Tone; hint?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={clsx('rounded-[var(--radius-card)] bg-surface-container-lowest p-4 text-start ring-1 ring-outline-variant/60', onClick && 'transition active:scale-[0.98]')}>
      <p className="text-xs font-medium text-on-surface-variant">{label}</p>
      <p className={clsx('mt-1 truncate text-2xl font-semibold tabular', tone === 'bad' && 'text-error', tone === 'warn' && 'text-warning', tone === 'ok' && 'text-success')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-on-surface-variant">{hint}</p>}
    </Tag>
  );
}

/** Wizard progress: numbered steps with labels; done steps show a tick. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span className={clsx('inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold', done ? 'bg-primary text-on-primary' : active ? 'bg-primary-container text-on-primary-container ring-2 ring-primary' : 'bg-surface-container-high text-on-surface-variant')}>
              {done ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={clsx('truncate text-xs font-medium', active ? 'text-on-surface' : 'text-on-surface-variant')}>{label}</span>
            {i < steps.length - 1 && <span className={clsx('hidden h-px flex-1 sm:block', done ? 'bg-primary' : 'bg-outline-variant')} />}
          </li>
        );
      })}
    </ol>
  );
}

/** Two- or three-way segmented button. */
export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="grid rounded-full border border-outline p-0.5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} role="radiogroup">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="radio"
          aria-checked={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx('inline-flex h-10 items-center justify-center gap-1.5 rounded-full text-sm font-medium transition', value === it.value ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant hover:bg-on-surface/5')}
        >
          {value === it.value && <Check className="size-4" />}
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ── Snackbar (short confirmation at the bottom of the screen) ──
type SnackbarApi = { show: (message: string) => void };
const SnackbarCtx = createContext<SnackbarApi>({ show: () => undefined });
export const useSnackbar = () => useContext(SnackbarCtx);

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMessage(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3500);
  }, []);
  return (
    <SnackbarCtx.Provider value={{ show }}>
      {children}
      {message && (
        <div role="status" className="animate-sheet fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+92px)] z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-[#2b3230] px-4 py-3 text-sm text-white shadow-[var(--shadow-3)] lg:bottom-8">
          {message}
          <button onClick={() => setMessage(null)} className="font-medium text-[#8cd5ca]">OK</button>
        </div>
      )}
    </SnackbarCtx.Provider>
  );
}
