import { NextResponse } from 'next/server'
import { z } from 'zod'
import { SponsorNotConfiguredError, buildSponsoredTrustline } from '@/lib/stellar/sponsor'
import { requireSession } from '@/lib/stellar/db-auth'
import { rateLimitResponse } from '@/lib/seyf/guards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

const bodySchema = z.object({
  assetCode: z.string().trim().min(1).max(12),
  assetIssuer: z.string().trim().min(56).max(56),
})

/**
 * POST /api/stellar/sponsor/trustline
 * XDR de changeTrust con la reserva (0.5 XLM) pagada por el negocio.
 */
export async function POST(request: Request) {
  const limited = await rateLimitResponse(request, 'sponsor/trustline', {
    limit: 10,
    windowSec: 3600,
  })
  if (limited) return limited

  const session = requireSession(request)
  if (!session.ok) return session.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400, headers: noStore })
  }

  try {
    const xdr = await buildSponsoredTrustline(
      session.account,
      parsed.data.assetCode,
      parsed.data.assetIssuer,
    )
    return NextResponse.json({ xdr }, { headers: noStore })
  } catch (e) {
    if (e instanceof SponsorNotConfiguredError) {
      console.error('[sponsor/trustline]', e.message)
      return NextResponse.json({ error: e.message }, { status: 503, headers: noStore })
    }
    const message = e instanceof Error ? e.message : 'No se pudo preparar la trustline'
    return NextResponse.json({ error: message }, { status: 400, headers: noStore })
  }
}
