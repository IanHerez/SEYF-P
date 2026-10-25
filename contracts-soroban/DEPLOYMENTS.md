# Despliegues de `seyf_advance`

## Modelo

El contrato es un escrow: custodia las acciones del vault de DeFindex del
usuario, que siguen rindiendo, y le adelanta en USDC el rendimiento de un plazo.
El USDC sale de una **cuenta de liquidez aparte** (allowance de USDC hacia el
contrato), nunca del vault. Las acciones quedan bloqueadas **hasta que su
rendimiento cubre el adelanto** (`V_now >= V_open + A`). Entonces `settle`, que
cualquiera puede llamar, retira del vault exactamente ese rendimiento hacia la
liquidez y devuelve al usuario su principal completo. El usuario puede salir
antes con `repay`.

## Testnet (25 de octubre de 2026)

Vault: DeFindex USDC de testnet `CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN`
(estrategia "USDC Blend Strategy"). Activo: USDC de Blend testnet, SAC
`CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU`.

Contrato vigente: **`CDG5V5GRD7KYJBREQXRVDEUSJCGCUZSI3EXD5ZHF2WDM7WKZLU5I75XB`**.
Liquidez: `GDCSGJSN7KOXKX3FNH7A6IFHPMHZOOTRIKTS2YQ2XKJW3L3UT46H3C4R`.
Parámetros: `apy_bps` 800, `max_advance_bps` 500, plazo 1–365 días, tope 10 USDC
por usuario y 100 USDC en total, lista de usuarios activa.

### Ciclo verificado contra el vault real

| Paso | Resultado | Transacción |
| --- | --- | --- |
| `open_advance` sin allowance de la liquidez | rechazado con `InsufficientLiquidity` (#11) | simulación |
| Allowance de 10 USDC de la liquidez al contrato | `treasury()` = 10 USDC | [9d1a2e95…](https://stellar.expert/explorer/testnet/tx/9d1a2e954e393a2087a2abc3a66fdc9e8e00348eda1a14f6db9ed5446e93a2ba) |
| `open_advance` (19.9956165 USDC en acciones, 1 día) | adelanto 0.0043826 USDC desde la liquidez | [468aecaf…](https://stellar.expert/explorer/testnet/tx/468aecaf1e79a536ef24c1a17853a40b2be66d6f9c1d752e43f2fc9ffd3bd9b0) |
| `settle` sin rendimiento | rechazado con `YieldNotCovered` (#5); valor 199 956 165 < 199 999 991 | simulación |
| Rendimiento simulado: 0.35 USDC donados al vault | valor de la posición 200 009 012 | [79a874a1…](https://stellar.expert/explorer/testnet/tx/79a874a168489ad646de473684f4b007cd720bb98d4c4353305eb4f273979bc3) |
| `settle` (llamado por un tercero) | retira 43 815 acciones = 0.0043826 USDC a la liquidez; devuelve 199 912 350 acciones, que valen 199 965 185 (más que el principal de 199 956 165) | [d60985c8…](https://stellar.expert/explorer/testnet/tx/d60985c8407fe4127f0fc6031776b4c243824fe946320008c0bf7a9f9bb5c37a) |
| `open_advance` a 30 días | adelanto 0.1314839 USDC | [e9f2dcd5…](https://stellar.expert/explorer/testnet/tx/e9f2dcd5fd2c7aa8f2ef0b6da995b8de5717a4390c225ffb2f0729c9885dc88a) |
| `repay` | devuelve todas las acciones; liquidez de vuelta en 940 USDC exactos | [7ddd35ec…](https://stellar.expert/explorer/testnet/tx/7ddd35eca428f83bc94d49a4a93fcad5ea98eb1d8289f2085c5d81da45c27b02) |

Al cerrar: `outstanding` = 0 y el contrato sin acciones ni USDC.

### Límites de esta prueba

- El vault de testnet tiene todo el saldo ocioso (`invested_amount` = 0), así que
  no genera rendimiento y `withdraw` no tuvo que sacar fondos de Blend. El
  rendimiento se simuló donando USDC al vault (sube el valor de todas sus
  acciones). El rendimiento real y el retiro desde Blend se validan en mainnet.
- Las comisiones en testnet no son representativas: su estado vivo de Soroban
  (4.07 GB) rebasa el objetivo de la red (4.0 GB) y la renta se dispara (un
  despliegue costó ~5 000 XLM). Mainnet está en 1.67 GB de 3.0 GB, con los mismos
  parámetros de comisión.

### Versiones anteriores (reemplazadas)

Primer modelo, con desbloqueo por fecha y tesorería dentro del contrato:
`CCLC3HRPL2GYXTGOFFNKITQGPYLZXQG4TO7OV6M533PGXZ3ZQBOGEGTZ` (normal) y
`CABH4NNGEVFHEJLASJRSULT3YYRK3FYPZDZKTMZMSWPF3JEYQWYALS2Q` (día = 60 s). En el
segundo se verificó `open_advance` → `settle` → `repay` contra el mismo vault
([settle 04962da3…](https://stellar.expert/explorer/testnet/tx/04962da3371adfe529e265e5c5ea9f8f3ff8ab9c109cb62b53a8de46363282ae)).
En el primero queda abierta una posición de prueba de `seyf-tn-user1` que vence
el 26 de octubre a las 13:52 UTC.
