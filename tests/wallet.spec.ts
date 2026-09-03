/**
 * The web3 login gate's wallet state machine (src/client/wallet.ts). Exercises
 * the create / import / connect / unlock / lock / forget transitions of the
 * UI-first mock in memory (no reliance on cross-instance localStorage, which
 * this jsdom env stubs per-test).
 */
import { describe, it, expect } from 'vitest'
import { createWalletStore, shortAddress } from '../src/client/wallet.ts'

const STRONG = 'wallet-pass-123'

describe('wallet store', () => {
  it('creating a wallet unlocks it with a base58 address', async () => {
    const store = createWalletStore()
    store.forget()
    expect(store.getSnapshot().status).toBe('locked')
    const account = await store.createWallet({ password: STRONG, label: 'Main' })
    const snap = store.getSnapshot()
    expect(snap.status).toBe('unlocked')
    expect(snap.account?.address).toBe(account.address)
    expect(account.method).toBe('created')
    expect(account.label).toBe('Main')
    expect(account.address.length).toBeGreaterThan(20)
    expect(account.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/) // base58 alphabet
  })

  it('lock then unlock verifies the password', async () => {
    const store = createWalletStore()
    store.forget()
    await store.createWallet({ password: STRONG })
    store.lock()
    expect(store.getSnapshot().status).toBe('locked')
    expect(store.getSnapshot().hasWallet).toBe(true)
    expect(await store.unlock({ password: 'wrong-password' })).toBe(false)
    expect(store.getSnapshot().status).toBe('locked')
    expect(await store.unlock({ password: STRONG })).toBe(true)
    expect(store.getSnapshot().status).toBe('unlocked')
  })

  it('import derives a stable address from the same secret', async () => {
    const a = createWalletStore()
    a.forget()
    const first = await a.importWallet({ secret: 'twelve word seed phrase goes right here for the test', password: STRONG })
    const b = createWalletStore()
    b.forget()
    const second = await b.importWallet({ secret: 'twelve word seed phrase goes right here for the test', password: 'a-different-pass' })
    expect(second.address).toBe(first.address)
    expect(first.method).toBe('imported')
  })

  it('connect establishes an external account; forget resets to no wallet', async () => {
    const store = createWalletStore()
    store.forget()
    const account = await store.connectExternal()
    expect(account.method).toBe('connected')
    expect(store.getSnapshot().status).toBe('unlocked')
    store.forget()
    expect(store.getSnapshot().hasWallet).toBe(false)
    expect(store.getSnapshot().status).toBe('locked')
  })

  it('notifies subscribers on change and stops after unsubscribe', async () => {
    const store = createWalletStore()
    store.forget()
    let calls = 0
    const off = store.subscribe(() => { calls += 1 })
    await store.createWallet({ password: STRONG })
    expect(calls).toBeGreaterThan(0)
    const seen = calls
    off()
    store.lock()
    expect(calls).toBe(seen)
  })

  it('shortAddress abbreviates long addresses', () => {
    expect(shortAddress('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe('ABCDEF…UVWXYZ')
    expect(shortAddress('short')).toBe('short')
  })
})
