//! `seyf_advance`: adelanto del rendimiento de un vault USDC de DeFindex.
//!
//! El contrato custodia las acciones del vault del usuario y le paga hoy,
//! desde una tesorería en USDC, el rendimiento que esas acciones generarán en
//! un plazo. Al vencer retira del vault solo lo necesario para cubrir el
//! adelanto y devuelve el resto. Todo es USDC sobre USDC: sin oráculo ni
//! liquidaciones. Spec: sección 5 del plan de HackMeridian.

#![no_std]

mod error;
mod events;
mod storage;
mod vault;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token::TokenClient, vec, Address, Env};

pub use crate::error::Error;
pub use crate::storage::{Params, Position};
use crate::events::*;
use crate::vault::VaultClient;

const BPS: i128 = 10_000;
const DAYS_PER_YEAR: i128 = 365;
#[cfg(not(feature = "fast-time"))]
const SECONDS_PER_DAY: u64 = 86_400;
/// Solo para demos en testnet: un "día" de plazo dura 60 s para poder mostrar
/// `settle` dentro del hackathon. El adelanto se calcula igual. Nunca en mainnet.
#[cfg(feature = "fast-time")]
const SECONDS_PER_DAY: u64 = 60;

#[contract]
pub struct SeyfAdvance;

#[contractimpl]
impl SeyfAdvance {
    pub fn __constructor(
        e: Env,
        admin: Address,
        vault: Address,
        asset: Address,
        params: Params,
    ) -> Result<(), Error> {
        storage::set_params(&e, &params)?;
        storage::set_admin(&e, &admin);
        e.storage().instance().set(&storage::DataKey::Vault, &vault);
        e.storage().instance().set(&storage::DataKey::Asset, &asset);
        storage::set_paused(&e, false);
        storage::set_outstanding(&e, 0);
        storage::bump_instance(&e);
        Ok(())
    }

    // ---------------------------------------------------------------- usuario

    /// Valor de `shares` en el vault y adelanto para `term_days`, con todos
    /// los topes aplicados. Falla con el mismo error que fallaría `open_advance`.
    pub fn quote(e: Env, shares: i128, term_days: u32) -> Result<(i128, i128), Error> {
        Self::compute_advance(&e, shares, term_days)
    }

    /// Bloquea `shares` del vault en el contrato y paga el adelanto en USDC.
    pub fn open_advance(
        e: Env,
        user: Address,
        shares: i128,
        term_days: u32,
        min_advance: i128,
    ) -> Result<i128, Error> {
        user.require_auth();
        storage::bump_instance(&e);

        if storage::is_paused(&e) {
            return Err(Error::Paused);
        }
        if storage::params(&e).allowlist_on && !storage::is_allowed(&e, &user) {
            return Err(Error::NotAllowed);
        }
        if storage::position(&e, &user).is_some() {
            return Err(Error::PositionExists);
        }

        let (value, advance) = Self::compute_advance(&e, shares, term_days)?;
        if advance <= 0 || advance < min_advance {
            return Err(Error::AdvanceBelowMin);
        }

        let asset = TokenClient::new(&e, &storage::asset(&e));
        let this = e.current_contract_address();
        if asset.balance(&this) < advance {
            return Err(Error::InsufficientTreasury);
        }

        let now = e.ledger().timestamp();
        let matures_at = (term_days as u64)
            .checked_mul(SECONDS_PER_DAY)
            .and_then(|t| now.checked_add(t))
            .ok_or(Error::MathOverflow)?;

        // Efectos antes de las transferencias.
        let outstanding = storage::outstanding(&e)
            .checked_add(advance)
            .ok_or(Error::MathOverflow)?;
        storage::set_outstanding(&e, outstanding);
        storage::set_position(
            &e,
            &user,
            &Position {
                shares,
                value_at_open: value,
                advance,
                opened_at: now,
                matures_at,
            },
        );

        VaultClient::new(&e, &storage::vault(&e)).transfer(&user, &this, &shares);
        asset.transfer(&this, &user, &advance);

        AdvanceOpened {
            user,
            shares,
            value,
            advance,
            matures_at,
        }
        .publish(&e);
        Ok(advance)
    }

