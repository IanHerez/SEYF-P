"use client";

// Capa de almacenamiento del cliente. Si NEXT_PUBLIC_USE_SUPABASE === "true"
// usa los route handlers /api/db/* (Supabase, persistente); si no, cae a
// localStorage (modo demo, no se conserva al limpiar cookies).

import { awaitSeyfAuthAccount, seyfAuthHeaders } from "@/lib/stellar/auth-token";

const USE_DB = process.env.NEXT_PUBLIC_USE_SUPABASE === "true";

export interface StoreVault {
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
  /** Último guardado del saldo (ms). Ancla del "money timer" al recargar. */
  updatedAt?: number;
}
export interface StoreBank {
  id: string;
  tag: string;
  clabe: string;
  recipient_legal_name: string;
}
export interface StoreConversion {
  id: string;
  from: string;
  to: string;
  amountFrom: number;
  amountTo: number;
  oid?: string;
  createdAt: number;
}

const key = (ns: string, addr?: string) => `seyf_${ns}_${(addr ?? "anon").toLowerCase()}`;

const LS = {
  get<T>(k: string, def: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : def;
    } catch {
      return def;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* ignora */
    }
  },
  getStr(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setStr(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignora */
    }
  },
};

// Las rutas /api/db/* exigen sesión SEP-10: el token va en cada llamada y la
// wallet se reescribe con la cuenta Stellar que firmó. Así la clave de los
// datos es siempre la identidad probada, no la dirección que pase la pantalla
// (que en el riel Privy es una dirección EVM imposible de probar con SEP-10).
async function sessionWalletUrl(url: string): Promise<string> {
  const account = await awaitSeyfAuthAccount();
  if (!account) return url;
  const u = new URL(url, window.location.origin);
  if (u.searchParams.has("wallet")) u.searchParams.set("wallet", account);
  return u.pathname + u.search;
}

async function sessionWalletBody(body: unknown): Promise<unknown> {
  const account = await awaitSeyfAuthAccount();
  if (!account || typeof body !== "object" || body === null) return body;
  if (!("wallet" in body)) return body;
  return { ...(body as Record<string, unknown>), wallet: account };
}

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(await sessionWalletUrl(url), { headers: await seyfAuthHeaders() });
  return (await r.json()) as T;
}
async function jpost(url: string, body: unknown) {
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await seyfAuthHeaders()) },
    body: JSON.stringify(await sessionWalletBody(body)),
  });
}
async function jdel(url: string) {
  await fetch(await sessionWalletUrl(url), {
    method: "DELETE",
    headers: await seyfAuthHeaders(),
  });
}

export interface StoreProfile {
  riskProfile: string | null;
  fullName: string | null;
  phone: string | null;
  email: string | null;
}

