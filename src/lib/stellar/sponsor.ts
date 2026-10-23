/**
 * Patrocinio de reservas y fees (CAP-33 + fee-bump).
 *
 * En mainnet no hay Friendbot: una wallet recién creada no existe en el ledger,
 * no tiene reserva base ni XLM para fees, y por tanto no puede firmar NADA.
 * Pedirle al usuario que consiga XLM antes de ahorrar es el fin del onboarding.
 *
 * Aquí el negocio paga por él:
 *  - `beginSponsoringFutureReserves` … `endSponsoringFutureReserves` cubren la
 *    reserva base de la cuenta y la de cada trustline (el sponsor conserva el
 *    XLM: puede recuperarlo si la cuenta se revoca).
 *  - El fee-bump deja que el sponsor pague la comisión de una transacción ya
 *    firmada por el usuario, sin volver a pedirle firma.
 *
 * El sponsor solo firma lo que arma este módulo, y las rutas que lo exponen
 * exigen sesión SEP-10 + rate limit: una llave patrocinadora sin candado se
 * vacía en minutos.
 */

import 'server-only'
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  NotFoundError,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { horizonUrl, stellarNetworkPassphrase } from '@/lib/stellar/network'

/** Tope de fee que el sponsor acepta pagar por transacción (en stroops). */
const DEFAULT_MAX_FEE = '100000' // 0.01 XLM
/** Ventana para que el usuario firme lo que armamos. */
const TX_TIMEOUT_SEC = 180

export class SponsorNotConfiguredError extends Error {
  constructor() {
    super(
      'El patrocinio de reservas no está configurado. Define STELLAR_SPONSOR_SECRET ' +
        'con la llave secreta (S...) de una cuenta fondeada con XLM.',
    )
    this.name = 'SponsorNotConfiguredError'
  }
}

let cachedKeypair: Keypair | null = null

export function sponsorKeypair(): Keypair {
  if (cachedKeypair) return cachedKeypair
  const secret = process.env.STELLAR_SPONSOR_SECRET?.trim()
  if (!secret) throw new SponsorNotConfiguredError()
  cachedKeypair = Keypair.fromSecret(secret)
  return cachedKeypair
}

export function isSponsorConfigured(): boolean {
  try {
    sponsorKeypair()
    return true
  } catch {
    return false
  }
}

function maxFee(): string {
  const raw = process.env.STELLAR_SPONSOR_MAX_FEE?.trim()
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : DEFAULT_MAX_FEE
}

function server(): Horizon.Server {
  return new Horizon.Server(horizonUrl())
}

export async function accountExists(publicKey: string): Promise<boolean> {
  try {
    await server().loadAccount(publicKey)
    return true
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status
    if (e instanceof NotFoundError || status === 404) return false
    throw e
  }
}

function assertAccount(publicKey: string): void {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new Error('Cuenta Stellar inválida.')
  }
}

/**
 * XDR (ya firmado por el sponsor) que crea la cuenta del usuario con reserva
 * patrocinada y saldo inicial 0. El usuario debe co-firmarlo: el
 * `endSponsoringFutureReserves` va a nombre de su cuenta.
 */
export async function buildSponsoredAccountCreation(newAccount: string): Promise<string> {
  assertAccount(newAccount)
  const sponsor = sponsorKeypair()
  const networkPassphrase = stellarNetworkPassphrase()

  if (await accountExists(newAccount)) {
    throw new Error('La cuenta ya existe en el ledger.')
  }

  const source = await server().loadAccount(sponsor.publicKey())
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: newAccount }))
    .addOperation(Operation.createAccount({ destination: newAccount, startingBalance: '0' }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: newAccount }))
    .setTimeout(TX_TIMEOUT_SEC)
    .build()

  tx.sign(sponsor)
  return tx.toXDR()
}

/**
 * XDR (firmado por el sponsor) que abre una trustline con reserva patrocinada.
 * Sin esto cada asset nuevo le cuesta 0.5 XLM al usuario.
 */
export async function buildSponsoredTrustline(
  account: string,
  assetCode: string,
  assetIssuer: string,
): Promise<string> {
  assertAccount(account)
  if (!StrKey.isValidEd25519PublicKey(assetIssuer)) {
    throw new Error('Emisor del asset inválido.')
  }
  const sponsor = sponsorKeypair()
  const networkPassphrase = stellarNetworkPassphrase()

  const source = await server().loadAccount(sponsor.publicKey())
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: account }))
    .addOperation(
      Operation.changeTrust({ asset: new Asset(assetCode, assetIssuer), source: account }),
    )
    .addOperation(Operation.endSponsoringFutureReserves({ source: account }))
    .setTimeout(TX_TIMEOUT_SEC)
    .build()

  tx.sign(sponsor)
  return tx.toXDR()
}

export type SponsoredSubmitResult = { hash: string; successful: boolean }

/**
 * Envuelve en fee-bump una transacción ya firmada por el usuario y la envía.
 * El sponsor paga la comisión; la transacción interna no se toca ni se vuelve
 * a firmar.
 *
 * `allowedSources` acota de quién aceptamos pagar: la cuenta del propio usuario
 * (sesión SEP-10) o el sponsor. Sin ese filtro cualquiera usaría la llave como
 * gasolinera gratis.
 */
export async function submitFeeBumped(
  signedXdr: string,
  allowedSources: string[],
): Promise<SponsoredSubmitResult> {
  const sponsor = sponsorKeypair()
  const networkPassphrase = stellarNetworkPassphrase()

  const inner = new Transaction(signedXdr, networkPassphrase)
  if (!allowedSources.includes(inner.source)) {
    throw new Error('Esta transacción no corresponde a tu cuenta.')
  }
  if (inner.signatures.length === 0) {
    throw new Error('La transacción no viene firmada.')
  }

  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    sponsor,
    maxFee(),
    inner,
    networkPassphrase,
  )
  feeBump.sign(sponsor)

  const res = await server().submitTransaction(feeBump)
  return { hash: res.hash, successful: res.successful !== false }
}
