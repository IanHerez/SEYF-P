/**
 * Reflector — oráculo de precios on-chain de Stellar (SEP-40).
 *
 * Hasta ahora SEYF valuaba todo en MXN con el ticker de Bitso: una API privada,
 * off-chain, en el camino crítico de lo que el usuario ve como su saldo.
 * Reflector publica los mismos precios como contratos Soroban, y su feed de
 * divisas incluye MXN — así el peso deja de depender de un exchange.
 *
 * Dos feeds:
 *  - CEX/DEX  → precio de cripto en USD (XLM, USDC, USDT, EURC…)
 *  - Fiat FX  → precio de divisas en USD (MXN, EUR, BRL…)
 *
 * El precio en MXN sale de dividir uno entre otro.
 *
 * Direcciones tomadas de la tabla oficial de proveedores de oráculos de Stellar:
 * https://developers.stellar.org/docs/data/oracles/oracle-providers
 */

import 'server-only'
import {
  Account,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'
import { sorobanRpcUrl, stellarNetworkPassphrase, stellarWalletNetworkFromEnv } from '@/lib/stellar/network'

type OracleKind = 'cex' | 'fx'

const ORACLES: Record<'mainnet' | 'testnet', Record<OracleKind, string>> = {
  mainnet: {
    cex: 'CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN',
    fx: 'CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC',
  },
  testnet: {
    cex: 'CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63',
    fx: 'CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W',
  },
}

/** Ambos feeds publican con 14 decimales y base USD. */
const PRICE_DECIMALS = 14
/** El precio no cambia por milisegundo; esto evita martillar el RPC. */
const CACHE_TTL_MS = 60_000

export function reflectorOracle(kind: OracleKind): string {
  return ORACLES[stellarWalletNetworkFromEnv() === 'mainnet' ? 'mainnet' : 'testnet'][kind]
}

export type ReflectorPrice = { price: number; timestamp: number }

const cache = new Map<string, { value: ReflectorPrice | null; at: number }>()

/** `Asset::Other(symbol)` del contrato SEP-40 de Reflector. */
function otherAsset(symbol: string): xdr.ScVal {
  return xdr.ScVal.scvVec([
    nativeToScVal('Other', { type: 'symbol' }),
    nativeToScVal(symbol, { type: 'symbol' }),
  ])
}

async function simulate(contractId: string, fn: string, args: xdr.ScVal[]): Promise<unknown> {
  const server = new rpc.Server(sorobanRpcUrl())
  // La simulación no mueve fondos ni requiere que la cuenta exista: basta una
  // fuente cualquiera para armar el sobre.
  const source = new Account(Keypair.random().publicKey(), '0')
  const tx = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: stellarNetworkPassphrase(),
  })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(30)
    .build()

  const sim = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Reflector ${fn} falló: ${sim.error}`)
  }
  if (!sim.result?.retval) return null
  return scValToNative(sim.result.retval)
}

/** Último precio del símbolo en USD, o `null` si el feed no lo cubre. */
export async function lastPriceUsd(symbol: string, kind: OracleKind): Promise<ReflectorPrice | null> {
  const code = symbol.trim().toUpperCase()
  const key = `${kind}:${code}:${stellarWalletNetworkFromEnv()}`

  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  let value: ReflectorPrice | null = null
  try {
    const raw = (await simulate(reflectorOracle(kind), 'lastprice', [otherAsset(code)])) as
      | { price?: bigint | string; timestamp?: bigint | string }
      | null
    if (raw?.price != null) {
      const price = Number(BigInt(raw.price.toString())) / 10 ** PRICE_DECIMALS
      if (Number.isFinite(price) && price > 0) {
        value = { price, timestamp: Number(BigInt((raw.timestamp ?? 0).toString())) }
      }
    }
  } catch (e) {
    console.warn('[reflector] lastprice', code, e instanceof Error ? e.message : e)
    value = null
  }

  cache.set(key, { value, at: Date.now() })
  return value
}

/** USD que vale 1 MXN, según el feed de divisas. */
export async function mxnInUsd(): Promise<number | null> {
  const mxn = await lastPriceUsd('MXN', 'fx')
  return mxn?.price ?? null
}

/**
 * Precio en MXN de una unidad del activo, cruzando el feed cripto con el de
 * divisas. `null` si cualquiera de los dos lados falta.
 */
export async function priceInMxn(symbol: string): Promise<number | null> {
  const code = symbol.trim().toUpperCase()
  if (code === 'MXN' || code === 'MXNB') return 1

  const [asset, mxn] = await Promise.all([
    // MXNe y otras divisas viven en el feed FX; el resto en el de cripto.
    lastPriceUsd(code, code === 'USD' ? 'fx' : 'cex'),
    mxnInUsd(),
  ])

  if (code === 'USD') {
    return mxn && mxn > 0 ? 1 / mxn : null
  }
  if (!asset || !mxn || mxn <= 0) return null
  return asset.price / mxn
}