export const store = {
  enabled: USE_DB,

  async upsertProfile(p: { wallet: string; embedded?: string; email?: string; did?: string; riskProfile?: string; fullName?: string; phone?: string }) {
    if (!USE_DB) return;
    await jpost("/api/db/profile", p);
  },

  async getProfile(wallet: string): Promise<StoreProfile | null> {
    if (!USE_DB) return null;
    const { profile } = await jget<{ profile: { risk_profile: string | null; full_name: string | null; phone: string | null; email: string | null } | null }>(`/api/db/profile?wallet=${wallet}`);
    if (!profile) return null;
    return { riskProfile: profile.risk_profile, fullName: profile.full_name, phone: profile.phone, email: profile.email };
  },

  async setRiskProfile(wallet: string, planId: string) {
    if (USE_DB) return void (await jpost("/api/db/profile", { wallet, riskProfile: planId }));
    LS.setStr(key("risk", wallet), planId);
  },

  async getRiskProfile(wallet: string): Promise<string | null> {
    if (USE_DB) {
      const p = await this.getProfile(wallet);
      return p?.riskProfile ?? null;
    }
    return LS.getStr(key("risk", wallet));
  },

  // ---- CLABE ----
  async getClabe(wallet: string): Promise<string | null> {
    if (USE_DB) return (await jget<{ clabe: string | null }>(`/api/db/clabe?wallet=${wallet}`)).clabe;
    return LS.getStr(key("clabe", wallet));
  },
  async setClabe(wallet: string, clabe: string) {
    if (USE_DB) return void (await jpost("/api/db/clabe", { wallet, clabe }));
    LS.setStr(key("clabe", wallet), clabe);
  },

  // ---- Bancos (retiro) ----
  async listBanks(wallet: string): Promise<StoreBank[]> {
    if (USE_DB) return (await jget<{ banks: StoreBank[] }>(`/api/db/banks?wallet=${wallet}`)).banks ?? [];
    return LS.get<StoreBank[]>(key("banks", wallet), []);
  },
  async addBank(wallet: string, bank: StoreBank) {
    if (USE_DB) return void (await jpost("/api/db/banks", { wallet, bank }));
    const list = LS.get<StoreBank[]>(key("banks", wallet), []);
    LS.set(key("banks", wallet), [...list.filter((b) => b.id !== bank.id), bank]);
  },
  async removeBank(wallet: string, id: string) {
    if (USE_DB) return void (await jdel(`/api/db/banks?wallet=${wallet}&id=${encodeURIComponent(id)}`));
    const list = LS.get<StoreBank[]>(key("banks", wallet), []);
    LS.set(key("banks", wallet), list.filter((b) => b.id !== id));
  },

  // ---- Bóvedas ----
  async listVaults(wallet: string): Promise<StoreVault[]> {
    if (USE_DB) {
      const db = (await jget<{ vaults: StoreVault[] }>(`/api/db/vaults?wallet=${wallet}`)).vaults ?? [];
      if (db.length > 0) return db;
      // Migración: bóvedas en localStorage antes de activar Supabase
      const local = LS.get<StoreVault[]>(key("vaults", wallet), []);
      if (local.length > 0) {
        await Promise.all(local.map((v) => jpost("/api/db/vaults", { wallet, vault: v })));
        return local;
      }
      return [];
    }
    return LS.get<StoreVault[]>(key("vaults", wallet), []);
  },
  async upsertVault(wallet: string, vault: StoreVault) {
    if (USE_DB) return void (await jpost("/api/db/vaults", { wallet, vault }));
    const list = LS.get<StoreVault[]>(key("vaults", wallet), []);
    LS.set(key("vaults", wallet), [...list.filter((v) => v.id !== vault.id), vault]);
  },
  async deleteVault(wallet: string, id: string) {
    if (USE_DB) return void (await jdel(`/api/db/vaults?wallet=${wallet}&id=${id}`));
    const list = LS.get<StoreVault[]>(key("vaults", wallet), []);
    LS.set(key("vaults", wallet), list.filter((v) => v.id !== id));
  },

  // ---- Conversiones de divisas (FX vía Bitso) ----
  async listConversions(wallet: string): Promise<StoreConversion[]> {
    if (USE_DB) return (await jget<{ conversions: StoreConversion[] }>(`/api/db/conversions?wallet=${wallet}`)).conversions ?? [];
    return LS.get<StoreConversion[]>(key("conversions", wallet), []);
  },
  async addConversion(wallet: string, conversion: StoreConversion) {
    if (USE_DB) return void (await jpost("/api/db/conversions", { wallet, conversion }));
    const list = LS.get<StoreConversion[]>(key("conversions", wallet), []);
    LS.set(key("conversions", wallet), [conversion, ...list.filter((c) => c.id !== conversion.id)]);
  },

  // ---- Límites mensuales (depósito / retiro) ----
  async getMonthlyUsage(wallet: string, period: string): Promise<{ deposit: number; withdraw: number }> {
    if (USE_DB) {
      return (
        (await jget<{ usage: { deposit: number; withdraw: number } }>(`/api/db/limits?wallet=${wallet}&period=${period}`)).usage ?? {
          deposit: 0,
          withdraw: 0,
        }
      );
    }
    const all = LS.get<Record<string, { deposit: number; withdraw: number }>>(key("usage", wallet), {});
    return all[period] ?? { deposit: 0, withdraw: 0 };
  },
  async addMonthlyUsage(wallet: string, period: string, kind: "deposit" | "withdraw", amount: number) {
    if (USE_DB) return void (await jpost("/api/db/limits", { wallet, period, kind, amount }));
    const all = LS.get<Record<string, { deposit: number; withdraw: number }>>(key("usage", wallet), {});
    const cur = all[period] ?? { deposit: 0, withdraw: 0 };
    all[period] = { ...cur, [kind]: cur[kind] + amount };
    LS.set(key("usage", wallet), all);
  },

  // ---- Bono ----
  async getBonus(wallet: string): Promise<boolean> {
    if (USE_DB) return Boolean((await jget<{ claimed: boolean }>(`/api/db/bonus?wallet=${wallet}`)).claimed);
    return Boolean(LS.getStr(key("bonus", wallet)));
  },
  async setBonus(wallet: string, amount: number, txId?: string) {
    if (USE_DB) return void (await jpost("/api/db/bonus", { wallet, amount, txId }));
    LS.setStr(key("bonus", wallet), "1");
  },
};