    /// Devuelve el adelanto en USDC y recupera todas las acciones.
    pub fn repay(e: Env, user: Address) -> Result<(), Error> {
        user.require_auth();
        storage::bump_instance(&e);

        if storage::is_paused(&e) {
            return Err(Error::Paused);
        }
        let position = storage::position(&e, &user).ok_or(Error::NoPosition)?;
        Self::close_position(&e, &user, position.advance)?;

        let this = e.current_contract_address();
        TokenClient::new(&e, &storage::asset(&e)).transfer(&user, &this, &position.advance);
        VaultClient::new(&e, &storage::vault(&e)).transfer(&this, &user, &position.shares);

        AdvanceRepaid {
            user,
            advance: position.advance,
        }
        .publish(&e);
        Ok(())
    }

    /// Cierra una posición vencida. Cualquiera puede llamarla, también en pausa.
    ///
    /// Retira del vault las acciones que cubren el adelanto al valor actual y
    /// devuelve el resto al usuario. Si el vault vale menos que el adelanto,
    /// retira todo y el faltante queda en el evento.
    pub fn settle(e: Env, user: Address) -> Result<(), Error> {
        storage::bump_instance(&e);

        let position = storage::position(&e, &user).ok_or(Error::NoPosition)?;
        if e.ledger().timestamp() < position.matures_at {
            return Err(Error::NotMatured);
        }
        Self::close_position(&e, &user, position.advance)?;

        let vault = VaultClient::new(&e, &storage::vault(&e));
        let shares = position.shares;
        let advance = position.advance;
        let value_now = Self::vault_value(&vault, shares)?;

        // s_redeem = min(s, ceil(A * s / V_now)), a favor del protocolo.
        let shares_redeemed = if value_now <= advance {
            shares
        } else {
            mul_div_ceil(advance, shares, value_now)?.min(shares)
        };
        // En un retiro parcial se exige al menos A; en uno total no hay nada
        // que proteger porque todas las acciones salen.
        let min_out = if shares_redeemed < shares { advance } else { 0 };

        let this = e.current_contract_address();
        let received = vault
            .withdraw(&shares_redeemed, &vec![&e, min_out], &this)
            .get(0)
            .ok_or(Error::InvalidVaultValue)?;

        let shares_returned = shares - shares_redeemed;
        if shares_returned > 0 {
            vault.transfer(&this, &user, &shares_returned);
        }
        let shortfall = if received < advance { advance - received } else { 0 };

        AdvanceSettled {
            user,
            shares_redeemed,
            shares_returned,
            shortfall,
        }
        .publish(&e);
        Ok(())
    }

    // ------------------------------------------------------------------ admin

    /// Retira USDC libre de la tesorería hacia el admin.
    pub fn withdraw_treasury(e: Env, amount: i128) -> Result<(), Error> {
        let admin = Self::require_admin(&e);
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let asset = TokenClient::new(&e, &storage::asset(&e));
        let this = e.current_contract_address();
        if asset.balance(&this) < amount {
            return Err(Error::InsufficientTreasury);
        }
        asset.transfer(&this, &admin, &amount);
        TreasuryWithdrawn { to: admin, amount }.publish(&e);
        Ok(())
    }

    pub fn set_params(e: Env, params: Params) -> Result<(), Error> {
        Self::require_admin(&e);
        storage::set_params(&e, &params)?;
        ParamsUpdated { params }.publish(&e);
        Ok(())
    }

    pub fn pause(e: Env) {
        let admin = Self::require_admin(&e);
        storage::set_paused(&e, true);
        ContractPaused { admin }.publish(&e);
    }

    pub fn unpause(e: Env) {
        let admin = Self::require_admin(&e);
        storage::set_paused(&e, false);
        ContractUnpaused { admin }.publish(&e);
    }

    pub fn set_allowed(e: Env, user: Address, allowed: bool) {
        Self::require_admin(&e);
        storage::set_allowed(&e, &user, allowed);
        AllowedSet { user, allowed }.publish(&e);
    }

    /// Primer paso del cambio de admin: el admin actual propone al nuevo.
    pub fn propose_admin(e: Env, new_admin: Address) {
        let current = Self::require_admin(&e);
        storage::set_pending_admin(&e, &new_admin);
        AdminProposed {
            current,
            proposed: new_admin,
        }
        .publish(&e);
    }

    /// Segundo paso: el admin propuesto acepta con su firma.
    pub fn accept_admin(e: Env) -> Result<(), Error> {
        storage::bump_instance(&e);
        let pending = storage::pending_admin(&e).ok_or(Error::NoPendingAdmin)?;
        pending.require_auth();
        let previous = storage::admin(&e);
        storage::set_admin(&e, &pending);
        storage::clear_pending_admin(&e);
        AdminChanged {
            previous,
            admin: pending,
        }
        .publish(&e);
        Ok(())
    }

