import { NextResponse } from "next/server";
import { getMonthlyUsage, addMonthlyUsage } from "@/lib/supabase/db";
import { requireDbAccess } from "@/lib/stellar/db-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");
  const period = searchParams.get("period");
  if (!wallet || !period) return NextResponse.json({ error: "wallet y period requeridos" }, { status: 400 });
  const access = await requireDbAccess(request, wallet);
  if (!access.ok) return access.response;
  return NextResponse.json({ usage: await getMonthlyUsage(wallet, period) });
}

export async function POST(request: Request) {
  const { wallet, period, kind, amount } = (await request.json()) as {
    wallet?: string;
    period?: string;
    kind?: "deposit" | "withdraw";
    amount?: number;
  };
  if (!wallet || !period || (kind !== "deposit" && kind !== "withdraw") || !amount || amount <= 0) {
    return NextResponse.json({ error: "wallet, period, kind y amount requeridos" }, { status: 400 });
  }
  const access = await requireDbAccess(request, wallet);
  if (!access.ok) return access.response;
  await addMonthlyUsage(wallet, period, kind, amount);
  return NextResponse.json({ ok: true });
}
