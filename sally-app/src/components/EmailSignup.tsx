import { useState, useRef, useCallback } from 'react';

type Variant = 'inline' | 'compact';
type State = 'idle' | 'input' | 'submitting' | 'success' | 'error';

export function EmailSignup({ variant }: { variant: Variant }) {
  const [state, setState] = useState<State>('idle');
  const [email, setEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const openInput = useCallback(() => {
    setState('input');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const validate = (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!validate(email)) {
        setErrorMsg('Please enter a valid email.');
        setState('error');
        return;
      }

      setState('submitting');
      try {
        const res = await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setState('success');
        } else {
          setErrorMsg(data.error ?? 'Something went wrong.');
          setState('error');
        }
      } catch {
        setErrorMsg('Network error. Please try again.');
        setState('error');
      }
    },
    [email],
  );

  const isCompact = variant === 'compact';

  if (state === 'success') {
    return (
      <span className={`email-signup-success ${isCompact ? 'compact' : ''}`} role="status">
        You're on the list!
      </span>
    );
  }

  if (state === 'idle') {
    return (
      <button
        className={isCompact ? 'nav-cta' : 'btn-primary'}
        onClick={openInput}
        type="button"
      >
        Get Early Access
      </button>
    );
  }

  return (
    <form
      className={`email-signup ${isCompact ? 'compact' : ''}`}
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="email-signup-field">
        <input
          ref={inputRef}
          className="email-signup-input"
          type="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === 'error') setState('input');
          }}
          disabled={state === 'submitting'}
          aria-label="Email address"
          aria-invalid={state === 'error'}
          required
        />
        <button
          className="email-signup-submit"
          type="submit"
          disabled={state === 'submitting'}
          aria-label="Join early access list"
        >
          {state === 'submitting' ? '...' : 'Join'}
        </button>
      </div>
      {state === 'error' && (
        <p className="email-signup-error" role="alert">{errorMsg}</p>
      )}
    </form>
  );
}
