'use client';

import { login, register } from '@/entities/session/api/auth';
import {
  getAccessToken,
  saveSession,
} from '@/entities/session/model/storage';
import { AxiosError } from 'axios';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

type AuthMode = 'register' | 'login';

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      router.replace('/chat');
    }
  }, [router]);

  const submitLabel = useMemo(
    () => (mode === 'register' ? 'Create Account' : 'Sign In'),
    [mode],
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payload = { email, password };
      const data = mode === 'register' ? await register(payload) : await login(payload);

      saveSession(data);
      setSuccessEmail(data.user.email);
      router.push('/chat');
    } catch (err) {
      const fallback = 'Authentication failed';

      if (err instanceof AxiosError) {
        const apiError = err as AxiosError<{ message?: string | string[] }>;
        const message = apiError.response?.data?.message;
        const parsedMessage = Array.isArray(message) ? message.join(', ') : message;
        setError(parsedMessage || fallback);
      } else {
        setError(fallback);
      }

      setSuccessEmail(null);
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
            Start with email + password registration. SMS login can be added later.
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

        {successEmail ? (
          <section className={styles.success}>
            <h2>Success</h2>
            <p>Signed in as {successEmail}</p>
            <p>Redirecting to chat...</p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
