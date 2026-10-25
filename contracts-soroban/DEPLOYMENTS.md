# Despliegues de `seyf_advance`

## Testnet (25 de octubre de 2026)

Vault: DeFindex USDC de testnet `CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN`
(estrategia "USDC Blend Strategy"). Activo: USDC de Blend testnet, SAC
`CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU`.

Parámetros: `apy_bps` 800, `max_advance_bps` 500, plazo 1–365 días, tope 10 USDC por
usuario y 100 USDC en total, lista de usuarios activa.

| Contrato | Build | Dirección |
| --- | --- | --- |
| Normal (día = 86 400 s) | `stellar contract build` | `CCLC3HRPL2GYXTGOFFNKITQGPYLZXQG4TO7OV6M533PGXZ3ZQBOGEGTZ` |
| Demo (día = 60 s) | `stellar contract build --features fast-time` | `CABH4NNGEVFHEJLASJRSULT3YYRK3FYPZDZKTMZMSWPF3JEYQWYALS2Q` |

### Ciclo verificado contra el vault real

| Paso | Contrato | Resultado | Transacción |
| --- | --- | --- | --- |
| Depósito de 100 USDC en el vault | vault | 1 000 000 000 acciones | [083351d1…](https://stellar.expert/explorer/testnet/tx/083351d14e722948eb18ef55970f9988c6d6517f99cd980b010cea6c58ea0f73) |
| `open_advance` a 1 día | normal | adelanto 0.0219178 USDC; vence 1793022742 (26 oct, 13:52 UTC) | [a302ac75…](https://stellar.expert/explorer/testnet/tx/a302ac75e152caf996e18984e2965b7f04cbe04544d0031d077e607aeacd0eee) |
| `open_advance` a 1 día (60 s) | demo | adelanto 0.0043835 USDC sobre 20 USDC | [acc7c56b…](https://stellar.expert/explorer/testnet/tx/acc7c56be68482ce29cd9f8eec81e42a98dba3953a9006c16a4e7662a427104b) |
| `settle` antes de vencer | demo | rechazado con `NotMatured` (#5) | simulación |
| `settle` al vencer | demo | retira 43 835 acciones, devuelve 199 956 165, faltante 0 | [04962da3…](https://stellar.expert/explorer/testnet/tx/04962da3371adfe529e265e5c5ea9f8f3ff8ab9c109cb62b53a8de46363282ae) |
| `open_advance` a 30 días | demo | adelanto 0.1314780 USDC | [1eb387d6…](https://stellar.expert/explorer/testnet/tx/1eb387d6fa32c90116f5777e1a2fd3fd7e7052e2ea6b00e0be5a048557e93a3a) |
| `repay` | demo | devuelve todas las acciones; `outstanding` = 0 | [593bdf7a…](https://stellar.expert/explorer/testnet/tx/593bdf7a46eda4937fd92ca69dbad576c923a1b14b745da04290596ad29647af) |

Al cerrar el ciclo, la tesorería del contrato demo volvió a 10 USDC exactos y el
contrato quedó sin acciones.

### Límites de esta prueba

- El vault de testnet tenía todo el saldo ocioso (`invested_amount` = 0), así que
  `withdraw` no tuvo que sacar fondos de Blend. Ese camino se valida en mainnet.
- Las comisiones en testnet no son representativas: su estado vivo de Soroban
  (4.07 GB) rebasa el objetivo de la red (4.0 GB) y la renta se dispara. Mainnet
  está en 1.67 GB de 3.0 GB, con los mismos parámetros de comisión.
