/**
 * Host-side wallet: the authority behind the web3 login gate.
 *
 * This is where the gate becomes real. An ed25519 (Solana) keypair is
 * generated or imported on the HOST, its 64-byte secret is encrypted with the
 * user's password (scrypt KDF + AES-256-GCM) and written to a keystore file
 * under `$DSH_HOME/wallets/<address>/keystore.json`, and the plaintext secret
 * lives ONLY in this host process's memory while unlocked — it is never
 * returned to the browser, written to a session event, put in a tool result,
 * or placed in a prompt. `unlock()` decrypts with the supplied password and
 * fails closed (GCM auth) on a wrong one, so a client cannot forge the unlock
 * the way the M1 client-only mock could.
 *
 * The wallets directory holds one subdirectory per wallet (keystore + public
 * meta) plus an `active` pointer naming the wallet the gate uses.
 */
import { randomBytes, scrypt as scryptCb, createCipheriv, createDecipheriv, type ScryptOptions } from 'node:crypto'
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Keypair, Connection, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { mnemonicToSeedSync, validateMnemonic } from 'bip39'
import { derivePath } from 'ed25519-hd-key'
import bs58 from 'bs58'

/** How the active wallet was established. */
export type WalletMethod = 'created' | 'imported'

/** Public, non-secret wallet metadata (safe to return to the client). */
export interface WalletMeta {
  address: string
  method: WalletMethod
  label?: string
  createdAt: number
}

/** The gate's view of the host wallet. */
export interface WalletStatus {
  hasWallet: boolean
  unlocked: boolean
  address?: string
  method?: WalletMethod
  label?: string
}

/** A raised wallet error carrying a stable wire code (mapped to SidebarError). */
export class WalletError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

/** On-disk keystore: the encrypted 64-byte secret plus public metadata. */
interface Keystore {
  v: 1
  address: string
  method: WalletMethod
  label?: string
  createdAt: number
  kdf: { algo: 'scrypt'; salt: string; N: number; r: number; p: number; keyLen: number }
  cipher: { algo: 'aes-256-gcm'; iv: string; ct: string; tag: string }
}

// promisify picks scrypt's no-options overload; cast to the options form we use.
const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keyLen: number, options: ScryptOptions) => Promise<Buffer>
// Interactive-login scrypt cost (~100ms): resists offline brute force of the
// keystore while staying responsive on unlock. maxmem is raised to fit N.
const KDF = { N: 1 << 15, r: 8, p: 1, keyLen: 32, maxmem: 256 * 1024 * 1024 }
const SOLANA_DERIVATION = "m/44'/501'/0'/0'"
const MEMO = "Sign-in to DSH Web3"

function walletsDir(): string {
  const env = process.env.DSH_HOME
  const home = env !== undefined && env.trim() !== '' ? env : join(homedir(), '.dsh')
  return join(home, 'wallets')
}
const keystorePath = (address: string): string => join(walletsDir(), address, 'keystore.json')
const activePath = (): string => join(walletsDir(), 'active')

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return (await scrypt(password, salt, KDF.keyLen, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: KDF.maxmem })) as Buffer
}

async function encryptSecret(secret: Uint8Array, password: string): Promise<Pick<Keystore, 'kdf' | 'cipher'>> {
  const salt = randomBytes(16)
  const key = await deriveKey(password, salt)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(secret)), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    kdf: { algo: 'scrypt', salt: salt.toString('base64'), N: KDF.N, r: KDF.r, p: KDF.p, keyLen: KDF.keyLen },
    cipher: { algo: 'aes-256-gcm', iv: iv.toString('base64'), ct: ct.toString('base64'), tag: tag.toString('base64') },
  }
}

/** Decrypt the keystore secret; throws on a wrong password (GCM auth fails). */
async function decryptSecret(keystore: Keystore, password: string): Promise<Uint8Array> {
  const key = await deriveKey(password, Buffer.from(keystore.kdf.salt, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(keystore.cipher.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(keystore.cipher.tag, 'base64'))
  try {
    return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(keystore.cipher.ct, 'base64')), decipher.final()]))
  } catch {
    throw new WalletError('bad-password', 'wrong password')
  }
}

/** Parse an imported secret: a 12/24-word BIP39 mnemonic (SLIP-0010 Solana
 *  path), a base58 secret key (64 or 32 bytes), or a JSON byte array (the
 *  solana-keygen id.json form). */
function keypairFromSecret(input: string): Keypair {
  const trimmed = input.trim()
  if (validateMnemonic(trimmed)) {
    const seed = mnemonicToSeedSync(trimmed)
    const derived = derivePath(SOLANA_DERIVATION, seed.toString('hex')).key
    return Keypair.fromSeed(new Uint8Array(derived))
  }
  if (trimmed.startsWith('[')) {
    let bytes: number[]
    try { bytes = JSON.parse(trimmed) as number[] } catch { throw new WalletError('bad-secret', 'unrecognized secret format') }
    if (!Array.isArray(bytes) || bytes.length !== 64) throw new WalletError('bad-secret', 'a JSON secret key must be 64 bytes')
    return Keypair.fromSecretKey(Uint8Array.from(bytes))
  }
  let decoded: Uint8Array
  try { decoded = bs58.decode(trimmed) } catch { throw new WalletError('bad-secret', 'not a valid seed phrase, base58 key, or JSON key') }
  if (decoded.length === 64) return Keypair.fromSecretKey(decoded)
  if (decoded.length === 32) return Keypair.fromSeed(decoded)
  throw new WalletError('bad-secret', 'a base58 secret key must decode to 32 or 64 bytes')
}

