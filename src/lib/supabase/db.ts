import { getSupabase } from "./server";

// Funciones de datos (server-side). Devuelven formas listas para el cliente.
// Cada escritura asegura primero que exista el perfil (FK).

export interface ProfileInput {
  wallet: string;
  embedded?: string | null;
  email?: string | null;
  did?: string | null;
  riskProfile?: string | null;
  fullName?: string | null;
  phone?: string | null;
}

export interface ProfileRow {
  wallet_address: string;
  embedded_wallet_address: string | null;
  email: string | null;
  privy_did: string | null;
  risk_profile: string | null;
  full_name: string | null;
  phone: string | null;
}

export async function getProfile(wallet: string): Promise<ProfileRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("profiles")
    .select("wallet_address, embedded_wallet_address, email, privy_did, risk_profile, full_name, phone")
    .eq("wallet_address", wallet)
    .maybeSingle();
  return (data as ProfileRow) ?? null;
}

export async function upsertProfile(p: ProfileInput) {
  const sb = getSupabase();
  if (!sb) return;
  // Solo incluye campos explícitamente pasados para no sobreescribir con null.
  const patch: Record<string, unknown> = {
    wallet_address: p.wallet,
    updated_at: new Date().toISOString(),
  };
  if (p.embedded !== undefined) patch.embedded_wallet_address = p.embedded ?? null;
  if (p.email !== undefined) patch.email = p.email ?? null;
  if (p.did !== undefined) patch.privy_did = p.did ?? null;
  if (p.riskProfile !== undefined) patch.risk_profile = p.riskProfile ?? null;
  if (p.fullName !== undefined) patch.full_name = p.fullName ?? null;
  if (p.phone !== undefined) patch.phone = p.phone ?? null;

  await sb.from("profiles").upsert(patch, { onConflict: "wallet_address" });
}

async function ensureProfile(wallet: string) {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from("profiles")
    .upsert({ wallet_address: wallet }, { onConflict: "wallet_address", ignoreDuplicates: true });
}

// ---------- CLABE de depósito ----------
export async function getClabe(wallet: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("deposit_clabes")
    .select("clabe")
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.clabe ?? null;
}

export async function addClabe(wallet: string, clabe: string, type = "AUTO_PAYMENT") {
  const sb = getSupabase();
  if (!sb) return;
  await ensureProfile(wallet);
  await sb.from("deposit_clabes").upsert({ clabe, wallet_address: wallet, type }, { onConflict: "clabe" });
}

// ---------- Cuentas bancarias (retiro) ----------
export interface BankRow {
  id: string;
  tag: string;
  clabe: string;
  recipient_legal_name: string;
}

export async function listBanks(wallet: string): Promise<BankRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("bank_accounts")
    .select("id, tag, clabe, recipient_legal_name")
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: true });
  return (data as BankRow[]) ?? [];
}

export async function addBank(wallet: string, b: BankRow) {
  const sb = getSupabase();
  if (!sb) return;
  await ensureProfile(wallet);
  await sb.from("bank_accounts").upsert(
    {
      id: b.id,
      wallet_address: wallet,
      tag: b.tag,
      clabe: b.clabe,
      recipient_legal_name: b.recipient_legal_name,
      ownership: "THIRD_PARTY",
    },
    { onConflict: "id" },
  );
}

export async function removeBank(wallet: string, id: string) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("bank_accounts").delete().eq("wallet_address", wallet).eq("id", id);
}

// ---------- Bóvedas ----------
export interface VaultRow {
  id: string;
  nm: string;
  goal: number;
  bal: number;
  apy: number;
  color: string;
  createdAt: number;
  /** Riel Stellar: plan DeFindex (conservador→CETES, moderado→USDC, balanceado→XLM). */
  planId?: string;
  /** Riel Stellar: id corto de estrategia (cetes | usdc | xlm). */
  strategyId?: string;
  /** Último guardado del saldo: ancla del "money timer" al recargar. */
  updatedAt?: number;
}

export async function listVaults(wallet: string): Promise<VaultRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("vaults")
    .select("id, name, goal, balance, apy, color, created_at, plan_id, strategy_id, updated_at")
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: true });
  return (
    (data ?? []).map((v) => ({
      id: v.id,
      nm: v.name,
      goal: Number(v.goal),
      bal: Number(v.balance),
      apy: Number(v.apy),
      color: v.color,
      createdAt: new Date(v.created_at).getTime(),
      planId: v.plan_id ?? undefined,
      strategyId: v.strategy_id ?? undefined,
      updatedAt: v.updated_at ? new Date(v.updated_at).getTime() : undefined,
    })) ?? []
  );
}

