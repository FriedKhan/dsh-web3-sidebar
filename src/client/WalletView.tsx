/**
 * The Wallet tab: the unlocked wallet's address, on-chain balance, a receive
 * panel, and a send form. Balance and transfers go through the host wallet
 * routes (the secret stays host-side). The external ("connected") demo path
 * shows the address only — on-chain actions need the host keystore.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import css from './WalletView.module.css'
import { t } from './locales.ts'
import { SidebarApiError } from './api.ts'
import { shortAddress, useWallet, type WalletStore } from './wallet.ts'

/** Wallet glyph for the tab icon and header. */
export function WalletTabIcon({ size = 16 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
      <path d="M21 12a2 2 0 0 0-2-2h-4a2 2 0 0 0 0 4h4a2 2 0 0 0 2-2Z" />
    </svg>
  )
}

const EXPLORER = 'https://explorer.solana.com'
const methodKey = { created: 'walletMethodCreated', imported: 'walletMethodImported', connected: 'walletMethodConnected' } as const

export function WalletView({ wallet, visible }: { wallet: WalletStore; visible?: boolean }): ReactNode {
  const snap = useWallet(wallet)
  const account = snap.account

  const [balance, setBalance] = useState<number | null>(null)
  const [balanceError, setBalanceError] = useState(false)
  const [loadingBalance, setLoadingBalance] = useState(false)
  const [copied, setCopied] = useState(false)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [sendPassword, setSendPassword] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [signature, setSignature] = useState<string | null>(null)
  const copiedTimer = useRef<number | null>(null)

  const external = account?.method === 'connected'

  const refreshBalance = useCallback(() => {
    if (external) return
    setLoadingBalance(true)
    setBalanceError(false)
    wallet.balance()
      .then(({ sol }) => setBalance(sol))
      .catch(() => setBalanceError(true))
      .finally(() => setLoadingBalance(false))
  }, [wallet, external])

  // Load the balance when the tab becomes visible for a custodial wallet.
  useEffect(() => {
    if (visible !== false && account !== undefined && !external) refreshBalance()
  }, [visible, account?.address, external, refreshBalance])

  useEffect(() => () => { if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current) }, [])

  if (account === undefined) return null

  const copyAddress = (): void => {
    void navigator.clipboard?.writeText(account.address).then(() => {
      setCopied(true)
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500)
    }).catch(() => { /* clipboard blocked; the address stays visible to copy by hand */ })
  }

  const onSend = (): void => {
    const value = Number(amount)
    if (!(value > 0) || !Number.isFinite(value)) return
    setSending(true)
    setSendError(null)
    setSignature(null)
    wallet.send(to.trim(), value, sendPassword)
      .then(({ signature: sig }) => { setSignature(sig); setTo(''); setAmount(''); setSendPassword(''); refreshBalance() })
      .catch((error: unknown) => setSendError(
        error instanceof SidebarApiError
          ? (error.code === 'wallet-bad-password' ? t('w3ErrWrongPassword') : error.message)
          : String(error),
      ))
      .finally(() => setSending(false))
  }

  const sendDisabled = sending || to.trim() === '' || !(Number(amount) > 0) || sendPassword === ''

  return (
    <div className={css.wallet}>
      <div className={css.card}>
        <div className={css.head}>
          <span className={css.mark}><WalletTabIcon size={18} /></span>
          <div className={css.headText}>
            <div className={css.addressRow}>
              <span className={css.address} title={account.address}>{shortAddress(account.address)}</span>
              <span className={css.methodBadge}>{t(methodKey[account.method])}</span>
            </div>
            <div className={css.network}>{t('walletNetwork')}{account.label !== undefined ? ` · ${account.label}` : ''}</div>
          </div>
        </div>

        <div className={css.balanceRow}>
          <span className={css.balanceLabel}>{t('walletBalance')}</span>
          <span className={css.balanceValue}>
            {external
              ? '—'
              : loadingBalance
                ? t('loading')
                : balanceError
                  ? t('walletBalanceError')
                  : balance !== null
                    ? `${balance.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL`
                    : '—'}
          </span>
        </div>

        <div className={css.actions}>
          <button type="button" className={css.ghost} onClick={copyAddress}>{copied ? t('copied') : t('copy')}</button>
          {!external && <button type="button" className={css.ghost} onClick={refreshBalance} disabled={loadingBalance}>{t('refresh')}</button>}
          <a className={css.ghost} href={`${EXPLORER}/address/${account.address}?cluster=devnet`} target="_blank" rel="noreferrer noopener">{t('walletExplorerAddress')}</a>
          <button type="button" className={css.ghost} onClick={() => { void wallet.lock() }}>{t('walletLock')}</button>
        </div>
      </div>

      <div className={css.card}>
        <div className={css.sectionTitle}>{t('walletReceive')}</div>
        <div className={css.receive} onClick={copyAddress} role="button" tabIndex={0}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') copyAddress() }}>
          {account.address}
        </div>
        <div className={css.hint}>{t('walletReceiveHint')}</div>
      </div>

      {external ? (
        <div className={css.note}>{t('walletExternalNote')}</div>
      ) : (
        <div className={css.card}>
          <div className={css.sectionTitle}>{t('walletSendTitle')}</div>
          <div className={css.field}>
            <label className={css.label} htmlFor="w3-send-to">{t('walletRecipient')}</label>
            <input id="w3-send-to" className={css.input} type="text" value={to}
              placeholder={t('walletRecipientPlaceholder')} onChange={(event) => setTo(event.target.value)} />
          </div>
          <div className={css.field}>
            <label className={css.label} htmlFor="w3-send-amount">{t('walletAmount')}</label>
            <input id="w3-send-amount" className={css.input} type="number" min="0" step="0.001" value={amount}
              placeholder="0.0" onChange={(event) => setAmount(event.target.value)} />
          </div>
          <div className={css.field}>
            <label className={css.label} htmlFor="w3-send-pw">{t('walletSendPassword')}</label>
            <input id="w3-send-pw" className={css.input} type="password" value={sendPassword}
              placeholder={t('walletSendPasswordPlaceholder')} onChange={(event) => setSendPassword(event.target.value)} />
          </div>
          <div className={css.hint}>{t('walletSendPasswordHint')}</div>
          {sendError !== null && <div className={css.error}>{sendError}</div>}
          {signature !== null && (
            <a className={css.success} href={`${EXPLORER}/tx/${signature}?cluster=devnet`} target="_blank" rel="noreferrer noopener">
              {t('walletSentSig')}
            </a>
          )}
          <button type="button" className={css.primary} onClick={onSend} disabled={sendDisabled}>
            {sending ? t('walletSending') : t('walletSendAction')}
          </button>
        </div>
      )}
    </div>
  )
}
