# SEYF × ecosistema Stellar

Qué piezas nativas de Stellar usa SEYF, por qué, y qué falta decidir.

---

## 1. SEP-10 Web Auth — identidad probada

**Problema que resuelve.** Las rutas `/api/db/*` recibían la wallet como
parámetro (`?wallet=G...`) y detrás tenían Supabase con `service_role`. Como una
dirección Stellar es pública, cualquiera leía y sobreescribía el perfil, las
bóvedas, las conversiones y los **límites mensuales** de cualquier usuario.

**Cómo queda.** El usuario firma un challenge con su llave y recibe un JWT cuyo
`sub` es su cuenta Stellar. Ninguna ruta vuelve a creerle al cliente quién es.

```
GET  /api/auth/sep10?account=G…   → { transaction, network_passphrase }
     (firma con Pollar: pollarSignXdr — NO se envía a la red)
POST /api/auth/sep10 { transaction } → { token, expires_in, account }
     → Authorization: Bearer <token> en todas las rutas de datos
```

| Pieza | Ruta |
|---|---|
| Challenge / verificación | `src/lib/stellar/sep10.ts` |
| JWT HS256 (sin dependencias nuevas) | `src/lib/stellar/jwt.ts` |
| Guard de rutas | `src/lib/stellar/db-auth.ts` |
| Endpoint | `src/app/api/auth/sep10/route.ts` |
| Cliente (firma + caché) | `src/lib/stellar/sep10-client.ts`, `auth-token.ts` |
| Minteo automático al conectar | `src/components/providers/SeyfAuthBridge.tsx` |

**Regla de autorización: `wallet === sub`, sin excepciones.** Una dirección EVM
(Privy) no se puede probar con una llave Stellar, así que `store.ts` reescribe
el parámetro `wallet` con la cuenta de la sesión antes de cada llamada. La
identidad de los datos es la cuenta Stellar.

> **Consecuencia:** las filas de Supabase guardadas con la dirección EVM quedan
> huérfanas (en testnet, datos de demo). Si hay que conservarlas, el camino es
> firmar un mensaje con la wallet EVM de Privy y verificarlo en el servidor para
> ligar las dos identidades — es el pendiente §3.2 del roadmap.

Cuenta no existente en el ledger → se verifica contra la master key (lo que
manda SEP-10). Cuenta ya creada → se exige el `med_threshold` real con sus
firmantes, así una cuenta con multisig no se autentica con una firma suelta.

### Verificado

| Prueba | Resultado |
|---|---|
| `GET` perfil sin token | `401` |
| Challenge firmado por un impostor | `401` |
| Token con la firma alterada | `401` |
| Perfil/bóveda **ajena** con token válido (lectura y escritura) | `403` |
| `POST /api/db/limits` sin token | `401` |
| Perfil propio con token | `200` |

---

## 2. Reservas y comisiones patrocinadas — onboarding en mainnet

**Problema que resuelve.** En mainnet no hay Friendbot. Una wallet recién creada
no existe en el ledger, no tiene reserva base ni XLM para comisiones, y por
tanto **no puede firmar nada**. `ensureFunded` devolvía literalmente "la wallet
debe fondearse con XLM real": el fin del onboarding.

**Cómo queda.** El negocio paga, con las primitivas de la red:

- `beginSponsoringFutureReserves` … `endSponsoringFutureReserves` (CAP-33)
  cubren la reserva base de la cuenta y la de cada trustline. El XLM **no se
  gasta**: el sponsor lo recupera si la reserva se revoca.
- El **fee-bump** deja que el sponsor pague la comisión de una transacción ya
  firmada por el usuario, sin pedirle firma otra vez.

```
POST /api/stellar/sponsor/create-account → XDR firmado por el sponsor
     (el usuario co-firma: el endSponsoring va a nombre de su cuenta)
POST /api/stellar/sponsor/submit { signedXdr } → fee-bump + envío
POST /api/stellar/sponsor/trustline { assetCode, assetIssuer } → trustline gratis
```

Candados: sesión SEP-10 obligatoria, la cuenta sale del token (nunca del
cuerpo), rate limit por IP (5 creaciones/hora), tope de comisión
(`STELLAR_SPONSOR_MAX_FEE`), y solo se paga por transacciones cuya fuente sea el
propio usuario. Una llave patrocinadora sin candados se vacía en minutos.

### Verificado en testnet

Cuenta inexistente → sesión SEP-10 → XDR patrocinado → co-firma → fee-bump:

```
tx 6b1005ebfd92e0eae3b39fdc7809961d48ee57a1272c4ce4e27617b28657f507
cuenta creada    → XLM del usuario: 0.0000000 | reservas patrocinadas: 2
coste al negocio → 0.0000400 XLM de comisión (la reserva queda retenida, no gastada)
```

---

## 3. Soroswap — agregador de DEXs

