/**
 * Soroswap — agregador de DEXs de Stellar (solo servidor).
 *
 * El swap propio solo sabía hacer path payments XLM↔USDC contra el SDEX
 * clásico: un solo mercado y un solo par. Soroswap rutea la misma operación
 * por Soroswap AMM, Aqua, Phoenix y el propio SDEX, y devuelve el XDR listo
 * para firmar — mejor precio y más pares sin mantener la lógica de ruteo.
 *
 * La API key (`sk_...`) vive solo aquí, igual que la de DeFindex.
 */

import 'server-only'
import {
  SoroswapSDK,
  SupportedNetworks,
  SupportedProtocols,
  TradeType,
  type BuildQuoteResponse,
  type QuoteResponse,
} from '@soroswap/sdk'
import { Asset } from '@stellar/stellar-sdk'
import { stellarNetworkPassphrase, stellarWalletNetworkFromEnv } from '@/lib/stellar/network'

/** Venues por los que se permite rutear. SDEX incluido: a veces gana él. */
const PROTOCOLS: SupportedProtocols[] = [
  SupportedProtocols.SOROSWAP,
  SupportedProtocols.AQUA,
  SupportedProtocols.PHOENIX,
  SupportedProtocols.SDEX,
]

export class SoroswapNotConfiguredError extends Error {
  constructor() {
    super('Soroswap no está configurado. Define SOROSWAP_API_KEY (sk_…) para activar el agregador.')
    this.name = 'SoroswapNotConfiguredError'
  }
}

let cached: SoroswapSDK | null = null

export function isSoroswapConfigured(): boolean {
  return Boolean(process.env.SOROSWAP_API_KEY?.trim())
}

export function soroswapNetwork(): SupportedNetworks {
  return stellarWalletNetworkFromEnv() === 'mainnet'
    ? SupportedNetworks.MAINNET
    : SupportedNetworks.TESTNET
}

function sdk(): SoroswapSDK {
  if (cached) return cached
  const apiKey = process.env.SOROSWAP_API_KEY?.trim()
  if (!apiKey) throw new SoroswapNotConfiguredError()
  cached = new SoroswapSDK({
    apiKey,
    baseUrl: process.env.SOROSWAP_BASE_URL?.trim() || undefined,
    defaultNetwork: soroswapNetwork(),
  })
  return cached
}

function usdcIssuer(): string {
  const issuer = process.env.STELLAR_USDC_ISSUER?.trim()
  if (issuer) return issuer
  if (stellarWalletNetworkFromEnv() === 'mainnet') {
    throw new Error('Falta STELLAR_USDC_ISSUER para mainnet')
  }
  return 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
}

/**
 * Dirección del contrato (SAC) de un activo clásico. Se deriva del propio
 * activo en vez de hardcodearse: así no hay una lista que se desincronice al
 * cambiar de red.
 */
export function assetContractId(code: string): string {
  const passphrase = stellarNetworkPassphrase()
  const upper = code.trim().toUpperCase()
  const asset = upper === 'XLM' ? Asset.native() : new Asset(upper, usdcIssuer())
  if (upper !== 'XLM' && upper !== 'USDC') {
    throw new Error(`Activo no soportado en Soroswap: ${code}`)
  }
  return asset.contractId(passphrase)
}

export type SoroswapQuote = {
  quote: QuoteResponse
  amountIn: number
  amountOut: number
}

/** 7 decimales: la unidad de Stellar para XLM y USDC. */
const UNIT = 10 ** 7

function toBigIntUnits(amount: number): bigint {
  return BigInt(Math.round(amount * UNIT))
}

function fromUnits(raw: bigint | string | number | undefined): number {
  if (raw == null) return 0
  return Number(BigInt(raw.toString())) / UNIT
}

/** Cotiza un swap exact-in por el mejor camino entre los venues soportados. */
export async function quoteSoroswapSwap(
  from: string,
  to: string,
  amount: number,
  slippageBps = 50,
): Promise<SoroswapQuote> {
  const quote = await sdk().quote({
    assetIn: assetContractId(from),
    assetOut: assetContractId(to),
    amount: toBigIntUnits(amount),
    tradeType: TradeType.EXACT_IN,
    protocols: PROTOCOLS,
    slippageBps,
  })

  // El monto de salida vive en `trade` y cambia de nombre según exact-in/out.
  const trade = (quote as unknown as { trade?: { amountOut?: bigint; amountOutMin?: bigint } }).trade
  const amountOut = fromUnits(trade?.amountOut ?? trade?.amountOutMin)

  return { quote, amountIn: amount, amountOut }
}

/** XDR sin firmar del swap. `sponsor` deja que el negocio pague la comisión. */
export async function buildSoroswapSwap(
  quote: QuoteResponse,
  from: string,
  sponsor?: string,
): Promise<BuildQuoteResponse> {
  return sdk().build({ quote, from, ...(sponsor ? { sponsor } : {}) })
}
