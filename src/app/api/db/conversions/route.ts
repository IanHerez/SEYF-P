import { NextResponse } from "next/server";
import { listConversions, addConversion, type ConversionRow } from "@/lib/supabase/db";
import { requireDbAccess } from "@/lib/stellar/db-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "wallet requerido" }, { status: 400 });
  const access = await requireDbAccess(request, wallet);
  if (!access.ok) return access.response;
  return NextResponse.json({ conversions: await listConversions(wallet) });
}

export async function POST(request: Request) {
  const { wallet, conversion } = (await request.json()) as { wallet?: string; conversion?: ConversionRow };
  if (!wallet || !conversion?.id) {
    return NextResponse.json({ error: "wallet y conversion requeridos" }, { status: 400 });
  }
  const access = await requireDbAccess(request, wallet);
  if (!access.ok) return access.response;
  await addConversion(wallet, conversion);
  return NextResponse.json({ ok: true });
}
