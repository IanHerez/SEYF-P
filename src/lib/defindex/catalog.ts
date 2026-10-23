// Catálogo DeFindex testnet (Palta Labs). Fuente: testnet.contracts.json
// https://github.com/paltalabs/defindex/blob/main/public/testnet.contracts.json

import { isPublicStellarTestnet } from '@/lib/seyf/stellar-wallet-network'

export const DEFINDEX_FACTORY_ADDRESS =
  'CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32'

export type DefindexStrategyId = 'cetes' | 'usdc' | 'xlm'

/** planId del cuestionario de riesgo → estrategia DeFindex. */
export type DefindexPlanId = 'conservador' | 'moderado' | 'balanceado'

export interface DefindexStrategyConfig {
  id: DefindexStrategyId
  planId: DefindexPlanId
  name: string
  strategyAddress: string
  strategyName: string
  vaultKey: string
  vaultAddress: string
  assetSymbol: string
  assetIssuer: string
  decimals: number
  risk: 'Bajo' | 'Medio' | 'Alto'
  horizon: string
  exposure: string
  structured: string
  color: string
  emoji: string
  /** APY de referencia que se muestra mientras DeFindex aún no responde el APY en vivo. */
  apyTarget: number
}

// Direcciones de vault DeFindex, una por bóveda SEYF (CETES, USDC, XLM).
// IMPORTANTE: deben ser VAULTS, no estrategias. La API DeFindex (GET /vault/{addr},
// POST /vault/{addr}/deposit) rechaza direcciones de estrategia (→ 500/502).
// Configurables por env (NEXT_PUBLIC_DEFINDEX_VAULT_*) → pon ahí TUS vaults de mainnet.
// El fallback a los vaults de paltalabs es SOLO testnet: en mainnet sin env el address
// queda vacío a propósito (fallar visible es mejor que apuntar a contratos de testnet).
const TESTNET_VAULT_FALLBACK = isPublicStellarTestnet()
const VAULT_XLM =
  process.env.NEXT_PUBLIC_DEFINDEX_VAULT_XLM?.trim() ||
  (TESTNET_VAULT_FALLBACK ? 'CCLV4H7WTLJQ7ATLHBBQV2WW3OINF3FOY5XZ7VPHZO7NH3D2ZS4GFSF6' : '')
const VAULT_CETES =
  process.env.NEXT_PUBLIC_DEFINDEX_VAULT_CETES?.trim() ||
  (TESTNET_VAULT_FALLBACK ? 'CBIS5TEMTNNOTBE3WXPQUAGUEDYZZVIWAKTXEQCOUJ34OJJ3FJ5NLF2P' : '')
const VAULT_USDC =
  process.env.NEXT_PUBLIC_DEFINDEX_VAULT_USDC?.trim() ||
  (TESTNET_VAULT_FALLBACK ? 'CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN' : '')

// XLM va primero: el usuario tiene XLM (fondeado por Friendbot), así que es la
// bóveda con la que sí puede depositar de inmediato → preferencia en UI y default.
export const DEFINDEX_STRATEGIES: DefindexStrategyConfig[] = [
  {
    id: 'xlm',
    planId: 'balanceado',
    name: 'XLM',
    strategyAddress: 'CDVLOSPJPQOTB6ZCWO5VSGTOLGMKTXSFWYTUP572GTPNOWX4F76X3HPM',
    strategyName: 'XLM Blend Strategy',
    vaultKey: 'xlm_paltalabs_vault',
    vaultAddress: VAULT_XLM,
    assetSymbol: 'XLM',
    assetIssuer: '',
    decimals: 7,
    risk: 'Medio',
    horizon: '7 a 15 años',
    exposure: 'Activo nativo de Stellar (XLM)',
    structured: 'Exposición a XLM, el activo de la red Stellar. Más potencial de rendimiento con algo más de variación.',
    color: 'var(--accent)',
    emoji: '📊',
    // APY de referencia cercano al rendimiento real de XLM en testnet.
    apyTarget: 2.8,
  },
  {
    id: 'cetes',
    planId: 'conservador',
    name: 'CETES',
    strategyAddress: 'CCP4RBDWPRNO2LWO23XFU4BBLGA73J5N3BK7EHRJUHVN33YEMMFB2MBE',
    strategyName: 'CETES Blend Strategy',
    vaultKey: 'cetes_paltalabs_vault',
    vaultAddress: VAULT_CETES,
    assetSymbol: 'CETES',
    assetIssuer: 'GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4',
    decimals: 7,
    risk: 'Bajo',
    horizon: '0 a 3 años',
    exposure: 'Bonos del gobierno mexicano (CETES)',
    structured: 'Tu dinero rinde en CETES, deuda del gobierno mexicano en pesos. Riesgo bajo y rendimiento estable.',
    color: '#5BD6C0',
    emoji: '🛡️',
    // APY de referencia mientras no carga el vivo — cercano al rendimiento real de CETES.
    apyTarget: 10.5,
  },
  {
    id: 'usdc',
    planId: 'moderado',
    name: 'USDC',
    strategyAddress: 'CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY',
    strategyName: 'USDC Blend Strategy',
    vaultKey: 'usdc_paltalabs_vault',
    vaultAddress: VAULT_USDC,
    assetSymbol: 'USDC',
    assetIssuer: 'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56',
    decimals: 7,
    risk: 'Bajo',
    horizon: '3 a 7 años',
    exposure: 'Dólar digital estable (USDC)',
    structured: 'Ahorro en USDC, un dólar digital estable 1:1 con el dólar de EE. UU. Rendimiento en dólares.',
    color: '#7C9EFF',
    emoji: '🧭',
    // APY de referencia cercano al rendimiento real de USDC en testnet.
    apyTarget: 4.5,
  },
]

export function strategyById(id: string): DefindexStrategyConfig | undefined {
  return DEFINDEX_STRATEGIES.find((s) => s.id === id)
}

export function strategyByPlanId(planId?: string): DefindexStrategyConfig | undefined {
  if (!planId) return undefined
  return DEFINDEX_STRATEGIES.find((s) => s.planId === planId)
}

export function strategyByVaultAddress(address?: string): DefindexStrategyConfig | undefined {
  const a = (address || '').trim().toUpperCase()
  if (!a) return undefined
  return DEFINDEX_STRATEGIES.find((s) => s.vaultAddress.toUpperCase() === a)
}

export function resolveStrategy(planId?: string): DefindexStrategyConfig {
  return strategyByPlanId(planId) ?? DEFINDEX_STRATEGIES[0]
}

/** Bóvedas creadas antes de `planId`: inferir por strategyId o por nombre (USDC, XLM, CETES). */
export function inferPlanIdForVault(v: {
  planId?: string
  strategyId?: string
  nm?: string
}): DefindexPlanId {
  if (v.planId && strategyByPlanId(v.planId)) return v.planId as DefindexPlanId
  if (v.strategyId) {
    const s = strategyById(v.strategyId)
    if (s) return s.planId
  }
  const nm = (v.nm || '').trim().toUpperCase()
  const byName = DEFINDEX_STRATEGIES.find((s) => s.name.toUpperCase() === nm)
  if (byName) return byName.planId
  return 'conservador'
}

export function inferStrategyForVault(v: {
  planId?: string
  strategyId?: string
  nm?: string
}): DefindexStrategyConfig {
  if (v.strategyId) {
    const s = strategyById(v.strategyId)
    if (s) return s
  }
  return resolveStrategy(inferPlanIdForVault(v))
}
