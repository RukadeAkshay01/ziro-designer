import type { JSX, ReactNode } from 'react';
import { authEnabled } from './supabaseClient.js';
import { useAuth } from './AuthProvider.js';

/**
 * Guest-first entry: the app is never blocked behind sign-in. New users land
 * directly in the project manager and work saves locally (IndexedDB); signing
 * in — offered from the home page, not forced here — adds cloud backup and
 * pushes any guest-made projects up on first sign-in (cloud/sync.ts).
 *
 * The only thing this gate still does is hold the first paint for the brief
 * moment Supabase resolves an *existing* session, so a signed-in user doesn't
 * flash the signed-out UI on every reload.
 */
export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const { loading } = useAuth();

  if (authEnabled && loading) {
    return (
      <div className="ze-auth">
        <div className="ze-auth-splash">Ziro Designer…</div>
      </div>
    );
  }
  return <>{children}</>;
}
