# SEYF → mainnet (full Stellar)

Camino a producción con Stellar como **rail único** (se jubila el riel
Arbitrum/MXNB/Privy/Juno), y alineación con **InstaWards** y la **SCF**.

> Verificador automático: `npm run check:mainnet`
> (con `NEXT_PUBLIC_STELLAR_NETWORK=mainnet` y tus secretos en `.env.local`).

---

## 1. Qué ya es Stellar-native

| Pieza | Estándar / SDK | Estado |
|---|---|---|
| SEP-10 Web Auth (JWT, authz por usuario) | SEP-10 | ✅ probado testnet |
| Reservas + comisiones patrocinadas | CAP-33 + fee-bump | ✅ probado testnet |
| Soroswap (AMM+Aqua+Phoenix+SDEX), re-cotiza en server | `@soroswap/sdk` | ✅ fallback a SDEX |
| Reflector (precio MXN/FX on-chain) | SEP-40 oráculo | ✅ probado testnet |
| DeFindex bóvedas (XLM, CETES, USDC) — PULSO | Soroban vaults | ✅ rutas completas |
| Pollar wallet embebida (OTP headless) | Stellar wallet | ✅ |
| Etherfuse CETES/Stablebonds + KYC | Anchor / RWA | ✅ |

SEYF **integra ~7 building blocks** nativos de Stellar. Es exactamente lo que la
SCF financia ("funding Stellar and Soroban integration").

---

## 2. Config mainnet (matriz de env)

Todo resuelve testnet por defecto. Para mainnet pon `NEXT_PUBLIC_STELLAR_NETWORK=mainnet`
(y `NEXT_PUBLIC_POLLAR_STELLAR_NETWORK=mainnet`) y completa:

### Requerido (bloquea mainnet)

| Variable | Qué es |
|---|---|
| `SEP10_SERVER_SECRET` | `S…` — llave que firma challenges SEP-10 |
| `SEYF_AUTH_JWT_SECRET` | secreto JWT de sesión (≥32 chars) |
| `SEP10_HOME_DOMAIN` | dominio del challenge |
| `STELLAR_USDC_ISSUER` | `G…` — emisor USDC mainnet (Circle) |
| `DEFINDEX_API_KEY` | API key DeFindex |
| `NEXT_PUBLIC_DEFINDEX_VAULT_XLM` | `C…` — vault XLM **mainnet** |
| `NEXT_PUBLIC_DEFINDEX_VAULT_CETES` | `C…` — vault CETES **mainnet** |
| `NEXT_PUBLIC_DEFINDEX_VAULT_USDC` | `C…` — vault USDC **mainnet** |
| `SOROSWAP_API_KEY` | `sk_…` — API key Soroswap |
| `NEXT_PUBLIC_POLLAR_API_KEY` | API key Pollar |

### Recomendado

| Variable | Qué es |
|---|---|
| `STELLAR_SPONSOR_SECRET` | `S…` — llave patrocinadora, **fondeada con XLM real** |
| `STELLAR_SPONSOR_MAX_FEE` | tope de comisión del sponsor (stroops) |
| `NEXT_PUBLIC_HORIZON_URL` | Horizon de producción |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC de producción |

Los secretos van en **Vercel env** (Production), nunca en el repo.

---

## 3. Footguns detectados (revisar antes de mainnet)

1. **DeFindex cae a vaults de *testnet* en silencio.** `src/lib/defindex/catalog.ts`
   usa como fallback las direcciones de vault de paltalabs **testnet** si los env
   `NEXT_PUBLIC_DEFINDEX_VAULT_*` no están puestos. Con la red en mainnet eso
   apuntaría a contratos de testnet. → `check:mainnet` lo marca como bloqueante.
   *Pendiente de código:* gatear el fallback detrás de "solo testnet".
2. **USDC issuer.** `src/lib/soroswap/client.ts` ya lanza si falta en mainnet, pero
   el issuer de testnet no debe filtrarse. → cubierto por `check:mainnet`.
3. **Passphrase del challenge SEP-10.** El cliente ahora **valida
   `network_passphrase` antes de firmar** (`src/lib/stellar/sep10-client.ts`). ✅

---

## 4. Checklist de seguridad (cliente Soroban)

- [x] Network passphrase validada **antes de firmar** (SEP-10 cliente)
- [x] Swaps re-cotizados en el servidor (el `destMin` no viene del cliente)
- [x] Candados del sponsor: sesión SEP-10, cuenta del token, rate-limit, max-fee
- [ ] Simular tx antes de enviar en el resto de flujos de firma (auditar Pollar)
- [ ] Verificar direcciones de contrato contra despliegues conocidos (allowlist)
- [ ] Trustline comprobada antes de transferir en toda ruta de pago

## 5. Infra / operación

- [ ] Secretos en Vercel (Production), rotación documentada
- [ ] Float del sponsor **fondeado** + monitoreo de saldo + alerta
- [ ] Runbook de incidentes (pausa, agotamiento del sponsor, caída de RPC)
- [x] CI: `build` (typecheck + compile) como gate en cada push/PR (`.github/workflows/ci.yml`) — verde hoy
- [ ] Lint en verde: hay ~1955 errores heredados (React 19 / `react-hooks`); en CI es informativo hasta saldarlos
- [ ] Tests de flujos críticos (swap, deposit vault, sponsor create-account)

## 6. Identidad EVM ↔ Stellar

Al pasar a identidad Stellar (SEP-10), las filas de Supabase guardadas con
dirección EVM (Privy) quedan huérfanas. **Decisión (pivote total):** son datos de
demo en testnet → se descartan; la identidad canónica es la cuenta Stellar.

---

## 7. Alineación InstaWards + SCF

- **Round vivo:** SCF #46, fase Submission, cierre **2026-11-08**. Vertical: *Wallet*.
  Peers financiados: Emigro ($176k, remesas LatAm), Meru ($225k), Beans ($490k).
- **InstaWards** — financiamiento acelerado, tier pequeño, **atado a un sprint de
  alcance acotado** (shipping de un feature para usuarios piloto / tooling
  open-source). Liderado por **capítulos de Stellar Ambassadors regionales**
  (ángulo México). On-ramp natural al Build Award.
  [Reglas](https://stellar.gitbook.io/scf-handbook/scf-awards/instawards/official-rules)
- **Build Award** — hasta **$150k en XLM**, 3 tranches por milestones, 3–6 meses,
  +Audit Bank.
  [Criterios](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria)
- **Exige:** ser **Verified member**, pasar **KYC + sanctions**, deliverables
  medibles; para programas de Growth, estar **live en mainnet**.

**Plan InstaWard (sprint acotado):**
1. SEYF **live en mainnet** (esta guía).
2. **Open-source** del repo (o del subconjunto Stellar).
3. Un feature de piloto bien delimitado (p. ej. depósito a bóveda CETES on-chain
   con onboarding patrocinado, extremo a extremo en mainnet).
4. Contacto con el **capítulo Ambassador MX** para la referral del InstaWard.

---

*Fuentes SCF verificadas vía stellar-raven (SCF Handbook, en vivo) el 2026-10-23.*
