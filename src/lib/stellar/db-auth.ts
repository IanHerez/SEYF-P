/**
 * Autorización de las rutas /api/db/* y de las que operan sobre fondos.
 *
 * Antes el `wallet` del query string era la única "identidad": cualquiera con
 * una dirección ajena leía y escribía ese perfil. Ahora toda petición exige
 * una sesión SEP-10 y la wallet pedida tiene que SER la cuenta de la sesión.
 *
 * Regla única y sin excepciones: `wallet === sub`. No hay binding al primer
 * uso ni listas de confianza — una dirección EVM no se puede probar con una
 * llave Stellar, así que el cliente keyea sus filas por la cuenta Stellar
 * (lo hace `store.ts` al reescribir el parámetro con la sesión activa).
 */

import 'server-only'
import { NextResponse } from 'next/server'
import { Sep10NotConfiguredError, readSeyfSession } from '@/lib/stellar/sep10'

/** `enforce` (default) rechaza; `audit` solo registra — válvula de escape temporal. */
function auditOnly(): boolean {
  return process.env.SEYF_DB_AUTH_MODE?.trim().toLowerCase() === 'audit'
}

const noStore = { 'Cache-Control': 'no-store' }

export type DbAccess = { ok: true; account: string | null } | { ok: false; response: NextResponse }

function deny(status: number, message: string, wallet: string): DbAccess {
  if (auditOnly()) {
    console.warn(`[db-auth] AUDIT — se habría rechazado (${status}) para ${wallet}: ${message}`)
    return { ok: true, account: null }
  }
  return {
    ok: false,
    response: NextResponse.json({ error: message }, { status, headers: noStore }),
  }
}

type SessionOutcome =
  | { ok: true; account: string }
  | { ok: false; status: number; message: string }

function sessionFrom(request: Request): SessionOutcome {
  let session: ReturnType<typeof readSeyfSession>
  try {
    session = readSeyfSession(request)
  } catch (e) {
    if (e instanceof Sep10NotConfiguredError) {
      console.error('[db-auth]', e.message)
      return { ok: false, status: 503, message: 'La autenticación del servidor no está configurada.' }
    }
    throw e
  }
  if (!session) {
    return {
      ok: false,
      status: 401,
      message: 'Sesión requerida. Verifica tu wallet Stellar e intenta de nuevo.',
    }
  }
  return { ok: true, account: session.sub }
}

/** Exige una sesión SEP-10 cuya cuenta sea exactamente `wallet`. */
export async function requireDbAccess(request: Request, wallet: string): Promise<DbAccess> {
  const session = sessionFrom(request)
  if (!session.ok) return deny(session.status, session.message, wallet)
  if (wallet !== session.account) {
    return deny(403, 'Esta cuenta no te pertenece.', wallet)
  }
  return { ok: true, account: session.account }
}

/**
 * Sesión SEP-10 obligatoria, sin wallet que comprobar.
 * Para rutas que actúan siempre sobre la cuenta del propio usuario.
 */
export function requireSession(
  request: Request,
): { ok: true; account: string } | { ok: false; response: NextResponse } {
  const session = sessionFrom(request)
  if (session.ok) return { ok: true, account: session.account }
  return {
    ok: false,
    response: NextResponse.json({ error: session.message }, { status: session.status, headers: noStore }),
  }
}