/**
 * Create the host wallet manager (one per plugin activation). Holds the
 * decrypted keypair in memory only while unlocked; `rpcUrl` targets the Solana
 * cluster for balance/transfer (devnet by default).
 */
export function createWalletHost(rpcUrl: string): {
  status(): Promise<WalletStatus>
  create(password: string, label?: string): Promise<WalletMeta>
  importWallet(secret: string, password: string, label?: string): Promise<WalletMeta>
  unlock(password: string): Promise<WalletMeta>
  lock(): void
  forget(): Promise<void>
  balance(): Promise<{ lamports: number; sol: number }>
  send(to: string, sol: number): Promise<{ signature: string }>
} {
  // The plaintext keypair, present ONLY while unlocked. Never leaves the host.
  let unlocked: { keypair: Keypair; meta: WalletMeta } | undefined
  let connection: Connection | undefined
  const rpc = (): Connection => (connection ??= new Connection(rpcUrl, 'confirmed'))

  const readActive = async (): Promise<string | undefined> => {
    try { return (await readFile(activePath(), 'utf8')).trim() || undefined } catch { return undefined }
  }
  const readKeystore = async (address: string): Promise<Keystore> => {
    let raw: string
    try { raw = await readFile(keystorePath(address), 'utf8') } catch { throw new WalletError('no-wallet', 'no wallet is stored') }
    return JSON.parse(raw) as Keystore
  }

  const persist = async (keypair: Keypair, method: WalletMethod, password: string, label?: string): Promise<WalletMeta> => {
    const address = keypair.publicKey.toBase58()
    const meta: WalletMeta = { address, method, label, createdAt: Date.now() }
    const enc = await encryptSecret(keypair.secretKey, password)
    const keystore: Keystore = { v: 1, ...meta, ...enc }
    await mkdir(join(walletsDir(), address), { recursive: true })
    await writeFile(keystorePath(address), JSON.stringify(keystore, null, 2), { mode: 0o600 })
    await writeFile(activePath(), address, { mode: 0o600 })
    unlocked = { keypair, meta }
    return meta
  }

  const requireUnlocked = (): Keypair => {
    if (unlocked === undefined) throw new WalletError('locked', 'the wallet is locked')
    return unlocked.keypair
  }

  return {
    async status() {
      const address = await readActive()
      if (address === undefined) return { hasWallet: false, unlocked: false }
      const keystore = await readKeystore(address).catch(() => undefined)
      if (keystore === undefined) return { hasWallet: false, unlocked: false }
      return {
        hasWallet: true,
        unlocked: unlocked?.meta.address === address,
        address,
        method: keystore.method,
        label: keystore.label,
      }
    },
    create: (password, label) => persist(Keypair.generate(), 'created', password, label),
    // async so a secret-parse failure rejects the promise rather than throwing
    // synchronously (a Promise-returning method must never throw before await).
    async importWallet(secret, password, label) {
      return persist(keypairFromSecret(secret), 'imported', password, label)
    },
    async unlock(password) {
      const address = await readActive()
      if (address === undefined) throw new WalletError('no-wallet', 'no wallet is stored')
      const keystore = await readKeystore(address)
      const secret = await decryptSecret(keystore, password)
      const keypair = Keypair.fromSecretKey(secret)
      if (keypair.publicKey.toBase58() !== keystore.address) throw new WalletError('corrupt', 'keystore address mismatch')
      const meta: WalletMeta = { address: keystore.address, method: keystore.method, label: keystore.label, createdAt: keystore.createdAt }
      unlocked = { keypair, meta }
      return meta
    },
    lock() { unlocked = undefined },
    async forget() {
      const address = await readActive()
      unlocked = undefined
      await rm(activePath(), { force: true })
      if (address !== undefined) await rm(join(walletsDir(), address), { recursive: true, force: true })
    },
    async balance() {
      const address = unlocked?.meta.address ?? await readActive()
      if (address === undefined) throw new WalletError('no-wallet', 'no wallet is stored')
      const lamports = await rpc().getBalance(new PublicKey(address))
      return { lamports, sol: lamports / LAMPORTS_PER_SOL }
    },
    async send(to, sol) {
      const keypair = requireUnlocked()
      let toPubkey: PublicKey
      try { toPubkey = new PublicKey(to.trim()) } catch { throw new WalletError('bad-recipient', 'invalid recipient address') }
      if (!(sol > 0) || !Number.isFinite(sol)) throw new WalletError('bad-amount', 'amount must be greater than zero')
      const lamports = Math.round(sol * LAMPORTS_PER_SOL)
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey, lamports }))
      void MEMO
      try {
        const signature = await sendAndConfirmTransaction(rpc(), tx, [keypair])
        return { signature }
      } catch (cause) {
        throw new WalletError('send-failed', cause instanceof Error ? cause.message : String(cause))
      }
    },
  }
}
