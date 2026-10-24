import { NextResponse } from 'next/server'
import { SponsorNotConfiguredError, buildSponsoredAccountCreation } from '@/lib/stellar/sponsor'
import { requireSession } from '@/lib/stellar/db-auth'
import { rateLimitResponse } from '@/lib/seyf/guards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

/**
 * POST /api/stellar/sponsor/create-account
 * XDR que crea la cuenta del usuario con la reserva pagada por el negocio.
 * La cuenta viene de la sesión SEP-10, nunca del cuerpo de la petición.
 */
export async function POST(request: Request) {
  const limited = await rateLimitResponse(request, 'sponsor/create-account', {
    limit: 5,
    windowSec: 3600,
  })
  if (limited) return limited

  const session = requireSession(request)
  if (!session.ok) return session.response

  try {
    const xdr = await buildSponsoredAccountCreation(session.account)
    return NextResponse.json({ xdr, account: session.account }, { headers: noStore })
  } catch (e) {
    if (e instanceof SponsorNotConfiguredError) {
      console.error('[sponsor/create-account]', e.message)
      return NextResponse.json({ error: e.message }, { status: 503, headers: noStore })
    }
    const message = e instanceof Error ? e.message : 'No se pudo preparar la cuenta'
    return NextResponse.json({ error: message }, { status: 400, headers: noStore })
  }
}
