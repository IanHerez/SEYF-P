'use client'

/**
 * Cambio de activos en Stellar desde el cliente.
 *
 * El servidor decide el camino: agregador Soroswap si hay API key (rutea por
 * Soroswap AMM, Aqua, Phoenix y SDEX), o path payment directo contra el SDEX.
 * Aquí solo se pide, se firma con Pollar y se envía.
 */

import type { PollarClient } from '@pollar/core'
import { pollarSignXdr, waitForPollarSession } from '@/lib/pollar/client-api'
import { seyfAuthHeaders } from '@/lib/stellar/auth-token'

export type SwapProvider = 'soroswap' | 'sdex'

export type SdexQuoteResult = {
  provider: SwapProvider
  from: string
  to: string
  amountIn: number
  amountOut: number
  slippageBps: number
}

async function postJson<T>(
  url: string,
  body: unknown,
  authed = false,
): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authed ? await seyfAuthHeaders() : {}),
    },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok && !data.error) {
    if (res.status === 404) {
      data.error = 'Cotización no disponible. Recarga la página (caché desactualizada).'
    } else if (res.status === 401) {
      data.error = 'Tu sesión expiró. Verifica tu wallet e intenta de nuevo.'
    } else {
      data.error = `Error del servidor (${res.status})`
    }
  }
  return { ok: res.ok, data }
}

/** Cotiza un cambio. El precio y el mínimo aceptable los fija el servidor. */
export async function quoteSdexSwap(from: string, to: string, amount: number): Promise<SdexQuoteResult> {
  const { ok, data } = await postJson<SdexQuoteResult>('/api/swap/quote', { from, to, amount })
  if (!ok) throw new Error(data.error || 'No se pudo cotizar el cambio')
  return data
}

/** Ejecuta el cambio: cotiza → arma XDR en el servidor → firma Pollar → envía. */
export async function executeSdexSwap(opts: {
  from: string
  to: string
  amount: number
  getClient: () => PollarClient
  slippageBps?: number
}): Promise<{ txHash: string; amountOut: number; amountIn: number; provider: SwapProvider }> {
  const { from, to, amount, getClient, slippageBps } = opts
  const { publicKey, client } = await waitForPollarSession(getClient)

  const quoteRes = await postJson<SdexQuoteResult>('/api/swap/quote', { from, to, amount, slippageBps })
  if (!quoteRes.ok) throw new Error(quoteRes.data.error || 'No se pudo cotizar el cambio')

  // El build vuelve a cotizar server-side: el cliente nunca manda el destMin.
  const buildRes = await postJson<{ xdr?: string; provider?: SwapProvider }>(
    '/api/swap/build',
    { from, to, amount, slippageBps },
    true,
  )
  if (!buildRes.ok || !buildRes.data.xdr) {
    throw new Error(buildRes.data.error || 'No se pudo construir la transacción')
  }

  const signedXdr = await pollarSignXdr(client, buildRes.data.xdr, publicKey)

  const sendRes = await postJson<{ txHash?: string }>('/api/swap/send', { signedXdr }, true)
  if (!sendRes.ok || !sendRes.data.txHash) {
    throw new Error(sendRes.data.error || 'La transacción no se confirmó en la red')
  }

  return {
    txHash: sendRes.data.txHash,
    amountOut: quoteRes.data.amountOut,
    amountIn: quoteRes.data.amountIn,
    provider: buildRes.data.provider ?? quoteRes.data.provider,
  }
}
