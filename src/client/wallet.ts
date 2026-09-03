/**
 * Client-side wallet state for the web3 login gate.
 *
 * UI-FIRST / M1: this is a MOCK. It generates a realistic-looking Solana
 * address and "unlocks" against a password digest kept in localStorage. NO
 * real keypair is generated and NO secret key is stored here. The real flow —
 * ed25519 keypair generation and a password-encrypted keystore file under
 * `$DSH_HOME/wallets/<id>/`, driven by a Host RPC — lands in M2 and swaps in
 * behind this exact public surface (create / import / connect / unlock).
 *
 * Security note held from day one: the secret key must never reach `ctx.fs`
 * (model-readable), a session event, a tool result, or a prompt. This mock
 * stores no secret at all, so it cannot leak one; M2 keeps the same rule.
 *
 * FIXME(M2): this gate is NOT a security boundary, by construction — not just
 * by weak crypto. `unlock()` compares a digest the same browser wrote, so
 * anyone can seed `localStorage` and unlock with any password. A real gate
 * requires the HOST to be the authority: the browser sends the password to a
 * `harness.handle` endpoint that decrypts the `$DSH_HOME/wallets/<id>/`
 * keystore and answers pass/fail. That authority cannot live behind this
 * client surface, so M1 protects nothing — it is a UI flow only.
 */
import { useSyncExternalStore } from 'react'

/** How the active wallet was established. */
export type WalletMethod = 'created' | 'imported' | 'connected'

/** The public, non-secret face of a wallet (address is safe to display/log). */
export interface WalletAccount {
  readonly address: string
  readonly method: WalletMethod
  readonly label?: string
}

/** Whether the workbench is reachable (`unlocked`) or gated (`locked`). */
export type WalletStatus = 'locked' | 'unlocked'

/** Immutable snapshot read by React through {@link useWallet}. */
export interface WalletSnapshot {
  readonly status: WalletStatus
  /** The unlocked account, or undefined while locked. */
  readonly account: WalletAccount | undefined
  /** Whether a wallet already exists on this device (drives Unlock vs Create). */
  readonly hasWallet: boolean
  /** The stored account's public metadata even while locked (address, method). */
  readonly stored: WalletAccount | undefined
}

/** The wallet store: an external store plus the login actions. */
export interface WalletStore {
  getSnapshot(): WalletSnapshot
  subscribe(listener: () => void): () => void
  /** Generate a new wallet, encrypt it with `password`, and unlock. */
  createWallet(input: { password: string; label?: string }): Promise<WalletAccount>
  /** Restore a wallet from a secret key or seed phrase and unlock. */
  importWallet(input: { secret: string; password: string; label?: string }): Promise<WalletAccount>
  /** Connect an external browser wallet (mocked in this UI-first build). */
  connectExternal(input?: { label?: string }): Promise<WalletAccount>
  /** Unlock the stored wallet; resolves false on a wrong password. */
  unlock(input: { password: string }): Promise<boolean>
  /** Re-lock without forgetting the stored wallet. */
  lock(): void
  /** Forget the stored wallet entirely (start over with a different one). */
  forget(): void
}

const STORAGE_KEY = 'dsh-web3-wallet:v1'
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** Standard base58 (Bitcoin alphabet) big-integer encoding of `bytes`. */
function base58(bytes: Uint8Array): string {
  const digits: number[] = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let i = 0; i < digits.length; i += 1) {
      const value = (digits[i] ?? 0) * 256 + carry
      digits[i] = value % 58
      carry = Math.floor(value / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }
  let out = ''
  for (const byte of bytes) {
    if (byte !== 0) break
    out += '1'
  }
  for (let i = digits.length - 1; i >= 0; i -= 1) out += BASE58[digits[i] ?? 0] ?? ''
  return out
}

/** SHA-256 of `text` as bytes (WebCrypto; available in the browser). */
async function sha256(text: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(digest)
}

/** Hex string of `bytes`. */
function hex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/** A base58 address derived from 32 random bytes — a realistic Solana-looking
 *  public key for the mock. */
function randomAddress(): string {
  return base58(crypto.getRandomValues(new Uint8Array(32)))
}

