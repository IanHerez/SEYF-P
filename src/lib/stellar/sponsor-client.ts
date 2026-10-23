'use client'

/**
 * Flujo cliente del patrocinio: el servidor arma y firma como sponsor, el
 * usuario co-firma con Pollar, y el envío va en fee-bump (el negocio paga).
 */

import type { PollarClient } from '@pollar/core'
import { pollarSignXdr } from '@/lib/pollar/client-api'
import { seyfAuthHeaders } from '@/lib/stellar/auth-token'

type XdrResponse = { xdr?: string; error?: string }
type SubmitResponse = { txHash?: string; successful?: boolean; error?: string }

async function postAuthed<T>(url: string, body?: unknown): Promise<{ ok: boolean; data: T }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await seyfAuthHeaders()) },
    body: JSON.stringify(body ?? {}),
  })
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as T }
}

/** Firma con Pollar y envía por fee-bump. Devuelve el hash de la transacción. */
async function signAndSubmitSponsored(
  client: PollarClient,
  publicKey: string,
  xdr: string,
): Promise<string> {
  const signedXdr = await pollarSignXdr(client, xdr, publicKey)
  const { ok, data } = await postAuthed<SubmitResponse>('/api/stellar/sponsor/submit', { signedXdr })
  if (!ok || !data.txHash) {
    throw new Error(data.error || 'La transacción no se confirmó en la red')
  }
  return data.txHash
}

/**
 * Garantiza que la cuenta exista en el ledger sin pedirle XLM al usuario.
 * Si ya existe, no hace nada.
 */
export async function ensureSponsoredAccount(
  client: PollarClient,
  publicKey: string,
): Promise<{ created: boolean; txHash?: string }> {
  const { ok, data } = await postAuthed<XdrResponse>('/api/stellar/sponsor/create-account')
  if (!ok || !data.xdr) {
    // "La cuenta ya existe" no es un fallo: es el estado que queríamos.
    if (data.error?.toLowerCase().includes('ya existe')) return { created: false }
    throw new Error(data.error || 'No se pudo crear tu cuenta Stellar')
  }
  const txHash = await signAndSubmitSponsored(client, publicKey, data.xdr)
  return { created: true, txHash }
}

/** Abre una trustline con la reserva pagada por el negocio. */
export async function ensureSponsoredTrustline(
  client: PollarClient,
  publicKey: string,
  assetCode: string,
  assetIssuer: string,
): Promise<string> {
  const { ok, data } = await postAuthed<XdrResponse>('/api/stellar/sponsor/trustline', {
    assetCode,
    assetIssuer,
  })
  if (!ok || !data.xdr) {
    throw new Error(data.error || 'No se pudo abrir la trustline')
  }
  return signAndSubmitSponsored(client, publicKey, data.xdr)
}