    // ---------------------------------------------------------------- lectura

    pub fn position(e: Env, user: Address) -> Option<Position> {
        storage::position(&e, &user)
    }

    pub fn outstanding(e: Env) -> i128 {
        storage::outstanding(&e)
    }

    /// Saldo USDC del contrato disponible para pagar adelantos.
    pub fn treasury(e: Env) -> i128 {
        TokenClient::new(&e, &storage::asset(&e)).balance(&e.current_contract_address())
    }

    pub fn params(e: Env) -> Params {
        storage::params(&e)
    }

    pub fn is_paused(e: Env) -> bool {
        storage::is_paused(&e)
    }

    pub fn is_allowed(e: Env, user: Address) -> bool {
        storage::is_allowed(&e, &user)
    }

    pub fn admin(e: Env) -> Address {
        storage::admin(&e)
    }

    pub fn vault(e: Env) -> Address {
        storage::vault(&e)
    }

    pub fn asset(e: Env) -> Address {
        storage::asset(&e)
    }
}

impl SeyfAdvance {
    fn require_admin(e: &Env) -> Address {
        let admin = storage::admin(e);
        admin.require_auth();
        storage::bump_instance(e);
        admin
    }

    /// Borra la posición y descuenta su adelanto de `Outstanding`.
    fn close_position(e: &Env, user: &Address, advance: i128) -> Result<(), Error> {
        let outstanding = storage::outstanding(e)
            .checked_sub(advance)
            .ok_or(Error::MathOverflow)?;
        storage::set_outstanding(e, outstanding);
        storage::remove_position(e, user);
        Ok(())
    }

    /// V = vault.get_asset_amounts_per_shares(s)[0]. El vault es de un solo activo.
    fn vault_value(vault: &VaultClient, shares: i128) -> Result<i128, Error> {
        let amounts = vault.get_asset_amounts_per_shares(&shares);
        if amounts.len() != 1 {
            return Err(Error::InvalidVaultValue);
        }
        let value = amounts.get(0).ok_or(Error::InvalidVaultValue)?;
        if value < 0 {
            return Err(Error::InvalidVaultValue);
        }
        Ok(value)
    }

    fn compute_advance(e: &Env, shares: i128, term_days: u32) -> Result<(i128, i128), Error> {
        if shares <= 0 {
            return Err(Error::ZeroShares);
        }
        let params = storage::params(e);
        if term_days < params.min_term_days || term_days > params.max_term_days {
            return Err(Error::TermOutOfRange);
        }

        let vault = VaultClient::new(e, &storage::vault(e));
        let value = Self::vault_value(&vault, shares)?;

        // A = floor(V * apy_bps * d / (10_000 * 365)), redondeo a favor del protocolo.
        let rate = (params.apy_bps as i128)
            .checked_mul(term_days as i128)
            .ok_or(Error::MathOverflow)?;
        let advance = mul_div_floor(value, rate, BPS * DAYS_PER_YEAR)?;

        let ltv_cap = mul_div_floor(value, params.max_advance_bps as i128, BPS)?;
        if advance > ltv_cap {
            return Err(Error::ExceedsLtv);
        }
        if advance > params.per_user_cap {
            return Err(Error::ExceedsUserCap);
        }
        let outstanding = storage::outstanding(e)
            .checked_add(advance)
            .ok_or(Error::MathOverflow)?;
        if outstanding > params.global_cap {
            return Err(Error::ExceedsGlobalCap);
        }
        Ok((value, advance))
    }
}

fn mul_div_floor(a: i128, b: i128, c: i128) -> Result<i128, Error> {
    a.checked_mul(b)
        .and_then(|n| n.checked_div(c))
        .ok_or(Error::MathOverflow)
}

/// ceil(a * b / c) para a, b >= 0 y c > 0.
fn mul_div_ceil(a: i128, b: i128, c: i128) -> Result<i128, Error> {
    let n = a.checked_mul(b).ok_or(Error::MathOverflow)?;
    let q = n.checked_div(c).ok_or(Error::MathOverflow)?;
    if n % c == 0 {
        Ok(q)
    } else {
        q.checked_add(1).ok_or(Error::MathOverflow)
    }
}
