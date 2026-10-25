use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Paused = 1,
    NotAllowed = 2,
    PositionExists = 3,
    NoPosition = 4,
    /// El rendimiento de la posición aún no cubre el adelanto.
    YieldNotCovered = 5,
    TermOutOfRange = 6,
    ZeroShares = 7,
    ExceedsLtv = 8,
    ExceedsUserCap = 9,
    ExceedsGlobalCap = 10,
    /// La cuenta de liquidez no tiene saldo o allowance para el adelanto.
    InsufficientLiquidity = 11,
    AdvanceBelowMin = 12,
    // Fuera de la lista de la spec, necesarios para validar entradas.
    InvalidParams = 13,
    InvalidAmount = 14,
    NoPendingAdmin = 15,
    InvalidVaultValue = 16,
    MathOverflow = 17,
}
