import { Horizon, NotFoundError } from '@stellar/stellar-sdk'

/**
 * Fondeo de la wallet Pollar en testnet vía Friendbot.
 *
 * En testnet la wallet (keypair) existe en Pollar pero NO existe on-chain hasta
 * que recibe su primer fondeo. Sin XLM no puede pagar las fees de las firmas
 * (trustline, depósito/retiro a bóvedas DeFindex). Friendbot crea la cuenta con
 * 10,000 XLM — el monto estándar de la red de pruebas de Stellar.
 *
 * En mainnet Friendbot no existe. En vez de dejar al usuario sin salida, se le
 * indica al cliente que pida la creación patrocinada (`needsSponsorship`):
 * el negocio paga la reserva base vía /api/stellar/sponsor/create-account.
 */

type StellarNetwork = 'testnet' | 'mainnet'

/** Reserva base + colchón para fees: por debajo de esto la cuenta no puede firmar. */
const MIN_XLM = 1
/**
 * Umbral para considerar una cuenta "ya fondeada por Friendbot" (grant de 10,000 XLM).
 * Pollar crea cuentas nuevas con ~2 XLM; esas SÍ deben intentar Friendbot para tener
 * colchón suficiente (reservas de trustlines, depósitos DeFindex). Solo saltamos
 * Friendbot cuando la cuenta ya tiene un saldo claramente por encima del mínimo de Pollar.
 */
const SUFFICIENT_XLM = 50

function resolveNetwork(): { horizonUrl: string; network: StellarNetwork; friendbotUrl: string | null } {
  const env = (
    process.env.NEXT_PUBLIC_POLLAR_STELLAR_NETWORK ??
    process.env.NEXT_PUBLIC_STELLAR_NETWORK ??
    'testnet'
  )
    .trim()
    .toLowerCase()

  if (env === 'mainnet' || env === 'public') {
    return {
      horizonUrl: 'https://horizon.stellar.org',
      network: 'mainnet',
      friendbotUrl: null,
    }
  }
  return {
    horizonUrl: 'https://horizon-testnet.stellar.org',
    network: 'testnet',
    // Friendbot oficial de testnet (override por env para entornos custom).
    friendbotUrl: process.env.STELLAR_FRIENDBOT_URL?.trim() || 'https://friendbot.stellar.org',
  }
}

/** Saldo XLM nativo de la cuenta. `null` si la cuenta no existe on-chain todavía. */
export async function getAccountXlm(publicKey: string): Promise<number | null> {
  const { horizonUrl } = resolveNetwork()
  const server = new Horizon.Server(horizonUrl)
  try {
    const account = await server.loadAccount(publicKey)
    const native = account.balances.find((b) => b.asset_type === 'native')
    return native ? Number(native.balance) : 0
  } catch (e) {
    // 404 de Horizon = cuenta aún no creada en el ledger.
    if (e instanceof NotFoundError) return null
    const status = (e as { response?: { status?: number } })?.response?.status
    if (status === 404) return null
    throw e
  }
}

