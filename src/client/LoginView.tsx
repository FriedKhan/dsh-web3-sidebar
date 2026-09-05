/**
 * The web3 login gate rendered in the sidebar panel while the wallet is
 * locked (Sidebar.tsx swaps it in for the workbench). It offers three
 * visually distinct sign-in methods — Create / Import / Connect — plus an
 * Unlock screen for a returning wallet. All copy is locale-owned (`t()`); the
 * wallet actions run against {@link WalletStore} (a UI-first mock in M1, a
 * Host-backed keystore in M2 behind the same surface).
 */
import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import css from './LoginView.module.css'
import { t } from './locales.ts'
import { shortAddress, useWallet, type WalletStore } from './wallet.ts'

type Mode = 'auto' | 'choose' | 'create' | 'import' | 'connect' | 'unlock'

const MIN_PASSWORD = 8

/** Wallet glyph (mark + Create method). */
function IconWallet(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
      <path d="M21 12a2 2 0 0 0-2-2h-4a2 2 0 0 0 0 4h4a2 2 0 0 0 2-2Z" />
    </svg>
  )
}

/** Key glyph (Import method). */
function IconKey(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 8.3-8.3" />
      <path d="m17 5 2 2" />
      <path d="m15 7 2 2" />
    </svg>
  )
}

/** Plug glyph (Connect method). */
function IconPlug(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  )
}

