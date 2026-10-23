import { NextResponse } from "next/server";
import { listBanks, addBank, removeBank, type BankRow } from "@/lib/supabase/db";
import { requireDbAccess } from "@/lib/stellar/db-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "wallet requerido" }, { status: 400 });
  const access = await requireDbAccess(request, wallet);
  if (!access.ok) return access.response;
  return NextResponse.json({ banks: await listBanks(wallet) });
}

export async function POST(request: Request) {
  const { wallet, bank } = (await request.json()) as { wallet?: string; bank?: BankRow };
  if (!wallet || !bank?.id) return NextResponse.json({ error: "wallet y bank requeridos" }, { status: 400 });
  const access = await requireDbAccess(request, wallet);
  if (!access.ok) return access.response;
  await addBank(wallet, bank);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");
  const id = searchParams.get("id");
  if (!wallet || !id) return NextResponse.json({ error: "wallet e id requeridos" }, { status: 400 });
  const access = await requireDbAccess(request, wallet);
  if (!access.ok) return access.response;
  await removeBank(wallet, id);
  return NextResponse.json({ ok: true });
}
