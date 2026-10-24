import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isSoroswapConfigured, quoteSoroswapSwap } from '@/lib/soroswap/client'
import { sdexAssetByCode } from '@/lib/sdex/assets'
import { isSdexSwapPair, quoteSdexPathPayment, type SdexSwapCode } from '@/lib/stellar/path-payment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  slippageBps: z.coerce.number().int().positive().max(5000).optional(),
})

/**
 * POST /api/swap/quote — cotiza un cambio.
 * Usa el agregador Soroswap (Soroswap AMM + Aqua + Phoenix + SDEX) si hay API
 * key; si no, cae al path payment directo contra el SDEX.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  }
  const { from, to, amount } = parsed.data
  const slippageBps = parsed.data.slippageBps ?? 50
  const fromCode = from.toUpperCase()
  const toCode = to.toUpperCase()

  if (!sdexAssetByCode(fromCode) || !sdexAssetByCode(toCode)) {
    return NextResponse.json({ error: `Activo no soportado (${from}→${to}).` }, { status: 422 })
  }
  if (fromCode === toCode) {
    return NextResponse.json({ error: 'Elige dos activos distintos.' }, { status: 422 })
  }

  if (isSoroswapConfigured()) {
    try {
      const res = await quoteSoroswapSwap(fromCode, toCode, amount, slippageBps)
      return NextResponse.json({
        provider: 'soroswap',
        from: fromCode,
        to: toCode,
        amountIn: res.amountIn,
        amountOut: res.amountOut,
        slippageBps,
      })
    } catch (e) {
      // El agregador puede no tener ruta para el par: seguimos con SDEX.
      console.warn('[swap/quote] soroswap falló, cayendo a SDEX:', e instanceof Error ? e.message : e)
    }
  }

  if (!isSdexSwapPair(fromCode, toCode)) {
    return NextResponse.json(
      { error: 'Por ahora solo puedes convertir entre XLM y USDC.' },
      { status: 422 },
    )
  }

  try {
    const sdex = await quoteSdexPathPayment(
      fromCode as SdexSwapCode,
      toCode as SdexSwapCode,
      amount,
      slippageBps,
    )
    return NextResponse.json({
      provider: 'sdex',
      from: fromCode,
      to: toCode,
      amountIn: amount,
      amountOut: sdex.amountOut,
      slippageBps,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'No se pudo cotizar el cambio'
    console.error(`[swap/quote] ${fromCode}→${toCode}`, message)
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