export type FundResult = {
  network: StellarNetwork
  /** true si Friendbot fondeó la cuenta en esta llamada. */
  funded: boolean
  /** true si la cuenta ya tenía XLM suficiente (no se volvió a fondear). */
  alreadyFunded: boolean
  /** Saldo XLM tras la operación (best-effort). */
  xlm: number | null
  /** Mainnet sin cuenta en el ledger: hay que crearla con reserva patrocinada. */
  needsSponsorship?: boolean
  message: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Llama a Friendbot con reintentos. El friendbot oficial de testnet rate-limitea
 * (429/503) cuando muchas cuentas nuevas lo golpean a la vez — típico al compartir
 * la app para pruebas. Reintentamos con backoff en errores transitorios.
 * Devuelve 'funded' | 'exists' (cuenta ya existía) | lanza en fallo definitivo.
 */
async function callFriendbot(friendbotUrl: string, publicKey: string): Promise<'funded' | 'exists'> {
  const attempts = 3
  let lastErr = ''
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${friendbotUrl}/?addr=${encodeURIComponent(publicKey)}`, {
        method: 'GET',
        signal: AbortSignal.timeout(9_000),
      })
      if (res.ok) return 'funded'
      const body = await res.text().catch(() => '')
      // La cuenta ya existe on-chain: no es un fallo real.
      if (/op_already_exists|already.*funded|exists/i.test(body)) return 'exists'
      // Rate limit / errores de servidor → transitorio, reintenta.
      if (res.status === 429 || res.status >= 500) {
        lastErr = `Friendbot ${res.status}`
        await sleep(700 * (i + 1))
        continue
      }
      throw new Error(`Friendbot respondió ${res.status}: ${body.slice(0, 200)}`)
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      if (i === attempts - 1) break
      await sleep(700 * (i + 1))
    }
  }
  throw new Error(`Friendbot no respondió tras ${attempts} intentos: ${lastErr}`)
}

/**
 * Espera a que la cuenta propague en Horizon con XLM suficiente. Friendbot crea la
 * cuenta pero el ledger puede tardar 1-2s en indexarla; sin esta espera, la
 * simulación del depósito DeFindex corre contra una cuenta "inexistente" y falla
 * con "no fondos" aunque acabe de fondearse.
 */
async function waitForFundedAccount(publicKey: string, timeoutMs = 9_000): Promise<number | null> {
  const start = Date.now()
  let xlm: number | null = null
  while (Date.now() - start < timeoutMs) {
    xlm = await getAccountXlm(publicKey).catch(() => null)
    if (xlm != null && xlm >= MIN_XLM) return xlm
    await sleep(1000)
  }
  return xlm
}

/**
 * Garantiza que la wallet Pollar tenga XLM para pagar fees.
 * - Cuenta inexistente en testnet → Friendbot la crea con 10,000 XLM (con reintentos).
 * - Tras fondear, espera a que propague en el ledger antes de devolver.
 * - Cuenta ya fondeada → no hace nada (idempotente).
 * - Mainnet → no aplica (Friendbot no existe).
 */
export async function ensureFunded(publicKey: string): Promise<FundResult> {
  const { network, friendbotUrl } = resolveNetwork()

  const current = await getAccountXlm(publicKey)
  // Solo saltamos Friendbot si la cuenta ya tiene saldo claramente por encima del
  // mínimo que Pollar deja (~2 XLM). Así una cuenta recién creada por Pollar SÍ
  // intenta Friendbot para tener colchón real, no solo el mínimo de reserva.
  if (current != null && current >= SUFFICIENT_XLM) {
    return {
      network,
      funded: false,
      alreadyFunded: true,
      xlm: current,
      message: 'La wallet ya tiene XLM suficiente.',
    }
  }

  if (network === 'mainnet' || !friendbotUrl) {
    // `current === null` = la cuenta no existe en el ledger todavía.
    const needsSponsorship = current == null
    return {
      network,
      funded: false,
      alreadyFunded: false,
      xlm: current,
      needsSponsorship,
      message: needsSponsorship
        ? 'La cuenta aún no existe en mainnet: créala con reserva patrocinada.'
        : 'La wallet ya existe en mainnet; las fees se cubren por fee-bump.',
    }
  }

  const outcome = await callFriendbot(friendbotUrl, publicKey)

  if (outcome === 'exists') {
    const xlm = await getAccountXlm(publicKey).catch(() => current)
    return {
      network,
      funded: false,
      alreadyFunded: true,
      xlm,
      message: 'La cuenta ya existe on-chain.',
    }
  }

  // Espera propagación para que operaciones posteriores (depósito) vean el saldo.
  const xlm = await waitForFundedAccount(publicKey)
  if (xlm == null || xlm < MIN_XLM) {
    throw new Error('La wallet se fondeó pero el ledger aún no la refleja. Reintenta en unos segundos.')
  }
  return {
    network,
    funded: true,
    alreadyFunded: false,
    xlm,
    message: 'Wallet fondeada con 10,000 XLM de testnet.',
  }
}
