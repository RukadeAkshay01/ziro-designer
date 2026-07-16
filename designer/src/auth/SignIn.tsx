import { useState, type FormEvent, type JSX } from 'react';
import { useAuth } from './AuthProvider.js';

/**
 * Sign-in dialog — opened from the project manager (never a wall; the app is
 * usable as a guest). Methods, easiest first:
 *
 *   1. Continue with Google (OAuth redirect);
 *   2. Email code: enter your email, we send a 6-digit code, enter it, done —
 *      passwordless, and the account is created on first use (no separate
 *      sign-up or confirmation-link round trip);
 *   3. "Use a password instead" — the classic email+password pair, kept for
 *      existing accounts.
 *
 * On first sign-in the cloud sync pushes every guest-made local project up,
 * so nothing made before creating the account is lost.
 */
export function SignInDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { signIn, signUp, signInWithGoogle, sendOtp, verifyOtp } = useAuth();
  // 'code' = passwordless email code (default); 'password' = classic fallback.
  const [method, setMethod] = useState<'code' | 'password'>('code');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [password, setPassword] = useState('');
  const [pwMode, setPwMode] = useState<'signin' | 'signup'>('signin');
  const [confirmSent, setConfirmSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<{ error: string | null }>): Promise<boolean> => {
    setError(null);
    setBusy(true);
    try {
      const { error } = await fn();
      if (error) setError(error);
      return !error;
    } finally {
      setBusy(false);
    }
  };

  async function onSendCode(e: FormEvent) {
    e.preventDefault();
    if (await run(() => sendOtp(email))) setCodeSent(true);
  }

  async function onVerifyCode(e: FormEvent) {
    e.preventDefault();
    if (await run(() => verifyOtp(email, code.trim()))) onClose();
  }

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    if (pwMode === 'signin') {
      if (await run(() => signIn(email, password))) onClose();
    } else {
      setError(null);
      setBusy(true);
      try {
        const { error, needsConfirm } = await signUp(email, password);
        if (error) setError(error);
        else if (needsConfirm) setConfirmSent(true);
        else onClose();
      } finally {
        setBusy(false);
      }
    }
  }

  const emailField = (
    <label className="ze-auth-field">
      <span>Email</span>
      <input
        type="email"
        autoComplete="email"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
    </label>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-auth-card ze-auth-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Sign in"
      >
        <span className="ze-auth-close" title="Close" onClick={onClose}>
          ✕
        </span>
        <div className="ze-auth-brand">Ziro Designer</div>
        <div className="ze-auth-sub">
          Sign in to back up your projects to the cloud and use them on any device.
        </div>

        <button
          type="button"
          className="ze-auth-google"
          disabled={busy}
          onClick={() => void run(() => signInWithGoogle())}
        >
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
          Continue with Google
        </button>

        <div className="ze-auth-or">or</div>

        {method === 'code' && !codeSent && (
          <form onSubmit={onSendCode}>
            {emailField}
            {error && <div className="ze-auth-error">{error}</div>}
            <button type="submit" className="ze-auth-submit" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a sign-in code'}
            </button>
            <div className="ze-auth-toggle">
              No password needed — new accounts are created automatically.{' '}
              <button
                type="button"
                className="ze-auth-switch"
                onClick={() => setMethod('password')}
              >
                Use a password instead
              </button>
            </div>
          </form>
        )}

        {method === 'code' && codeSent && (
          <form onSubmit={onVerifyCode}>
            <div className="ze-auth-confirm-title">Check your email</div>
            <p className="ze-auth-note">
              We sent a 6-digit code to <strong>{email}</strong>. Enter it below.
            </p>
            <label className="ze-auth-field">
              <span>Code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            {error && <div className="ze-auth-error">{error}</div>}
            <button type="submit" className="ze-auth-submit" disabled={busy}>
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            <div className="ze-auth-toggle">
              <button
                type="button"
                className="ze-auth-switch"
                onClick={() => {
                  setCodeSent(false);
                  setCode('');
                  setError(null);
                }}
              >
                Use a different email
              </button>{' '}
              ·{' '}
              <button
                type="button"
                className="ze-auth-switch"
                disabled={busy}
                onClick={() => void run(() => sendOtp(email))}
              >
                Resend code
              </button>
            </div>
          </form>
        )}

        {method === 'password' && confirmSent && (
          <div className="ze-auth-confirm">
            <div className="ze-auth-confirm-title">Check your email</div>
            <p>
              We sent a confirmation link to <strong>{email}</strong>. Click it to activate your
              account, then come back and sign in.
            </p>
            <button
              type="button"
              className="ze-auth-switch"
              onClick={() => {
                setConfirmSent(false);
                setPwMode('signin');
              }}
            >
              Back to sign in
            </button>
          </div>
        )}

        {method === 'password' && !confirmSent && (
          <form onSubmit={onPassword}>
            {emailField}
            <label className="ze-auth-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete={pwMode === 'signin' ? 'current-password' : 'new-password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && <div className="ze-auth-error">{error}</div>}
            <button type="submit" className="ze-auth-submit" disabled={busy}>
              {busy ? 'Please wait…' : pwMode === 'signin' ? 'Sign in' : 'Sign up'}
            </button>
            <div className="ze-auth-toggle">
              {pwMode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
              <button
                type="button"
                className="ze-auth-switch"
                onClick={() => {
                  setError(null);
                  setPwMode(pwMode === 'signin' ? 'signup' : 'signin');
                }}
              >
                {pwMode === 'signin' ? 'Sign up' : 'Sign in'}
              </button>
              {' · '}
              <button type="button" className="ze-auth-switch" onClick={() => setMethod('code')}>
                Email me a code instead
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