/** Chevron for a method row. */
function IconChevron(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

interface MethodRowProps {
  variant: string | undefined
  icon: ReactNode
  title: string
  desc: string
  onClick: () => void
}

function MethodRow({ variant, icon, title, desc, onClick }: MethodRowProps): ReactNode {
  return (
    <button type="button" className={clsx(css.method, variant)} onClick={onClick}>
      <span className={css.iconBox}>{icon}</span>
      <span className={css.methodText}>
        <span className={css.methodTitle}>{title}</span>
        <span className={css.methodDesc}>{desc}</span>
      </span>
      <span className={css.chevron}><IconChevron /></span>
    </button>
  )
}

/** The gate. `wallet` is the store; unlocking it makes Sidebar reveal the workbench. */
export function LoginView({ wallet }: { wallet: WalletStore }): ReactNode {
  const snap = useWallet(wallet)
  // 'auto' resolves to Unlock when a wallet already exists, else the chooser —
  // re-resolving after the host status loads (or after "use a different wallet").
  const [mode, setMode] = useState<Mode>('auto')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [secret, setSecret] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = (): void => { setPassword(''); setConfirm(''); setSecret(''); setLabel(''); setError(null) }
  const goto = (next: Mode): void => { reset(); setMode(next) }

  /** Run an async wallet action with busy/error handling. */
  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const onCreate = (): void => {
    if (password.length < MIN_PASSWORD) { setError(t('w3ErrPasswordShort')); return }
    if (password !== confirm) { setError(t('w3ErrPasswordMismatch')); return }
    void run(() => wallet.createWallet({ password, label: label.trim() || undefined }))
  }

  const onImport = (): void => {
    if (secret.trim() === '') { setError(t('w3ErrSecretEmpty')); return }
    if (password.length < MIN_PASSWORD) { setError(t('w3ErrPasswordShort')); return }
    void run(() => wallet.importWallet({ secret, password, label: label.trim() || undefined }))
  }

  const onConnect = (): void => { void run(() => wallet.connectExternal()) }

  const onUnlock = (): void => {
    void run(async () => {
      const ok = await wallet.unlock({ password })
      if (!ok) setError(t('w3ErrWrongPassword'))
    })
  }

  const onForget = (): void => { void run(async () => { await wallet.forget(); setMode('auto') }) }

  const brand = (
    <div className={css.brand}>
      <span className={css.mark}><IconWallet /></span>
      <span className={css.brandTitle}>{t('w3Brand')}</span>
    </div>
  )

  const screen = mode === 'auto' ? (snap.hasWallet ? 'unlock' : 'choose') : mode

  let body: ReactNode
  if (snap.status === 'loading') {
    body = (
      <>
        {brand}
        <h2 className={css.heading}>{t('w3Loading')}</h2>
      </>
    )
  } else if (screen === 'unlock') {
    body = (
      <>
        {brand}
        <h2 className={css.heading}>{t('w3UnlockHeading')}</h2>
        <p className={css.subtitle}>{t('w3UnlockSubtitle')}</p>
        {snap.stored !== undefined && (
          <div className={css.addressPill}><IconWallet />{shortAddress(snap.stored.address)}</div>
        )}
        <div className={css.field}>
          <label className={css.label} htmlFor="w3-unlock-pw">{t('w3PasswordLabel')}</label>
          <input
            id="w3-unlock-pw" className={css.input} type="password" value={password} autoFocus
            placeholder={t('w3PasswordPlaceholder')}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') onUnlock() }}
          />
        </div>
        {error !== null && <div className={css.error}>{error}</div>}
        <div className={css.actions}>
          <button type="button" className={css.primary} disabled={busy} onClick={onUnlock}>
            {busy ? t('w3Working') : t('w3UnlockAction')}
          </button>
        </div>
        <div className={css.linkRow}>
          <button type="button" className={css.link} onClick={onForget}>{t('w3ForgetLink')}</button>
        </div>
      </>
    )
  } else if (screen === 'choose') {
    body = (
      <>
        {brand}
        <h2 className={css.heading}>{t('w3ConnectHeading')}</h2>
        <p className={css.subtitle}>{t('w3ConnectSubtitle')}</p>
        <div className={css.methods}>
          <MethodRow variant={css.methodCreate} icon={<IconWallet />} title={t('w3MethodCreateTitle')} desc={t('w3MethodCreateDesc')} onClick={() => goto('create')} />
          <MethodRow variant={css.methodImport} icon={<IconKey />} title={t('w3MethodImportTitle')} desc={t('w3MethodImportDesc')} onClick={() => goto('import')} />
          <MethodRow variant={css.methodConnect} icon={<IconPlug />} title={t('w3MethodConnectTitle')} desc={t('w3MethodConnectDesc')} onClick={() => goto('connect')} />
        </div>
      </>
    )
  } else if (screen === 'create') {
    body = (
      <>
        {brand}
        <h2 className={css.heading}>{t('w3CreateHeading')}</h2>
        <div className={css.field}>
          <label className={css.label} htmlFor="w3-create-pw">{t('w3PasswordLabel')}</label>
          <input id="w3-create-pw" className={css.input} type="password" value={password} autoFocus
            placeholder={t('w3PasswordPlaceholder')} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <div className={css.field}>
          <label className={css.label} htmlFor="w3-create-confirm">{t('w3ConfirmLabel')}</label>
          <input id="w3-create-confirm" className={css.input} type="password" value={confirm}
            placeholder={t('w3ConfirmPlaceholder')} onChange={(event) => setConfirm(event.target.value)} />
        </div>
        <div className={css.field}>
          <label className={css.label} htmlFor="w3-create-label">{t('w3LabelLabel')}</label>
          <input id="w3-create-label" className={css.input} type="text" value={label}
            placeholder={t('w3LabelPlaceholder')} onChange={(event) => setLabel(event.target.value)} />
        </div>
        {error !== null && <div className={css.error}>{error}</div>}
        <div className={css.actions}>
          <button type="button" className={css.ghost} onClick={() => goto('choose')}>{t('w3Back')}</button>
          <button type="button" className={css.primary} disabled={busy} onClick={onCreate}>
            {busy ? t('w3Working') : t('w3CreateAction')}
          </button>
        </div>
        <div className={css.note}>{t('w3CreateNote')}</div>
      </>
    )
  } else if (screen === 'import') {
    body = (
      <>
        {brand}
        <h2 className={css.heading}>{t('w3ImportHeading')}</h2>
        <div className={css.field}>
          <label className={css.label} htmlFor="w3-import-secret">{t('w3SecretLabel')}</label>
          <textarea id="w3-import-secret" className={css.textarea} value={secret} autoFocus
            placeholder={t('w3SecretPlaceholder')} onChange={(event) => setSecret(event.target.value)} />
        </div>
        <div className={css.field}>
          <label className={css.label} htmlFor="w3-import-pw">{t('w3PasswordLabel')}</label>
          <input id="w3-import-pw" className={css.input} type="password" value={password}
            placeholder={t('w3PasswordPlaceholder')} onChange={(event) => setPassword(event.target.value)} />
        </div>
        {error !== null && <div className={css.error}>{error}</div>}
        <div className={css.actions}>
          <button type="button" className={css.ghost} onClick={() => goto('choose')}>{t('w3Back')}</button>
          <button type="button" className={css.primary} disabled={busy} onClick={onImport}>
            {busy ? t('w3Working') : t('w3ImportAction')}
          </button>
        </div>
        <div className={css.note}>{t('w3CreateNote')}</div>
      </>
    )
  } else {
    body = (
      <>
        {brand}
        <h2 className={css.heading}>{t('w3ConnectHeadingExt')}</h2>
        <p className={css.subtitle}>{t('w3MethodConnectDesc')}</p>
        {error !== null && <div className={css.error}>{error}</div>}
        <div className={css.actions}>
          <button type="button" className={css.ghost} onClick={() => goto('choose')}>{t('w3Back')}</button>
          <button type="button" className={css.primary} disabled={busy} onClick={onConnect}>
            {busy ? t('w3Working') : t('w3ConnectAction')}
          </button>
        </div>
        <div className={css.note}>{t('w3ConnectNote')}</div>
      </>
    )
  }

  return (
    <div className={css.gate}>
      <div className={css.card}>{body}</div>
    </div>
  )
}
