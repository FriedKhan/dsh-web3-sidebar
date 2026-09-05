/**
 * Client-side wallet state for the web3 login gate.
 *
 * M2: the custodial paths are now HOST-BACKED. createWalletStore talks to the
 * host wallet routes (`/sidebar/api/wallet.*`), which own the ed25519 keypair
 * and a password-encrypted keystore under `$DSH_HOME/wallets/<address>/`. The
 * gate is a real boundary now: `unlock()` is verified host-side and fails
 * closed on a wrong password (the host returns `wallet-bad-password`), and the
 * secret key never reaches the browser, a session event, a tool result, or a
 * prompt.
 *
 * `connectExternal` stays a client-only demo (a non-custodial browser wallet is
 * its own authority; wiring the wallet-standard handshake is later work) — it
 * establishes an in-memory session and the LoginView labels it a preview.
 */
import { useSyncExternalStore } from 'react'
import { api, SidebarApiError, type WalletMethod, type WalletStatusWire, type WalletBalanceWire } from './api.ts'

export type { WalletMethod }

/** The public face of the active wallet (address is safe to display/log). */
export interface WalletAccount {
  readonly address: string
  readonly method: WalletMethod
  readonly label?: string
}

/** `loading` until the first host status read resolves. */
export type WalletStatus = 'loading' | 'locked' | 'unlocked'

/** Immutable snapshot read by React through {@link useWallet}. */
export interface WalletSnapshot {
  readonly status: WalletStatus
  /** The unlocked account, or undefined while locked/loading. */
  readonly account: WalletAccount | undefined
  /** Whether a wallet already exists (host keystore or external session). */
  readonly hasWallet: boolean
  /** The stored account's public metadata even while locked (drives Unlock). */
  readonly stored: WalletAccount | undefined
}

/** The wallet store: an external store plus the gate + wallet-tab actions. */
export interface WalletStore {
  getSnapshot(): WalletSnapshot
  subscribe(listener: () => void): () => void
  /** Re-read the host wallet status. */
  refresh(): Promise<void>
  createWallet(input: { password: string; label?: string }): Promise<void>
  importWallet(input: { secret: string; password: string; label?: string }): Promise<void>
  connectExternal(): Promise<void>
  /** Resolves false on a wrong password; throws on any other failure. */
  unlock(input: { password: string }): Promise<boolean>
  lock(): Promise<void>
  forget(): Promise<void>
  balance(signal?: AbortSignal): Promise<WalletBalanceWire>
  send(to: string, amountSol: number, password: string): Promise<{ signature: string }>
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** base58 (Bitcoin alphabet) big-integer encoding — for the external demo address. */
function base58(bytes: Uint8Array): string {
  const digits: number[] = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let i = 0; i < digits.length; i += 1) {
      const value = (digits[i] ?? 0) * 256 + carry
      digits[i] = value % 58
      carry = Math.floor(value / 58)
    }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58) }
  }
  let out = ''
  for (const byte of bytes) { if (byte !== 0) break; out += '1' }
  for (let i = digits.length - 1; i >= 0; i -= 1) out += BASE58[digits[i] ?? 0] ?? ''
  return out
}

/** A demo external address (client-only 'connected' path). */
function mockExternalAddress(): string {
  return base58(crypto.getRandomValues(new Uint8Array(32)))
}

/**
 * Create the per-activation wallet store (the `createXXXStore()` rule — no
 * module-level singleton). Kicks off the first host status read immediately, so
 * a page whose host is already unlocked opens straight into the workbench.
 */
export function createWalletStore(): WalletStore {
  const listeners = new Set<() => void>()
  let hostStatus: WalletStatusWire | undefined
  let external: WalletAccount | undefined
  let loaded = false
  let snapshot: WalletSnapshot = compute()

  function compute(): WalletSnapshot {
    const hostUnlocked = hostStatus?.unlocked === true
    const status: WalletStatus = !loaded ? 'loading' : external !== undefined || hostUnlocked ? 'unlocked' : 'locked'
    const stored: WalletAccount | undefined = hostStatus?.address !== undefined
      ? { address: hostStatus.address, method: hostStatus.method ?? 'created', label: hostStatus.label }
      : undefined
    return {
      status,
      account: external ?? (hostUnlocked ? stored : undefined),
      hasWallet: (hostStatus?.hasWallet ?? false) || external !== undefined,
      stored,
    }
  }
  function emit(): void { snapshot = compute(); for (const listener of listeners) listener() }

  async function refresh(): Promise<void> {
    try {
      hostStatus = await api.walletStatus()
    } catch {
      // Host unreachable (offline/degraded): treat as no wallet so the gate
      // shows the login rather than a blank locked state.
      hostStatus = { hasWallet: false, unlocked: false }
    } finally {
      loaded = true
      emit()
    }
  }
  void refresh()

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    refresh,
    async createWallet({ password, label }) { await api.walletCreate(password, label); await refresh() },
    async importWallet({ secret, password, label }) { await api.walletImport(secret, password, label); await refresh() },
    async connectExternal() { external = { address: mockExternalAddress(), method: 'connected' }; emit() },
    async unlock({ password }) {
      try {
        await api.walletUnlock(password)
        await refresh()
        return true
      } catch (error) {
        if (error instanceof SidebarApiError && error.code === 'wallet-bad-password') return false
        throw error
      }
    },
    async lock() {
      if (external !== undefined) { external = undefined; emit(); return }
      await api.walletLock()
      await refresh()
    },
    async forget() {
      external = undefined
      await api.walletForget()
      await refresh()
    },
    balance: (signal) => api.walletBalance(signal),
    send: (to, amountSol, password) => api.walletSend(to, amountSol, password),
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

/** Shorten an address for display (`ABCDEF…UVWXYZ`). */
export function shortAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-6)}`
}