export async function upsertVault(wallet: string, v: VaultRow) {
  const sb = getSupabase();
  if (!sb) return;
  await ensureProfile(wallet);
  const updatedAt =
    v.updatedAt != null && Number.isFinite(v.updatedAt)
      ? new Date(v.updatedAt).toISOString()
      : new Date().toISOString();
  await sb.from("vaults").upsert(
    {
      id: v.id,
      wallet_address: wallet,
      name: v.nm,
      goal: v.goal,
      balance: v.bal,
      apy: v.apy,
      color: v.color,
      plan_id: v.planId ?? null,
      strategy_id: v.strategyId ?? null,
      updated_at: updatedAt,
    },
    { onConflict: "id" },
  );
}

/** Actualiza saldo (y opcionalmente APY) tras abono/retiro on-chain. Reancla el money timer. */
export async function patchVaultBalance(
  wallet: string,
  vaultId: string,
  balance: number,
  apy?: number,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const patch: Record<string, unknown> = {
    balance,
    updated_at: new Date().toISOString(),
  };
  if (apy != null && Number.isFinite(apy)) patch.apy = apy;
  await sb.from("vaults").update(patch).eq("id", vaultId).eq("wallet_address", wallet);
}

export async function deleteVault(wallet: string, id: string) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("vaults").delete().eq("wallet_address", wallet).eq("id", id);
}

// ---------- KYC (estado de verificación Etherfuse) ----------
export interface KycStateRow {
  customer_id: string;
  wallet_public_key: string;
  status: string;
  approved_at: string | null;
  current_rejection_reason: string | null;
  last_event_id: string | null;
  updated_at: string;
}

const KYC_COLS =
  "customer_id, wallet_public_key, status, approved_at, current_rejection_reason, last_event_id, updated_at";

export async function getKycState(
  customerId: string,
  walletPublicKey: string,
): Promise<KycStateRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("kyc_state")
    .select(KYC_COLS)
    .eq("customer_id", customerId)
    .eq("wallet_public_key", walletPublicKey)
    .maybeSingle();
  return (data as KycStateRow) ?? null;
}

export async function upsertKycState(row: KycStateRow) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("kyc_state").upsert(row, { onConflict: "customer_id,wallet_public_key" });
}

export async function listKycStates(limit = 200): Promise<KycStateRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("kyc_state")
    .select(KYC_COLS)
    .order("updated_at", { ascending: false })
    .limit(limit);
  return (data as KycStateRow[]) ?? [];
}

// ---------- Sesión de onboarding Etherfuse (wallet Stellar → customer) ----------
export interface OnboardingSessionRow {
  wallet_public_key: string;
  customer_id: string;
  bank_account_id: string;
  updated_at: string;
}

export async function getOnboardingSession(
  walletPublicKey: string,
): Promise<OnboardingSessionRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("onboarding_sessions")
    .select("wallet_public_key, customer_id, bank_account_id, updated_at")
    .eq("wallet_public_key", walletPublicKey)
    .maybeSingle();
  return (data as OnboardingSessionRow) ?? null;
}

export async function upsertOnboardingSession(row: {
  walletPublicKey: string;
  customerId: string;
  bankAccountId: string;
}) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("onboarding_sessions").upsert(
    {
      wallet_public_key: row.walletPublicKey,
      customer_id: row.customerId,
      bank_account_id: row.bankAccountId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "wallet_public_key" },
  );
}

export async function deleteOnboardingSession(walletPublicKey: string) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("onboarding_sessions").delete().eq("wallet_public_key", walletPublicKey);
}

// ---------- Acuerdos del KYC ----------
export async function getKycAgreements(
  customerId: string,
  walletPublicKey: string,
): Promise<{ accepted: boolean; acceptedAt: string | null } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("kyc_agreements")
    .select("accepted, accepted_at")
    .eq("customer_id", customerId)
    .eq("wallet_public_key", walletPublicKey)
    .maybeSingle();
  if (!data) return null;
  return { accepted: Boolean(data.accepted), acceptedAt: data.accepted_at ?? null };
}

export async function upsertKycAgreementsAccepted(params: {
  customerId: string;
  walletPublicKey: string;
  acceptedAt?: string | null;
}) {
  const sb = getSupabase();
  if (!sb) return;
  const now = new Date().toISOString();
  await sb.from("kyc_agreements").upsert(
    {
      customer_id: params.customerId,
      wallet_public_key: params.walletPublicKey,
      accepted: true,
      accepted_at: params.acceptedAt ?? now,
      updated_at: now,
    },
    { onConflict: "customer_id,wallet_public_key" },
  );
}

