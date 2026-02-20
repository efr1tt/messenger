'use client';

import { FormEvent, useMemo, useState } from 'react';
import styles from './page.module.css';

type AuthMode = 'register' | 'login';

type AuthResponse = {
  user: {
    id: string;
    email: string;
    createdAt: string;
    updatedAt: string;
  };
  accessToken: string;
  refreshToken: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001';

export default function Home() {
  const [mode, setMode] = useState<AuthMode>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AuthResponse | null>(null);

  const submitLabel = useMemo(
    () => (mode === 'register' ? 'Create Account' : 'Sign In'),
    [mode],
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/auth/${mode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const message = data?.message;
        throw new Error(Array.isArray(message) ? message.join(', ') : (message || 'Auth failed'));
      }

      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));

      setResult(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.panel}>
        <div className={styles.heading}>
          <p className={styles.badge}>Messenger MVP</p>
          <h1>Email Authentication</h1>
          <p className={styles.subtitle}>
            Start with email + password registration. You can add SMS login later when it is worth the cost.
          </p>
        </div>

        <div className={styles.switcher}>
          <button
            type="button"
            className={mode === 'register' ? styles.switcherActive : styles.switcherBtn}
            onClick={() => setMode('register')}
          >
            Register
          </button>
          <button
            type="button"
            className={mode === 'login' ? styles.switcherActive : styles.switcherBtn}
            onClick={() => setMode('login')}
          >
            Login
          </button>
        </div>

        <form className={styles.form} onSubmit={onSubmit}>
          <label className={styles.label}>
            Email
            <input
              className={styles.input}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className={styles.label}>
            Password
            <input
              className={styles.input}
              type="password"
              placeholder="Minimum 8 chars"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>

          <button className={styles.submit} type="submit" disabled={loading}>
            {loading ? 'Please wait...' : submitLabel}
          </button>
        </form>

        {error ? <p className={styles.error}>{error}</p> : null}

        {result ? (
          <section className={styles.success}>
            <h2>Success</h2>
            <p>Signed in as {result.user.email}</p>
            <p>Tokens are saved to localStorage.</p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
