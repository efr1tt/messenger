"use client"

import { forgotPassword, login, register } from "@/entities/session/api/auth"
import { getAccessToken, saveSession } from "@/entities/session/model/storage"
import { AxiosError } from "axios"
import { FormEvent, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import styles from "./page.module.css"

type AuthMode = "register" | "login"

export default function Home() {
  const router = useRouter()
  const [mode, setMode] = useState<AuthMode>("register")
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successEmail, setSuccessEmail] = useState<string | null>(null)
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false)
  const [forgotMessage, setForgotMessage] = useState<string | null>(null)
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(
    null
  )

  useEffect(() => {
    const token = getAccessToken()
    if (token) {
      router.replace("/chat")
    }
  }, [router])

  const submitLabel = useMemo(
    () => (mode === "register" ? "Создать аккаунт" : "Войти в аккаунт"),
    [mode]
  )
  const isRecoveryMode = mode === "login" && forgotPasswordOpen

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setForgotMessage(null)
    setTemporaryPassword(null)

    try {
      const data =
        mode === "register"
          ? await register({ username, displayName, email, password })
          : await login({ email, password })

      saveSession(data)
      setSuccessEmail(data.user.username)
      router.push("/chat")
    } catch (err) {
      const fallback = "Authentication failed"

      if (err instanceof AxiosError) {
        const apiError = err as AxiosError<{ message?: string | string[] }>
        const message = apiError.response?.data?.message
        const parsedMessage = Array.isArray(message)
          ? message.join(", ")
          : message
        setError(parsedMessage || fallback)
      } else {
        setError(fallback)
      }

      setSuccessEmail(null)
    } finally {
      setLoading(false)
    }
  }

  async function onForgotPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setForgotLoading(true)
    setError(null)
    setForgotMessage(null)
    setTemporaryPassword(null)

    try {
      const data = await forgotPassword(email)
      setForgotMessage(data.message)
      setTemporaryPassword(data.temporaryPassword || null)
    } catch (err) {
      const fallback = "Failed to recover password"

      if (err instanceof AxiosError) {
        const apiError = err as AxiosError<{ message?: string | string[] }>
        const message = apiError.response?.data?.message
        const parsedMessage = Array.isArray(message)
          ? message.join(", ")
          : message
        setError(parsedMessage || fallback)
      } else {
        setError(fallback)
      }
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.shell}>
        <section className={styles.panel}>
          <div className={styles.heading}>
            <p className={styles.badge}>SweetyCall</p>
            <h2>
              {mode === "register" ? "Создать аккаунт" : "С возвращением"}
            </h2>
            <p className={styles.subtitleSmall}>
              {mode === "register"
                ? "На связи с близкими..."
                : "Войдите, чтобы созвониться..."}
            </p>
          </div>

          <div className={styles.switcher}>
            <button
              type="button"
              className={
                mode === "register" ? styles.switcherActive : styles.switcherBtn
              }
              onClick={() => {
                setMode("register")
                setForgotPasswordOpen(false)
                setForgotMessage(null)
                setTemporaryPassword(null)
              }}
            >
              Зарегистрироваться
            </button>
            <button
              type="button"
              className={
                mode === "login" ? styles.switcherActive : styles.switcherBtn
              }
              onClick={() => {
                setMode("login")
                setForgotMessage(null)
                setTemporaryPassword(null)
              }}
            >
              Войти
            </button>
          </div>

          {!isRecoveryMode ? (
            <form className={styles.form} onSubmit={onSubmit}>
              {mode === "register" ? (
                <>
                  <label className={styles.label}>
                    Логин
                    <input
                      className={styles.input}
                      type="text"
                      placeholder="nickname"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      minLength={3}
                      maxLength={20}
                      pattern="[a-zA-Z0-9_.]+"
                      required
                    />
                  </label>
                  <label className={styles.label}>
                    Имя
                    <input
                      className={styles.input}
                      type="text"
                      placeholder="Maxim"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      minLength={2}
                      maxLength={40}
                      required
                    />
                  </label>
                </>
              ) : null}

              <label className={styles.label}>
                Почта
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
                Пароль
                <input
                  className={styles.input}
                  type="password"
                  placeholder="Минимум 8 знаков"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  required
                />
              </label>

              {mode === "login" ? (
                <div className={styles.inlineActions}>
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => {
                      setForgotPasswordOpen(true)
                      setError(null)
                      setForgotMessage(null)
                      setTemporaryPassword(null)
                    }}
                  >
                    Забыли пароль?
                  </button>
                </div>
              ) : null}

              <button
                className={styles.submit}
                type="submit"
                disabled={loading}
              >
                {loading ? "Please wait..." : submitLabel}
              </button>
            </form>
          ) : (
            <form className={styles.recoveryCard} onSubmit={onForgotPassword}>
              <div className={styles.recoveryHeader}>
                <div>
                  <h3>Восстановление пароля</h3>
                  <p className={styles.hint}>Введите адрес электронной почты</p>
                </div>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => {
                    setForgotPasswordOpen(false)
                    setError(null)
                    setForgotMessage(null)
                    setTemporaryPassword(null)
                  }}
                >
                  Вернуться ко входу в аккаунт
                </button>
              </div>
              <label className={styles.label}>
                Почта
                <input
                  className={styles.input}
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <button
                className={styles.secondarySubmit}
                type="submit"
                disabled={forgotLoading}
              >
                {forgotLoading ? "Sending..." : "Отправить пароль на почту"}
              </button>
            </form>
          )}

          {error ? <p className={styles.error}>{error}</p> : null}

          {forgotMessage ? (
            <section className={styles.success}>
              <h3>Password recovery</h3>
              <p>{forgotMessage}</p>
              {temporaryPassword ? (
                <p>
                  Temporary password: <strong>{temporaryPassword}</strong>
                </p>
              ) : null}
            </section>
          ) : null}

          {successEmail ? (
            <section className={styles.success}>
              <h3>Success</h3>
              <p>Signed in as {successEmail}</p>
              <p>Redirecting to chat...</p>
            </section>
          ) : null}
        </section>
      </main>
    </div>
  )
}
