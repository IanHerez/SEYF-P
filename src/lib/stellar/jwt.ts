/**
 * JWT HS256 mínimo sobre node:crypto — sin dependencias nuevas.
 * Solo lo que necesita la sesión SEP-10: firmar y verificar un token propio.
 */

import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

export type SeyfJwtPayload = {
  /** Cuenta Stellar (G...) que demostró control de su llave vía SEP-10. */
  sub: string
  /** Dominio que emitió el token. */
  iss: string
  iat: number
  exp: number
}

const b64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const b64urlJson = (value: unknown): string => b64url(Buffer.from(JSON.stringify(value), 'utf8'))

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function hmac(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest()
}

export function signSeyfJwt(
  payload: Omit<SeyfJwtPayload, 'iat' | 'exp'>,
  secret: string,
  ttlSec: number,
): string {
  const now = Math.floor(Date.now() / 1000)
  const body: SeyfJwtPayload = { ...payload, iat: now, exp: now + ttlSec }
  const head = b64urlJson({ alg: 'HS256', typ: 'JWT' })
  const claims = b64urlJson(body)
  const sig = b64url(hmac(`${head}.${claims}`, secret))
  return `${head}.${claims}.${sig}`
}

/** Devuelve el payload si la firma y el `exp` son válidos; `null` en cualquier otro caso. */
export function verifySeyfJwt(token: string, secret: string): SeyfJwtPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [head, claims, sig] = parts

  const expected = hmac(`${head}.${claims}`, secret)
  const got = fromB64url(sig)
  // timingSafeEqual exige longitudes iguales — compararlas antes evita que lance.
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null

  try {
    const payload = JSON.parse(fromB64url(claims).toString('utf8')) as SeyfJwtPayload
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null
    if (typeof payload.sub !== 'string' || !payload.sub) return null
    return payload
  } catch {
    return null
  }
}
