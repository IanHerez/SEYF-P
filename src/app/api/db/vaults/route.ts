import { NextResponse } from "next/server";
import { listVaults, upsertVault, deleteVault, type VaultRow } from "@/lib/supabase/db";
import { requireDbAccess } from "@/lib/stellar/db-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "wallet requerido" }, { status: 400 });
  const access = await requireDbAccess(request, wallet);
  if (!access.ok) return access.response;
  return NextResponse.json({ vaults: await listVaults(wallet) });
}

export async function POST(request: Request) {
  const { wallet, vault } = (await request.json()) as { wallet?: string; vault?: VaultRow };
  if (!wallet || !vault?.id) return NextResponse.json({ error: "wallet y vault requeridos" }, { status: 400 });
  const access = await requireDbAccess(request, wallet);
  if (!access.ok) return access.response;
  await upsertVault(wallet, vault);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");
  const id = searchParams.get("id");
  if (!wallet || !id) return NextResponse.json({ error: "wallet e id requeridos" }, { status: 400 });
  const access = await requireDbAccess(request, wallet);
  if (!access.ok) return access.response;
  await deleteVault(wallet, id);
  return NextResponse.json({ ok: true });
}
