import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSoroswapSwap, isSoroswapConfigured, quoteSoroswapSwap } from '@/lib/soroswap/client'
import { isSdexSwapPair, buildSdexPathPaymentXdr, quoteSdexPathPayment, type SdexSwapCode } from '@/lib/stellar/path-payment'
import { requireSession } from '@/lib/stellar/db-auth'
import { isSponsorConfigured, sponsorKeypair } from '@/lib/stellar/sponsor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  slippageBps: z.coerce.number().int().positive().max(5000).optional(),
})

/**
 * POST /api/swap/build — XDR sin firmar del cambio.
 *
 * La cotización se vuelve a pedir AQUÍ, en el servidor. Antes el cliente
 * mandaba el objeto `quote` y de ahí salía el `destMin`: un cliente manipulado
 * podía hacer firmar un swap con protección de slippage en cero. Ahora el
 * cliente solo dice qué quiere cambiar; el precio mínimo lo fija el servidor.
 *
 * La cuenta que firma sale de la sesión SEP-10, no del cuerpo.
 */
export async function POST(req: Request) {
  const session = requireSession(req)
  if (!session.ok) return session.response

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  }
  const { amount } = parsed.data
  const slippageBps = parsed.data.slippageBps ?? 50
  const fromCode = parsed.data.from.toUpperCase()
  const toCode = parsed.data.to.toUpperCase()
  const account = session.account

  if (isSoroswapConfigured()) {
    try {
      const { quote } = await quoteSoroswapSwap(fromCode, toCode, amount, slippageBps)
      const sponsor = isSponsorConfigured() ? sponsorKeypair().publicKey() : undefined
      const built = await buildSoroswapSwap(quote, account, sponsor)
      return NextResponse.json({ provider: 'soroswap', xdr: built.xdr })
    } catch (e) {
      console.warn('[swap/build] soroswap falló, cayendo a SDEX:', e instanceof Error ? e.message : e)
    }
  }

  if (!isSdexSwapPair(fromCode, toCode)) {
    return NextResponse.json(
      { error: 'Por ahora solo puedes convertir entre XLM y USDC.' },
      { status: 422 },
    )
  }

  try {
    const quote = await quoteSdexPathPayment(
      fromCode as SdexSwapCode,
      toCode as SdexSwapCode,
      amount,
      slippageBps,
    )
    const xdr = await buildSdexPathPaymentXdr(account, quote.quote)
    return NextResponse.json({ provider: 'sdex', xdr })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'No se pudo construir la transacción'
    console.error('[swap/build]', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