// ---------- Bono de bienvenida ----------
export async function getBonusClaimed(wallet: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { data } = await sb
    .from("bonus_claims")
    .select("wallet_address")
    .eq("wallet_address", wallet)
    .maybeSingle();
  return Boolean(data);
}

export async function setBonusClaimed(wallet: string, amount: number, txId?: string) {
  const sb = getSupabase();
  if (!sb) return;
  await ensureProfile(wallet);
  await sb
    .from("bonus_claims")
    .upsert({ wallet_address: wallet, amount, tx_id: txId ?? null }, { onConflict: "wallet_address" });
}

// ---------- Conversiones de divisas (FX vía Bitso) ----------
export interface ConversionRow {
  id: string;
  from: string;
  to: string;
  amountFrom: number;
  amountTo: number;
  oid?: string;
  createdAt: number;
}

export async function listConversions(wallet: string): Promise<ConversionRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("conversions")
    .select("id, from_code, to_code, amount_from, amount_to, oid, created_at")
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: false });
  return (data ?? []).map((c) => ({
    id: c.id,
    from: c.from_code,
    to: c.to_code,
    amountFrom: Number(c.amount_from),
    amountTo: Number(c.amount_to),
    oid: c.oid ?? undefined,
    createdAt: new Date(c.created_at).getTime(),
  }));
}

export async function addConversion(wallet: string, c: ConversionRow) {
  const sb = getSupabase();
  if (!sb) return;
  await ensureProfile(wallet);
  await sb.from("conversions").upsert(
    {
      id: c.id,
      wallet_address: wallet,
      from_code: c.from,
      to_code: c.to,
      amount_from: c.amountFrom,
      amount_to: c.amountTo,
      oid: c.oid ?? null,
      created_at: new Date(c.createdAt).toISOString(),
    },
    { onConflict: "id" },
  );
}

// ---------- Conversión orquestada: idempotencia + reconciliación ----------

export interface ConversionRecord extends ConversionRow {
  status: "pending" | "completed";
  kind?: "forward" | "inverse";
}

export async function getConversion(id: string): Promise<ConversionRecord | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("conversions")
    .select("id, from_code, to_code, amount_from, amount_to, oid, status, kind, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    from: data.from_code,
    to: data.to_code,
    amountFrom: Number(data.amount_from),
    amountTo: Number(data.amount_to),
    oid: data.oid ?? undefined,
    status: data.status,
    kind: data.kind ?? undefined,
    createdAt: new Date(data.created_at).getTime(),
  };
}

// Reserva la fila idempotente. Devuelve la existente si la `id` ya se usó (un
// reintento NO coloca otra orden); si no, inserta una fila 'pending'.
export async function beginConversion(
  wallet: string,
  c: { id: string; from: string; to: string; kind: "forward" | "inverse" },
): Promise<{ created: boolean; existing?: ConversionRecord }> {
  const sb = getSupabase();
  if (!sb) return { created: true }; // sin DB: el cliente lleva el ledger local
  await ensureProfile(wallet);
  const existing = await getConversion(c.id);
  if (existing) return { created: false, existing };
  const { error } = await sb.from("conversions").insert({
    id: c.id,
    wallet_address: wallet,
    from_code: c.from,
    to_code: c.to,
    amount_from: 0,
    amount_to: 0,
    status: "pending",
    kind: c.kind,
  });
  // Carrera: otro request insertó la misma `id` entre el select y el insert.
  if (error) {
    const again = await getConversion(c.id);
    if (again) return { created: false, existing: again };
    throw error;
  }
  return { created: true };
}

export async function completeConversion(
  id: string,
  d: { amountFrom: number; amountTo: number; oid?: string },
) {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from("conversions")
    .update({ amount_from: d.amountFrom, amount_to: d.amountTo, oid: d.oid ?? null, status: "completed" })
    .eq("id", id);
}

// Libera la reserva si la orden falló (para no dejar filas pending colgadas).
export async function abortConversion(id: string) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("conversions").delete().eq("id", id).eq("status", "pending");
}

// Agregado del ledger por activo (todos los usuarios, solo filas liquidadas):
// suma el destino y resta el origen de cada conversión no-MXN. Es el lado
// "ledger" del invariante de reconciliación vs el pool real de Bitso.
export async function sumLedgerByAsset(): Promise<Record<string, number>> {
  const sb = getSupabase();
  if (!sb) return {};
  const acc: Record<string, number> = {};
  const { data } = await sb
    .from("conversions")
    .select("from_code, to_code, amount_from, amount_to")
    .eq("status", "completed");
  for (const c of data ?? []) {
    if (c.to_code !== "MXN") acc[c.to_code] = (acc[c.to_code] || 0) + Number(c.amount_to);
    if (c.from_code !== "MXN") acc[c.from_code] = (acc[c.from_code] || 0) - Number(c.amount_from);
  }
  return acc;
}

