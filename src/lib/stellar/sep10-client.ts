'use client'

/**
 * Lado cliente de SEP-10: pide el challenge, lo firma con Pollar y guarda la
 * sesión. La firma NO se envía a la red — es solo la prueba de que el usuario
 * controla su llave.
 */

import type { PollarClient } from '@pollar/core'
import { pollarSignXdr } from '@/lib/pollar/client-api'
import { stellarNetworkPassphrase } from '@/lib/stellar/network'
import {
  peekSeyfAuthToken,
  setSeyfAuthInflight,
  setSeyfAuthToken,
} from '@/lib/stellar/auth-token'

type ChallengeResponse = { transaction?: string; network_passphrase?: string; error?: string }
type TokenResponse = { token?: string; expires_in?: number; account?: string; error?: string }

async function mintToken(client: PollarClient, publicKey: string): Promise<string | null> {
  const challengeRes = await fetch(`/api/auth/sep10?account=${encodeURIComponent(publicKey)}`, {
    headers: { Accept: 'application/json' },
  })
  const challenge = (await challengeRes.json().catch(() => ({}))) as ChallengeResponse
  if (!challengeRes.ok || !challenge.transaction) {
    throw new Error(challenge.error || 'No se pudo iniciar la sesión segura.')
  }

  // No firmar nunca un challenge de otra red: en mainnet, una passphrase que no
  // coincide con la configurada significa servidor mal apuntado o manipulado.
  // (Checklist de seguridad Soroban: validar network passphrase ANTES de firmar.)
  const expectedPassphrase = stellarNetworkPassphrase()
  if (challenge.network_passphrase !== expectedPassphrase) {
    throw new Error('La red del challenge no coincide con la configurada. No se firmó nada.')
  }

  const signedXdr = await pollarSignXdr(client, challenge.transaction, publicKey)

  const tokenRes = await fetch('/api/auth/sep10', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: signedXdr }),
  })
  const token = (await tokenRes.json().catch(() => ({}))) as TokenResponse
  if (!tokenRes.ok || !token.token) {
    throw new Error(token.error || 'No se pudo validar tu firma.')
  }

  setSeyfAuthToken(token.token, token.account ?? publicKey, token.expires_in ?? 86_400)
  return token.token
}

/**
 * Devuelve un token de sesión válido, firmando un challenge si hace falta.
 * Idempotente: varias llamadas concurrentes comparten el mismo minteo.
 */
export async function ensureSeyfSession(
  client: PollarClient,
  publicKey: string,
): Promise<string | null> {
  const existing = peekSeyfAuthToken()
  if (existing) return existing

  const promise = mintToken(client, publicKey).catch((e) => {
    console.warn('[sep10] no se pudo abrir la sesión:', e instanceof Error ? e.message : e)
    return null
  })
  setSeyfAuthInflight(promise)
  try {
    return await promise
  } finally {
    setSeyfAuthInflight(null)
  }
}