**Problema que resuelve.** El swap solo hacía path payments XLM↔USDC contra el
SDEX clásico: un mercado, un par. Y `/api/sdex/build` recibía del cliente el
objeto `quote` completo — de ahí salía el `destMin`, así que un cliente
manipulado podía hacer firmar un swap con la protección de slippage en cero.

**Cómo queda.** `/api/swap/*` rutea por Soroswap AMM + Aqua + Phoenix + SDEX con
el SDK oficial (`@soroswap/sdk`), y **vuelve a cotizar en el servidor** al armar
el XDR: el cliente solo dice qué quiere cambiar, el precio mínimo lo fija el
servidor.

```
POST /api/swap/quote  { from, to, amount, slippageBps } → { provider, amountOut }
POST /api/swap/build  { from, to, amount, slippageBps } → { xdr }   (sesión requerida)
POST /api/swap/send   { signedXdr } → { txHash, sponsored }         (sesión requerida)
```

Sin `SOROSWAP_API_KEY` cae solo al path payment del SDEX — misma interfaz. Si
hay sponsor configurado, el swap se envía en fee-bump. Las direcciones de
contrato (SAC) se derivan del activo con `Asset.contractId()`, no se hardcodean.

`/api/sdex/{quote,build}` quedaron eliminadas (`/api/sdex/send` sigue en uso por
`send-stellar.ts`).

---

## 4. Reflector — precios on-chain

**Problema que resuelve.** El saldo que el usuario ve en pesos dependía del
ticker privado de Bitso: off-chain, con API key, en el camino crítico.

**Cómo queda.** Reflector publica los precios como contratos Soroban (SEP-40), y
su feed de divisas **incluye MXN**. `/api/prices/mxn` consulta el oráculo
primero y deja Bitso como respaldo; la respuesta ahora dice de dónde salió cada
precio (`sources`).

| Feed | Mainnet | Testnet |
|---|---|---|
| CEX/DEX (cripto en USD) | `CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN` | `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` |
| Fiat FX (divisas en USD) | `CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC` | `CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W` |

Direcciones de la [tabla oficial de oráculos de Stellar](https://developers.stellar.org/docs/data/oracles/oracle-providers),
validadas como strkey y consultadas en vivo. Ambos feeds: base USD, 14
decimales. El precio en MXN sale de cruzar los dos. Sin credenciales — es
lectura de contrato. Caché de 60 s.

### Verificado en vivo (testnet)

```
GET /api/prices/reflector?codes=XLM,USDC,MXN
mxnPerUsd: 18.4838 | XLM: 0.17660 USD → 3.2643 MXN
assets del feed FX: EUR, GBP, CHF, CAD, MXN, ARS, BRL, THB, XAU
```

---

## 5. Pendientes del punto 4 — decisión antes de código

Estos tres no se implementaron porque no son huecos técnicos: son decisiones de
producto que cambiarían piezas que hoy funcionan.

### Trustless Work (escrow para el adelanto)

El SDK existe (`@trustless-work/escrow`) y necesita API key. Lo que falta no es
el cableado sino el **modelo**: el adelanto de SEYF es un cash-out de rendimiento
futuro al 0%, no un préstamo. Para un escrow hay que definir quién aprueba, quién
libera y quién resuelve disputas — y hoy el adelanto se liquida contra
`advance_sessions` en Supabase. Inventar esos roles sería inventar el producto.

**Decidir:** ¿el escrow retiene el principal de la bóveda, el rendimiento
cedido, o el adelanto hasta el repago?

### SEP-6 / SEP-24 + Anchor Platform

Cambiaría tres rampas a medida que hoy funcionan (Etherfuse, Dynerox, Juno) por
una estándar. Es una migración, no una suma, y arrancarla sin decidirlo rompería
el on-ramp en producción.

**Decidir:** ¿se quiere ser cliente de anclas, o ancla uno mismo? El ángulo
México que vale medir antes: cash-in/cash-out físico sobre USDC, que ningún
neobank mexicano tiene.

### Stellar Disbursement Platform

Condicionado a que haya dispersión de pagos (nómina, remesas, pagos masivos).
Si SEYF no dispersa, no aplica.

---

## Configuración

Ver el bloque *Ecosistema Stellar* en `.env.example`. Mínimo para que las rutas
de datos respondan:

```bash
# Llave que firma challenges (no necesita fondos)
node -e "console.log(require('@stellar/stellar-sdk').Keypair.random().secret())"
# Secreto del JWT de sesión
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
SEP10_SERVER_SECRET=S...
SEYF_AUTH_JWT_SECRET=...
SEP10_HOME_DOMAIN=localhost:3000
```

Opcionales: `STELLAR_SPONSOR_SECRET` (patrocinio), `SOROSWAP_API_KEY`
(agregador). Reflector no necesita nada.

`SEYF_DB_AUTH_MODE=audit` registra los accesos que se habrían rechazado en vez
de rechazarlos. Es para diagnosticar, nunca para producción.
