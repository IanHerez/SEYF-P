import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Horizon, Transaction } from '@stellar/stellar-sdk'
import { horizonUrl, stellarNetworkPassphrase } from '@/lib/stellar/network'
import { requireSession } from '@/lib/stellar/db-auth'
import { isSponsorConfigured, submitFeeBumped } from '@/lib/stellar/sponsor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({ signedXdr: z.string().trim().min(1) })

/**
 * POST /api/swap/send — envía el cambio ya firmado.
 * Si hay sponsor configurado, va en fee-bump (el negocio paga la comisión).
 */
export async function POST(req: Request) {
  const session = requireSession(req)
  if (!session.ok) return session.response

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  }

  try {
    if (isSponsorConfigured()) {
      const result = await submitFeeBumped(parsed.data.signedXdr, [session.account])
      return NextResponse.json({ txHash: result.hash, sponsored: true })
    }

    const tx = new Transaction(parsed.data.signedXdr, stellarNetworkPassphrase())
    if (tx.source !== session.account) {
      return NextResponse.json({ error: 'Esta transacción no corresponde a tu cuenta.' }, { status: 403 })
    }
    const res = await new Horizon.Server(horizonUrl()).submitTransaction(tx)
    return NextResponse.json({ txHash: res.hash, sponsored: false })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'La transacción no se confirmó en la red'
    console.error('[swap/send]', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
