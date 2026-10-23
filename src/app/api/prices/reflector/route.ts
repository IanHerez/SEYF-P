import { NextResponse } from 'next/server'
import { lastPriceUsd, mxnInUsd, priceInMxn, reflectorOracle } from '@/lib/stellar/reflector'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/prices/reflector?codes=XLM,USDC
 * Precios leídos del oráculo on-chain Reflector: USD por unidad, MXN por unidad
 * y el cruce MXN/USD que los relaciona. Sin API keys — es lectura de contrato.
 */
export async function GET(req: Request) {
  const codes = (new URL(req.url).searchParams.get('codes') ?? 'XLM,USDC')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20)

  try {
    const mxnUsd = await mxnInUsd()
    const entries = await Promise.all(
      codes.map(async (code) => {
        const [usd, mxn] = await Promise.all([
          code === 'MXN' ? Promise.resolve(null) : lastPriceUsd(code, 'cex'),
          priceInMxn(code),
        ])
        return [code, { usd: usd?.price ?? null, mxn, at: usd?.timestamp ?? null }] as const
      }),
    )

    return NextResponse.json(
      {
        prices: Object.fromEntries(entries),
        mxnPerUsd: mxnUsd && mxnUsd > 0 ? 1 / mxnUsd : null,
        oracles: { cex: reflectorOracle('cex'), fx: reflectorOracle('fx') },
        at: Date.now(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : 'No se pudo leer el oráculo'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
