/**
 * Red Stellar resuelta desde env, con las URLs que acompañan a cada red.
 * Única fuente de passphrase/Horizon/RPC para todo lo que toca la red.
 */

import { Networks } from '@stellar/stellar-sdk'
import {
  stellarWalletNetworkFromEnv,
  type PublicStellarNetwork,
} from '@/lib/seyf/stellar-wallet-network'

export type { PublicStellarNetwork }
export { stellarWalletNetworkFromEnv }

export function stellarNetworkPassphrase(): string {
  return stellarWalletNetworkFromEnv() === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET
}

export function horizonUrl(): string {
  const override = process.env.NEXT_PUBLIC_HORIZON_URL?.trim()
  if (override) return override
  return stellarWalletNetworkFromEnv() === 'mainnet'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org'
}

export function sorobanRpcUrl(): string {
  const override = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL?.trim()
  if (override) return override
  return stellarWalletNetworkFromEnv() === 'mainnet'
    ? 'https://mainnet.sorobanrpc.com'
    : 'https://soroban-testnet.stellar.org'
}
