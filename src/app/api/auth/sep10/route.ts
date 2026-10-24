import { NextResponse } from 'next/server'
import {
  Sep10NotConfiguredError,
  buildSep10Challenge,
  issueSeyfSession,
  verifySep10Challenge,
} from '@/lib/stellar/sep10'
import { rateLimitResponse } from '@/lib/seyf/guards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const noStore = { 'Cache-Control': 'no-store' }

function configError(e: unknown): NextResponse | null {
  if (e instanceof Sep10NotConfiguredError) {
    console.error('[auth/sep10]', e.message)
    return NextResponse.json({ error: e.message }, { status: 503, headers: noStore })
  }
  return null
}

/** GET /api/auth/sep10?account=G... — challenge SEP-10 para firmar. */
export async function GET(request: Request) {
  const limited = await rateLimitResponse(request, 'auth/sep10-challenge', {
    limit: 30,
    windowSec: 300,
  })
  if (limited) return limited

  const account = new URL(request.url).searchParams.get('account')?.trim()
  if (!account) {
    return NextResponse.json({ error: 'account requerido' }, { status: 400, headers: noStore })
  }

  try {
    const { transaction, networkPassphrase } = buildSep10Challenge(account)
    // Nombres de campo del propio SEP-10, para que cualquier wallet estándar lo entienda.
    return NextResponse.json(
      { transaction, network_passphrase: networkPassphrase },
      { headers: noStore },
    )
  } catch (e) {
    const cfg = configError(e)
    if (cfg) return cfg
    const message = e instanceof Error ? e.message : 'No se pudo generar el challenge'
    return NextResponse.json({ error: message }, { status: 400, headers: noStore })
  }
}

/** POST /api/auth/sep10 { transaction } — valida la firma y emite la sesión SEYF. */
export async function POST(request: Request) {
  const limited = await rateLimitResponse(request, 'auth/sep10-token', { limit: 30, windowSec: 300 })
  if (limited) return limited

  const body = (await request.json().catch(() => null)) as { transaction?: unknown } | null
  const signedXdr = typeof body?.transaction === 'string' ? body.transaction.trim() : ''
  if (!signedXdr) {
    return NextResponse.json({ error: 'transaction requerido' }, { status: 400, headers: noStore })
  }

  try {
    const account = await verifySep10Challenge(signedXdr)
    const { token, expiresIn } = issueSeyfSession(account)
    return NextResponse.json(
      { token, expires_in: expiresIn, account },
      { headers: noStore },
    )
  } catch (e) {
    const cfg = configError(e)
    if (cfg) return cfg
    const message = e instanceof Error ? e.message : 'Challenge inválido'
    console.warn('[auth/sep10] challenge rechazado:', message)
    return NextResponse.json({ error: 'Challenge inválido o no firmado correctamente.' }, {
      status: 401,
      headers: noStore,
    })
  }
}
