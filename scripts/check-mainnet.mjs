#!/usr/bin/env node
/**
 * check-mainnet — verificador de readiness para salir a mainnet (full Stellar).
 *
 * No toca la red: solo lee el entorno y reporta qué falta o qué apunta a testnet
 * antes de que lo descubras en producción. Pensado para correr en local
 * (`npm run check:mainnet`) y como evidencia de readiness para la SCF.
 *
 * Carga `.env.local` y `.env` si existen (process.env real siempre gana), igual
 * que hace Next para variables de build.
 *
 * Salida: 0 si no hay errores, 1 si falta algo requerido o hay un valor de
 * testnet filtrado a mainnet.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// --- carga mínima de .env (sin dependencias) --------------------------------
function loadEnvFile(name) {
  const path = resolve(ROOT, name)
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    const key = m[1]
    if (key in process.env) continue // process.env real gana
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    process.env[key] = val
  }
}
loadEnvFile('.env.local')
loadEnvFile('.env')

// --- helpers ----------------------------------------------------------------
const env = (k) => (process.env[k] ?? '').trim()
const isG = (v) => /^G[A-Z2-7]{55}$/.test(v) // ed25519 public (issuer)
const isS = (v) => /^S[A-Z2-7]{55}$/.test(v) // ed25519 secret seed
const isC = (v) => /^C[A-Z2-7]{55}$/.test(v) // contract id (vault/SAC)

const NETWORK =
  env('NEXT_PUBLIC_POLLAR_STELLAR_NETWORK') ||
  env('NEXT_PUBLIC_ACCESLY_NETWORK') ||
  env('NEXT_PUBLIC_STELLAR_NETWORK') ||
  'testnet'
const IS_MAINNET = NETWORK === 'mainnet'

// Valores de TESTNET conocidos: si aparecen con la red en mainnet, es un bug.
const TESTNET_LEAKS = {
  STELLAR_USDC_ISSUER: ['GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'],
  NEXT_PUBLIC_DEFINDEX_VAULT_XLM: ['CCLV4H7WTLJQ7ATLHBBQV2WW3OINF3FOY5XZ7VPHZO7NH3D2ZS4GFSF6'],
  NEXT_PUBLIC_DEFINDEX_VAULT_CETES: ['CBIS5TEMTNNOTBE3WXPQUAGUEDYZZVIWAKTXEQCOUJ34OJJ3FJ5NLF2P'],
  NEXT_PUBLIC_DEFINDEX_VAULT_USDC: ['CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN'],
}

const errors = []
const warnings = []
const oks = []

function need(key, { label, validate, hint } = {}) {
  const v = env(key)
  const name = label || key
  if (!v) {
    errors.push(`${key} — falta (${name})${hint ? ` · ${hint}` : ''}`)
    return
  }
  if (validate && !validate(v)) {
    errors.push(`${key} — formato inválido (${name})${hint ? ` · ${hint}` : ''}`)
    return
  }
  if ((TESTNET_LEAKS[key] || []).includes(v)) {
    errors.push(`${key} — es un valor de TESTNET con la red en mainnet (${name}). Cámbialo por el de producción.`)
    return
  }
  oks.push(`${key} ✓`)
}

function want(key, { label, validate, hint } = {}) {
  const v = env(key)
  const name = label || key
  if (!v) {
    warnings.push(`${key} — recomendado pero ausente (${name})${hint ? ` · ${hint}` : ''}`)
    return
  }
  if (validate && !validate(v)) {
    warnings.push(`${key} — formato sospechoso (${name})`)
    return
  }
  oks.push(`${key} ✓`)
}

// --- reglas (full Stellar) --------------------------------------------------
function run() {
  // Identidad / sesión SEP-10
  need('SEP10_SERVER_SECRET', { label: 'llave que firma challenges SEP-10', validate: isS })
  need('SEYF_AUTH_JWT_SECRET', { label: 'secreto del JWT de sesión', validate: (v) => v.length >= 32, hint: 'mínimo 32 chars' })
  need('SEP10_HOME_DOMAIN', { label: 'home domain del challenge' })

  // Activos
  need('STELLAR_USDC_ISSUER', { label: 'emisor USDC mainnet (Circle)', validate: isG })

  // Bóvedas DeFindex (PULSO)
  need('DEFINDEX_API_KEY', { label: 'API key DeFindex' })
  need('NEXT_PUBLIC_DEFINDEX_VAULT_XLM', { label: 'vault XLM mainnet', validate: isC })
  need('NEXT_PUBLIC_DEFINDEX_VAULT_CETES', { label: 'vault CETES mainnet', validate: isC })
  need('NEXT_PUBLIC_DEFINDEX_VAULT_USDC', { label: 'vault USDC mainnet', validate: isC })

  // Agregador de swaps
  need('SOROSWAP_API_KEY', { label: 'API key Soroswap', validate: (v) => v.startsWith('sk_'), hint: 'empieza con sk_' })

  // Wallet embebida
  need('NEXT_PUBLIC_POLLAR_API_KEY', { label: 'API key Pollar' })
  if (env('NEXT_PUBLIC_POLLAR_STELLAR_NETWORK') !== 'mainnet') {
    errors.push('NEXT_PUBLIC_POLLAR_STELLAR_NETWORK — debe ser "mainnet" para alinear la wallet Pollar con la red.')
  } else {
    oks.push('NEXT_PUBLIC_POLLAR_STELLAR_NETWORK ✓')
  }

  // Patrocinio (onboarding sin Friendbot) — recomendado
  want('STELLAR_SPONSOR_SECRET', { label: 'llave patrocinadora (fondéala con XLM real)', validate: isS })
  want('STELLAR_SPONSOR_MAX_FEE', { label: 'tope de comisión del sponsor (stroops)' })

  // Endpoints — opcionales (hay defaults públicos), recomendados en prod
  want('NEXT_PUBLIC_HORIZON_URL', { label: 'Horizon de producción' })
  want('NEXT_PUBLIC_SOROBAN_RPC_URL', { label: 'Soroban RPC de producción' })
}

// --- salida -----------------------------------------------------------------
const B = '\x1b[1m', R = '\x1b[31m', Y = '\x1b[33m', G = '\x1b[32m', D = '\x1b[2m', X = '\x1b[0m'

console.log(`\n${B}SEYF · readiness mainnet (full Stellar)${X}`)
console.log(`${D}red detectada: ${X}${B}${NETWORK}${X}\n`)

if (!IS_MAINNET) {
  console.log(`${Y}La red no está en mainnet — no hay nada que bloquear.${X}`)
  console.log(`${D}Para verificar el set de producción: NEXT_PUBLIC_STELLAR_NETWORK=mainnet npm run check:mainnet${X}`)
  console.log(`${D}(con tus secretos cargados en .env.local)\n${X}`)
  process.exit(0)
}

run()

if (oks.length) {
  console.log(`${G}${B}OK (${oks.length})${X}`)
  for (const o of oks) console.log(`  ${G}✓${X} ${o.replace(' ✓', '')}`)
  console.log('')
}
if (warnings.length) {
  console.log(`${Y}${B}Avisos (${warnings.length})${X}`)
  for (const w of warnings) console.log(`  ${Y}⚠${X}  ${w}`)
  console.log('')
}
if (errors.length) {
  console.log(`${R}${B}Bloqueantes (${errors.length})${X}`)
  for (const e of errors) console.log(`  ${R}✗${X}  ${e}`)
  console.log('')
}

if (errors.length) {
  console.log(`${R}${B}No listo para mainnet: resuelve los ${errors.length} bloqueante(s).${X}\n`)
  process.exit(1)
}
console.log(`${G}${B}Listo para mainnet.${X}${warnings.length ? ` ${Y}(revisa los ${warnings.length} aviso(s))${X}` : ''}\n`)
process.exit(0)
