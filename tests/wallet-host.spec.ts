/**
 * The host wallet keystore (src/wallet-host.ts) — the authority behind the
 * login gate. Verifies real create/import/unlock/lock/forget against an
 * encrypted keystore in a throwaway $DSH_HOME, and that a wrong password fails
 * closed. Balance/send are network operations and are not exercised here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWalletHost, WalletError } from '../src/wallet-host.ts'

const RPC = 'https://api.devnet.solana.com' // never contacted by these tests
const PASS = 'strong-pass-123'
// A standard BIP39 test-vector mnemonic (valid checksum) for deterministic import.
const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow'

let home: string
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'dsh-wallet-')); process.env.DSH_HOME = home })
afterEach(async () => { delete process.env.DSH_HOME; await rm(home, { recursive: true, force: true }) })

describe('wallet-host keystore', () => {
  it('create unlocks a base58 wallet stored as an encrypted keystore', async () => {
    const host = createWalletHost(RPC)
    const meta = await host.create(PASS, 'Main')
    expect(meta.method).toBe('created')
    expect(meta.label).toBe('Main')
    expect(meta.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,}$/)
    expect(await host.status()).toMatchObject({ hasWallet: true, unlocked: true, address: meta.address })
    const parsed = JSON.parse(await readFile(join(home, 'wallets', meta.address, 'keystore.json'), 'utf8'))
    expect(parsed.cipher.algo).toBe('aes-256-gcm')
    expect(parsed.kdf.algo).toBe('scrypt')
    expect(typeof parsed.cipher.ct).toBe('string')
  })

  it('unlock fails closed on a wrong password', async () => {
    const host = createWalletHost(RPC)
    await host.create(PASS)
    host.lock()
    expect((await host.status()).unlocked).toBe(false)
    await expect(host.unlock('wrong-password')).rejects.toBeInstanceOf(WalletError)
    expect((await host.status()).unlocked).toBe(false)
    const meta = await host.unlock(PASS)
    expect((await host.status())).toMatchObject({ unlocked: true, address: meta.address })
  })

  it('a fresh host (a restart) starts locked but can unlock the stored keystore', async () => {
    const meta = await createWalletHost(RPC).create(PASS)
    const restarted = createWalletHost(RPC)
    expect(await restarted.status()).toMatchObject({ hasWallet: true, unlocked: false, address: meta.address })
    await expect(restarted.unlock('nope')).rejects.toThrow()
    await restarted.unlock(PASS)
    expect((await restarted.status()).unlocked).toBe(true)
  })

  it('seed-phrase import is deterministic; forget clears the wallet', async () => {
    const a = createWalletHost(RPC)
    const first = await a.importWallet(MNEMONIC, PASS)
    expect(first.method).toBe('imported')
    await a.forget()
    expect(await a.status()).toMatchObject({ hasWallet: false, unlocked: false })
    const b = createWalletHost(RPC)
    const second = await b.importWallet(MNEMONIC, 'a-different-password')
    expect(second.address).toBe(first.address)
  })

  it('rejects an unrecognized secret', async () => {
    await expect(createWalletHost(RPC).importWallet('not a real key', PASS)).rejects.toBeInstanceOf(WalletError)
  })

  it('send fails closed on a wrong password before any network call', async () => {
    // send() decrypts the keystore with the supplied password FIRST (before the
    // recipient is even parsed or the RPC contacted), so a wrong password
    // rejects with bad-password — proving an unlocked in-memory session alone
    // cannot move value. The unroutable RPC guarantees a network attempt would
    // fail with something other than bad-password.
    const host = createWalletHost('http://127.0.0.1:1') // must never be contacted
    await host.create(PASS)
    await host.unlock(PASS) // even while unlocked...
    await expect(host.send('any-recipient', 0.001, 'wrong-password')).rejects.toMatchObject({ code: 'bad-password' })
  })
})
