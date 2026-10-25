//! Subconjunto del vault de DeFindex que usa este contrato.
//!
//! Firmas tomadas de `paltalabs/defindex`, `apps/contracts/vault/src/lib.rs`
//! y `token/contract.rs`. Las acciones del vault son su propio token SEP-41.
//! `withdraw` quema las acciones de `from` y le transfiere los activos.

use soroban_sdk::{contractclient, Address, Env, Vec};

#[allow(dead_code)]
#[contractclient(name = "VaultClient")]
pub trait VaultInterface {
    fn get_asset_amounts_per_shares(e: Env, vault_shares: i128) -> Vec<i128>;
    fn withdraw(e: Env, withdraw_shares: i128, min_amounts_out: Vec<i128>, from: Address)
        -> Vec<i128>;
    fn transfer(e: Env, from: Address, to: Address, amount: i128);
    fn balance(e: Env, id: Address) -> i128;
}
