use soroban_sdk::{contracttype, Address, Env};

use crate::error::Error;

/// ~1 día de ledgers (5 s por ledger).
pub const DAY_IN_LEDGERS: u32 = 17_280;
const INSTANCE_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_IN_LEDGERS;
const PERSISTENT_BUMP: u32 = 180 * DAY_IN_LEDGERS;
const PERSISTENT_THRESHOLD: u32 = 60 * DAY_IN_LEDGERS;

/// Parámetros que el admin puede ajustar (sección 5.1 de la spec).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Params {
    /// APY que se adelanta, en puntos base.
    pub apy_bps: u32,
    /// Tope del adelanto sobre el valor de la posición, en puntos base.
    pub max_advance_bps: u32,
    pub min_term_days: u32,
    pub max_term_days: u32,
    /// Tope de adelanto por usuario, en unidades mínimas del activo.
    pub per_user_cap: i128,
    /// Tope de adelantos vivos en total, en unidades mínimas del activo.
    pub global_cap: i128,
    /// Si es `true`, solo los usuarios aprobados pueden abrir.
    pub allowlist_on: bool,
}

/// Posición activa de un usuario (sección 5.2). Una por usuario.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Position {
    pub shares: i128,
    pub value_at_open: i128,
    pub advance: i128,
    pub opened_at: u64,
    /// Fecha estimada en que el rendimiento cubre el adelanto (al APY de
    /// `params`). Solo informativa: el desbloqueo depende del valor real.
    pub expected_unlock_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // Instance: configuración compartida y contadores de tamaño fijo.
    Admin,
    PendingAdmin,
    Vault,
    Asset,
    Liquidity,
    Params,
    Paused,
    Outstanding,
    // Persistent: un registro por usuario.
    Position(Address),
    Allowed(Address),
}

pub fn bump_instance(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
}

fn bump_persistent(e: &Env, key: &DataKey) {
    let extend_to = PERSISTENT_BUMP.min(e.storage().max_ttl());
    let threshold = PERSISTENT_THRESHOLD.min(extend_to);
    e.storage().persistent().extend_ttl(key, threshold, extend_to);
}

pub fn admin(e: &Env) -> Address {
    e.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_admin(e: &Env, admin: &Address) {
    e.storage().instance().set(&DataKey::Admin, admin);
}

pub fn pending_admin(e: &Env) -> Option<Address> {
    e.storage().instance().get(&DataKey::PendingAdmin)
}

pub fn set_pending_admin(e: &Env, admin: &Address) {
    e.storage().instance().set(&DataKey::PendingAdmin, admin);
}

pub fn clear_pending_admin(e: &Env) {
    e.storage().instance().remove(&DataKey::PendingAdmin);
}

pub fn vault(e: &Env) -> Address {
    e.storage().instance().get(&DataKey::Vault).unwrap()
}

pub fn asset(e: &Env) -> Address {
    e.storage().instance().get(&DataKey::Asset).unwrap()
}

/// Cuenta o contrato de la que salen los adelantos (vía allowance) y a la que
/// vuelven los repagos y lo recuperado del vault.
pub fn liquidity(e: &Env) -> Address {
    e.storage().instance().get(&DataKey::Liquidity).unwrap()
}

pub fn set_liquidity(e: &Env, liquidity: &Address) {
    e.storage().instance().set(&DataKey::Liquidity, liquidity);
}

pub fn params(e: &Env) -> Params {
    e.storage().instance().get(&DataKey::Params).unwrap()
}

pub fn set_params(e: &Env, params: &Params) -> Result<(), Error> {
    validate_params(params)?;
    e.storage().instance().set(&DataKey::Params, params);
    Ok(())
}

fn validate_params(p: &Params) -> Result<(), Error> {
    let bps_ok = p.apy_bps <= 10_000 && p.max_advance_bps > 0 && p.max_advance_bps <= 10_000;
    let terms_ok = p.min_term_days > 0 && p.min_term_days <= p.max_term_days;
    let caps_ok = p.per_user_cap > 0 && p.global_cap >= p.per_user_cap;
    if bps_ok && terms_ok && caps_ok {
        Ok(())
    } else {
        Err(Error::InvalidParams)
    }
}

pub fn is_paused(e: &Env) -> bool {
    e.storage().instance().get(&DataKey::Paused).unwrap_or(false)
}

pub fn set_paused(e: &Env, paused: bool) {
    e.storage().instance().set(&DataKey::Paused, &paused);
}

pub fn outstanding(e: &Env) -> i128 {
    e.storage().instance().get(&DataKey::Outstanding).unwrap_or(0)
}

pub fn set_outstanding(e: &Env, amount: i128) {
    e.storage().instance().set(&DataKey::Outstanding, &amount);
}

pub fn position(e: &Env, user: &Address) -> Option<Position> {
    let key = DataKey::Position(user.clone());
    let position = e.storage().persistent().get(&key);
    if position.is_some() {
        bump_persistent(e, &key);
    }
    position
}

pub fn set_position(e: &Env, user: &Address, position: &Position) {
    let key = DataKey::Position(user.clone());
    e.storage().persistent().set(&key, position);
    bump_persistent(e, &key);
}

pub fn remove_position(e: &Env, user: &Address) {
    e.storage()
        .persistent()
        .remove(&DataKey::Position(user.clone()));
}

pub fn is_allowed(e: &Env, user: &Address) -> bool {
    let key = DataKey::Allowed(user.clone());
    let allowed = e.storage().persistent().get(&key).unwrap_or(false);
    if allowed {
        bump_persistent(e, &key);
    }
    allowed
}

pub fn set_allowed(e: &Env, user: &Address, allowed: bool) {
    let key = DataKey::Allowed(user.clone());
    if allowed {
        e.storage().persistent().set(&key, &true);
        bump_persistent(e, &key);
    } else {
        e.storage().persistent().remove(&key);
    }
}
