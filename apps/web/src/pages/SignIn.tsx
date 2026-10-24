import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Ship } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Field, Input, ProblemAlert } from '../components/ui';

/** Where to go after signing in: the page that asked for it, never another site. */
const nextPage = () => {
  const next = new URLSearchParams(window.location.search).get('next') ?? '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
};

/** Staff sign-in for the hosted demo. Customers never see this: their pages (/track, approval, driver, portal) are open. */
export function SignInPage() {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/session/login', { username, password });
      qc.clear(); // drop anything cached while signed out
      window.location.assign(nextPage());
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-surface px-4 pt-[max(env(safe-area-inset-top),48px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-on-primary"><Ship className="size-7" /></span>
          <div>
            <p className="text-xl font-semibold tracking-tight">ClearPort</p>
            <p className="text-sm text-on-surface-variant">Customs clearance & delivery</p>
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <form className="mt-5 space-y-4" onSubmit={(e) => void submit(e)}>
          <Field label="Username"><Input id="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required /></Field>
          <Field label="Password">
            <div className="relative">
              <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pe-12" required />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute inset-y-0 end-0 flex w-12 items-center justify-center text-on-surface-variant">
                {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            </div>
          </Field>
          <ProblemAlert error={error} />
          <Button type="submit" size="lg" variant="primary" className="w-full" loading={busy}>Sign in</Button>
        </form>
        <p className="mt-6 rounded-xl bg-surface-container px-3 py-2 text-sm text-on-surface-variant">Demo: <span className="font-mono">demouser</span> / <span className="font-mono">Demo@123</span></p>
      </div>
    </div>
  );
}
