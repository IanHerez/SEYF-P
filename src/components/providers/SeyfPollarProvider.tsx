'use client'

import { ReactNode, useMemo } from 'react'
import { PollarProvider } from '@pollar/react'
import type { PollarClientConfig } from '@pollar/core'
import '@pollar/react/styles.css'
import { stellarWalletNetworkFromEnv } from '@/lib/seyf/stellar-wallet-network'
import SeyfAuthBridge from './SeyfAuthBridge'

export default function SeyfPollarProvider({ children }: { children: ReactNode }) {
  const apiKey =
    process.env.NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_POLLAR_API_KEY?.trim() ||
    ''

  const stellarNetwork = stellarWalletNetworkFromEnv()

  const config = useMemo((): PollarClientConfig => ({ apiKey, stellarNetwork }), [apiKey, stellarNetwork])

  if (typeof window !== 'undefined' && !apiKey) {
    console.warn('[SEYF] Falta NEXT_PUBLIC_POLLAR_API_KEY para wallet Stellar (CETES).')
  }

  return (
    <PollarProvider config={config}>
      <SeyfAuthBridge />
      {children}
    </PollarProvider>
  )
}
