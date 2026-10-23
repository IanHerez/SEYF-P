import { NextResponse } from 'next/server'
import { bitsoRequest } from '@/lib/bitso/client'
import { resolveEtherfuseRampContext } from '@/lib/seyf/etherfuse-ramp-context'
import { fetchDashboardCetesSaldo } from '@/lib/seyf/dashboard-cetes-saldo'
import { priceInMxn as reflectorPriceInMxn } from '@/lib/stellar/reflector'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Precio real de 1 unidad del activo en MXN, usando el ticker público de Bitso
 * (`<code>_mxn`). Los stablecoins USD caen a USDT/USD si no hay book propio.
 */
async function bitsoMxnPrice(code: string): Promise<number | null> {
  const c = code.toLowerCase()
  const books =
    c === 'usdc'
      ? ['usdc_mxn', 'usdt_mxn', 'usd_mxn']
      : c === 'usd'
        ? ['usd_mxn', 'usdt_mxn']
        : [`${c}_mxn`]
  for (const book of books) {
    try {
      const t = await bitsoRequest<{ last: string }>('GET', `/api/v3/ticker?book=${book}`)
      const n = Number(t.last)
      if (Number.isFinite(n) && n > 0) return n
    } catch {
      // prueba el siguiente book
    }
  }
  return null
}

/**
 * GET /api/prices/mxn?codes=XLM,USDC,CETES&wallet={publicKey}
 * Devuelve el precio real en MXN por unidad de cada activo:
 *  - MXN/MXNB → 1
 *  - CETES → quote offramp real de Etherfuse (CETES→MXN)
 *  - resto → Reflector (oráculo on-chain) y, si no cubre el activo, Bitso
 * Precios ausentes (sin book/quote) se omiten del mapa.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const codes = (url.searchParams.get('codes') ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
    const wallet = url.searchParams.get('wallet') ?? undefined

    const prices: Record<string, number> = {}
    const sources: Record<string, 'reflector' | 'bitso' | 'etherfuse'> = {}

    await Promise.all(
      codes.map(async (code) => {
        if (code === 'MXN' || code === 'MXNB') {
          prices[code] = 1
          return
        }
        if (code === 'CETES') return // se resuelve abajo con Etherfuse

        // Oráculo on-chain primero: el saldo que ve el usuario deja de depender
        // de que un exchange privado responda.
        const onchain = await reflectorPriceInMxn(code).catch(() => null)
        if (onchain != null) {
          prices[code] = onchain
          sources[code] = 'reflector'
          return
        }

        const p = await bitsoMxnPrice(code)
        if (p != null) {
          prices[code] = p
          sources[code] = 'bitso'
        }
      }),
    )

    // CETES: precio real vía quote offramp de Etherfuse (requiere contexto de wallet).
    if (codes.includes('CETES') && wallet) {
      try {
        const ctx = await resolveEtherfuseRampContext({ walletPublicKeyHint: wallet })
        const saldo = await fetchDashboardCetesSaldo(ctx)
        if (saldo.kind === 'ok') {
          prices['CETES'] = saldo.mxnPerCetes
          sources['CETES'] = 'etherfuse'
        }
      } catch {
        // sin precio CETES → se omite
      }
    }

    return NextResponse.json(
      { prices, sources, at: Date.now() },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 502 })
  }
}
