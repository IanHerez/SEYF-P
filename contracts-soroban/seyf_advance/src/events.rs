use soroban_sdk::{contractevent, Address};

use crate::storage::Params;

#[contractevent(topics = ["advance_opened"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdvanceOpened {
    #[topic]
    pub user: Address,
    pub shares: i128,
    pub value: i128,
    pub advance: i128,
    pub matures_at: u64,
}

#[contractevent(topics = ["advance_repaid"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdvanceRepaid {
    #[topic]
    pub user: Address,
    pub advance: i128,
}

#[contractevent(topics = ["advance_settled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdvanceSettled {
    #[topic]
    pub user: Address,
    pub shares_redeemed: i128,
    pub shares_returned: i128,
    pub shortfall: i128,
}

#[contractevent(topics = ["params_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParamsUpdated {
    pub params: Params,
}

#[contractevent(topics = ["paused"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractPaused {
    pub admin: Address,
}

#[contractevent(topics = ["unpaused"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractUnpaused {
    pub admin: Address,
}

#[contractevent(topics = ["allowed_set"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowedSet {
    #[topic]
    pub user: Address,
    pub allowed: bool,
}

#[contractevent(topics = ["treasury_withdrawn"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryWithdrawn {
    pub to: Address,
    pub amount: i128,
}

#[contractevent(topics = ["admin_proposed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminProposed {
    pub current: Address,
    pub proposed: Address,
}

#[contractevent(topics = ["admin_changed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChanged {
    pub previous: Address,
    pub admin: Address,
}