/** A base58 address deterministically derived from an imported secret, so the
 *  same secret always yields the same displayed address in the mock. */
async function addressFromSecret(secret: string): Promise<string> {
  return base58(await sha256(`import:${secret.trim()}`))
}

/** The password digest persisted for the mock unlock check (NOT encryption —
 *  M2 replaces this with a real KDF + keystore). Salted by the address. */
async function passwordDigest(password: string, address: string): Promise<string> {
  return hex(await sha256(`${address}:${password}`))
}

interface StoredWallet {
  readonly address: string
  readonly method: WalletMethod
  readonly label?: string
  /** Mock password digest; M2 replaces with an encrypted keystore reference. */
  readonly pwDigest: string
}

function readStored(): StoredWallet | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as Partial<StoredWallet>
    if (typeof parsed.address !== 'string' || typeof parsed.pwDigest !== 'string') return undefined
    const method: WalletMethod = parsed.method === 'imported' || parsed.method === 'connected' ? parsed.method : 'created'
    return { address: parsed.address, method, label: parsed.label, pwDigest: parsed.pwDigest }
  } catch {
    // Private mode / cleared storage / malformed value: no stored wallet.
    return undefined
  }
}

function writeStored(wallet: StoredWallet): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet))
  } catch {
    // Storage unavailable (private mode): the wallet stays unlocked in memory
    // for this page; a reload will start from the login gate again.
  }
}

function clearStored(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear / storage unavailable.
  }
}

/** The account metadata a stored wallet exposes while still locked. */
function accountOf(stored: StoredWallet): WalletAccount {
  return { address: stored.address, method: stored.method, label: stored.label }
}

/**
 * Create the per-activation wallet store (the `createXXXStore()` rule — no
 * module-level singleton). Hydrates synchronously from localStorage so the
 * gate opens in the correct state (Unlock vs Create) on first paint.
 */
export function createWalletStore(): WalletStore {
  const listeners = new Set<() => void>()
  let stored = readStored()
  let account: WalletAccount | undefined
  let snapshot: WalletSnapshot = computeSnapshot()

  function computeSnapshot(): WalletSnapshot {
    return {
      status: account !== undefined ? 'unlocked' : 'locked',
      account,
      hasWallet: stored !== undefined,
      stored: stored !== undefined ? accountOf(stored) : undefined,
    }
  }

  function emit(): void {
    snapshot = computeSnapshot()
    for (const listener of listeners) listener()
  }

  async function establish(method: WalletMethod, address: string, password: string, label?: string): Promise<WalletAccount> {
    const pwDigest = await passwordDigest(password, address)
    stored = { address, method, label, pwDigest }
    writeStored(stored)
    account = accountOf(stored)
    emit()
    return account
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    createWallet: ({ password, label }) => establish('created', randomAddress(), password, label),
    async importWallet({ secret, password, label }) {
      return establish('imported', await addressFromSecret(secret), password, label)
    },
    connectExternal: ({ label } = {}) => establish('connected', randomAddress(), 'external', label),
    async unlock({ password }) {
      if (stored === undefined) return false
      const digest = await passwordDigest(password, stored.address)
      if (digest !== stored.pwDigest) return false
      account = accountOf(stored)
      emit()
      return true
    },
    lock() {
      account = undefined
      emit()
    },
    forget() {
      clearStored()
      stored = undefined
      account = undefined
      emit()
    },
  }
}

/** The snapshot used when no wallet store is provided: unlocked, so a
 *  composition without the gate (tests, standalone) renders the workbench. */
const ABSENT_SNAPSHOT: WalletSnapshot = { status: 'unlocked', account: undefined, hasWallet: false, stored: undefined }
const absentSubscribe = (): (() => void) => () => {}
const absentGetSnapshot = (): WalletSnapshot => ABSENT_SNAPSHOT

/** Subscribe a component to the wallet store; `undefined` reads as unlocked. */
export function useWallet(store: WalletStore | undefined): WalletSnapshot {
  return useSyncExternalStore(store?.subscribe ?? absentSubscribe, store?.getSnapshot ?? absentGetSnapshot)
}

/** Shorten an address for display (`ABCD…WXYZ`). */
export function shortAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-6)}`
}