// ---------- Depósitos SPEI ----------

/** Devuelve la wallet asociada a una CLABE de depósito, o null si no existe. */
export async function getWalletByClabe(clabe: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("deposit_clabes")
    .select("wallet_address")
    .eq("clabe", clabe)
    .maybeSingle();
  return data?.wallet_address ?? null;
}

/** Registra un movimiento en el ledger de transacciones. */
export async function addTransaction(
  wallet: string,
  tx: { kind: string; amount: number; status: string; tx_hash?: string },
) {
  const sb = getSupabase();
  if (!sb) return;
  await ensureProfile(wallet);
  await sb.from("transactions").insert({
    wallet_address: wallet,
    kind: tx.kind,
    amount: tx.amount,
    status: tx.status,
    tx_hash: tx.tx_hash ?? null,
  });
}

// ---------- Límites mensuales (depósito / retiro) ----------
export interface MonthlyUsage {
  deposit: number;
  withdraw: number;
}

export async function getMonthlyUsage(wallet: string, period: string): Promise<MonthlyUsage> {
  const sb = getSupabase();
  if (!sb) return { deposit: 0, withdraw: 0 };
  const { data } = await sb
    .from("monthly_limits")
    .select("deposit, withdraw")
    .eq("wallet_address", wallet)
    .eq("period", period)
    .maybeSingle();
  return { deposit: Number(data?.deposit ?? 0), withdraw: Number(data?.withdraw ?? 0) };
}

// ---------- Rate limits (reemplaza Redis) ----------
export async function bumpRateLimitBucket(
  bucketKey: string,
  windowSec: number,
): Promise<{ hits: number; expiresAt: string }> {
  const sb = getSupabase();
  const now = Date.now();
  const expiresAt = new Date(now + windowSec * 1000).toISOString();
  if (!sb) return { hits: 1, expiresAt };

  const { data: row } = await sb
    .from("rate_limit_buckets")
    .select("hits, expires_at")
    .eq("bucket_key", bucketKey)
    .maybeSingle();

  if (!row || new Date(row.expires_at).getTime() <= now) {
    await sb.from("rate_limit_buckets").upsert(
      { bucket_key: bucketKey, hits: 1, expires_at: expiresAt },
      { onConflict: "bucket_key" },
    );
    return { hits: 1, expiresAt };
  }

  const hits = Number(row.hits) + 1;
  await sb.from("rate_limit_buckets").update({ hits }).eq("bucket_key", bucketKey);
  return { hits, expiresAt: row.expires_at };
}

// ---------- Adelantos de liquidez ----------
export async function getAdvanceSessionRow(customerId: string): Promise<Record<string, unknown> | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("advance_sessions")
    .select("payload")
    .eq("customer_id", customerId)
    .maybeSingle();
  return (data?.payload as Record<string, unknown>) ?? null;
}

export async function upsertAdvanceSessionRow(customerId: string, payload: Record<string, unknown>) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("advance_sessions").upsert(
    { customer_id: customerId, payload, updated_at: new Date().toISOString() },
    { onConflict: "customer_id" },
  );
}

export async function deleteAdvanceSessionRow(customerId: string) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("advance_sessions").delete().eq("customer_id", customerId);
}

// ---------- Lock onramp ----------
export async function tryAcquireOnrampLock(customerId: string, ttlSec: number): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return true;
  const now = Date.now();
  const expiresAt = new Date(now + ttlSec * 1000).toISOString();
  const { data: row } = await sb
    .from("onramp_locks")
    .select("expires_at")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (row && new Date(row.expires_at).getTime() > now) return false;
  await sb.from("onramp_locks").upsert(
    { customer_id: customerId, expires_at: expiresAt },
    { onConflict: "customer_id" },
  );
  return true;
}

export async function releaseOnrampLockRow(customerId: string) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("onramp_locks").delete().eq("customer_id", customerId);
}

export async function addMonthlyUsage(
  wallet: string,
  period: string,
  kind: "deposit" | "withdraw",
  amount: number,
) {
  const sb = getSupabase();
  if (!sb) return;
  await ensureProfile(wallet);
  const cur = await getMonthlyUsage(wallet, period);
  const next = { deposit: cur.deposit, withdraw: cur.withdraw, [kind]: cur[kind] + amount };
  await sb.from("monthly_limits").upsert(
    { wallet_address: wallet, period, deposit: next.deposit, withdraw: next.withdraw, updated_at: new Date().toISOString() },
    { onConflict: "wallet_address,period" },
  );
}

