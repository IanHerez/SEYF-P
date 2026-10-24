/**
 * SEP-10 Stellar Web Authentication (lado servidor).
 *
 * Reemplaza la confianza en el parámetro `?wallet=G...` por una prueba
 * criptográfica: el servidor emite un challenge, el usuario lo firma con su
 * llave (Pollar) y a cambio recibe un JWT propio cuyo `sub` es su cuenta
 * Stellar. A partir de ahí ninguna ruta tiene que creerle al cliente quién es.
 *
 * @see https://stellar.org/protocol/sep-10
 */

import 'server-only'
import { Horizon, Keypair, NotFoundError, StrKey, WebAuth } from '@stellar/stellar-sdk'
import { horizonUrl, stellarNetworkPassphrase } from '@/lib/stellar/network'
import { signSeyfJwt, verifySeyfJwt, type SeyfJwtPayload } from '@/lib/stellar/jwt'

/** Duración del challenge: el usuario tiene 5 min para firmarlo. */
const CHALLENGE_TIMEOUT_SEC = 300
/** Duración de la sesión emitida tras firmar (24 h por defecto). */
const DEFAULT_SESSION_TTL_SEC = 86_400

export type Sep10Config = {
  serverKeypair: Keypair
  homeDomain: string
  webAuthDomain: string
  jwtSecret: string
  sessionTtlSec: number
}

export class Sep10NotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `SEP-10 no está configurado. Faltan variables de entorno: ${missing.join(', ')}. ` +
        'Genera una llave con `node -e "console.log(require(\'@stellar/stellar-sdk\').Keypair.random().secret())"`.',
    )
    this.name = 'Sep10NotConfiguredError'
  }
}

function hostFromEnv(): string | null {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (!site) return null
  try {
    return new URL(site).host
  } catch {
    return null
  }
}

let cached: Sep10Config | null = null

/** Config de SEP-10. Lanza `Sep10NotConfiguredError` si falta algo esencial. */
export function sep10Config(): Sep10Config {
  if (cached) return cached

  const secret = process.env.SEP10_SERVER_SECRET?.trim()
  const jwtSecret = process.env.SEYF_AUTH_JWT_SECRET?.trim()
  const homeDomain = process.env.SEP10_HOME_DOMAIN?.trim() || hostFromEnv()

  const missing: string[] = []
  if (!secret) missing.push('SEP10_SERVER_SECRET')
  if (!jwtSecret) missing.push('SEYF_AUTH_JWT_SECRET')
  if (!homeDomain) missing.push('SEP10_HOME_DOMAIN (o NEXT_PUBLIC_SITE_URL)')
  if (missing.length > 0) throw new Sep10NotConfiguredError(missing)

  const ttl = Number(process.env.SEYF_AUTH_TTL_SEC?.trim() || DEFAULT_SESSION_TTL_SEC)

  cached = {
    serverKeypair: Keypair.fromSecret(secret!),
    homeDomain: homeDomain!,
    webAuthDomain: process.env.SEP10_WEB_AUTH_DOMAIN?.trim() || homeDomain!,
    jwtSecret: jwtSecret!,
    sessionTtlSec: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_SESSION_TTL_SEC,
  }
  return cached
}

export function isSep10Configured(): boolean {
  try {
    sep10Config()
    return true
  } catch {
    return false
  }
}

/** XDR del challenge para que la wallet lo firme (sin enviarlo a la red). */
export function buildSep10Challenge(account: string): { transaction: string; networkPassphrase: string } {
  if (!StrKey.isValidEd25519PublicKey(account)) {
    throw new Error('Cuenta Stellar inválida.')
  }
  const cfg = sep10Config()
  const networkPassphrase = stellarNetworkPassphrase()
  const transaction = WebAuth.buildChallengeTx(
    cfg.serverKeypair,
    account,
    cfg.homeDomain,
    CHALLENGE_TIMEOUT_SEC,
    networkPassphrase,
    cfg.webAuthDomain,
  )
  return { transaction, networkPassphrase }
}

/**
 * Verifica el challenge firmado y devuelve la cuenta que lo firmó.
 *
 * Si la cuenta todavía no existe en el ledger (caso normal en SEYF: la wallet
 * Pollar se crea antes de fondearse) SEP-10 manda verificar contra la master
 * key. Si ya existe, se exige el `med_threshold` real con los firmantes de la
 * cuenta — así una cuenta con multisig no se autentica con una firma suelta.
 */
export async function verifySep10Challenge(signedXdr: string): Promise<string> {
  const cfg = sep10Config()
  const networkPassphrase = stellarNetworkPassphrase()
  const serverAccountId = cfg.serverKeypair.publicKey()

  const { clientAccountID } = WebAuth.readChallengeTx(
    signedXdr,
    serverAccountId,
    networkPassphrase,
    cfg.homeDomain,
    cfg.webAuthDomain,
  )

  const server = new Horizon.Server(horizonUrl())
  let account: Horizon.AccountResponse | null = null
  try {
    account = await server.loadAccount(clientAccountID)
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status
    if (!(e instanceof NotFoundError) && status !== 404) throw e
  }

  if (!account) {
    WebAuth.verifyChallengeTxSigners(
      signedXdr,
      serverAccountId,
      networkPassphrase,
      [clientAccountID],
      cfg.homeDomain,
      cfg.webAuthDomain,
    )
    return clientAccountID
  }

  WebAuth.verifyChallengeTxThreshold(
    signedXdr,
    serverAccountId,
    networkPassphrase,
    account.thresholds.med_threshold,
    account.signers,
    cfg.homeDomain,
    cfg.webAuthDomain,
  )
  return clientAccountID
}

/** Emite la sesión SEYF para una cuenta ya verificada. */
export function issueSeyfSession(account: string): { token: string; expiresIn: number } {
  const cfg = sep10Config()
  return {
    token: signSeyfJwt({ sub: account, iss: cfg.homeDomain }, cfg.jwtSecret, cfg.sessionTtlSec),
    expiresIn: cfg.sessionTtlSec,
  }
}

/** Lee el `Authorization: Bearer` de la petición y devuelve el payload válido. */
export function readSeyfSession(request: Request): SeyfJwtPayload | null {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!header?.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7).trim()
  if (!token) return null
  try {
    return verifySeyfJwt(token, sep10Config().jwtSecret)
  } catch {
    return null
  }
}
