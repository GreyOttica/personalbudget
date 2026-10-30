import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { romeDate } from "@/lib/entry/amount";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  expense: "Uscita",
  income: "Entrata",
  investment: "Investimento",
  opening_balance: "Saldo iniziale",
};

// CSV per Excel in italiano: separatore ";", decimali con la virgola, BOM UTF-8 per le lettere accentate.
function cell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const euros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

type Row = {
  id: string;
  occurred_on: string;
  type: string;
  amount_cents: number;
  category_id: string;
  subcategory_id: string | null;
  account_id: string | null;
  note: string | null;
  tag: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

export async function GET() {
  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const supabase = await createClient();
  const [cats, subs, accs] = await Promise.all([
    supabase.from("categories").select("id, name"),
    supabase.from("subcategories").select("id, name"),
    supabase.from("accounts").select("id, name"),
  ]);
  const name = (rows: { id: string; name: string }[] | null) => new Map((rows ?? []).map((r) => [r.id, r.name]));
  const catName = name(cats.data);
  const subName = name(subs.data);
  const accName = name(accs.data);

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, occurred_on, type, amount_cents, category_id, subcategory_id, account_id, note, tag, source, created_at, updated_at")
      .is("deleted_at", null)
      .order("occurred_on")
      .order("created_at")
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }

  const header = ["Data", "Tipo", "Categoria", "Sottocategoria", "Importo", "Importo con segno", "Note", "Conto", "Tag", "Origine", "Creato", "Modificato", "ID"];
  const lines = [header.join(";")];
  for (const r of rows) {
    const cents = Number(r.amount_cents);
    const signed = r.type === "income" || r.type === "opening_balance" ? cents : -cents;
    lines.push(
      [
        r.occurred_on,
        TYPE_LABEL[r.type] ?? r.type,
        catName.get(r.category_id),
        r.subcategory_id ? subName.get(r.subcategory_id) : "",
        euros(cents),
        euros(signed),
        r.note,
        r.account_id ? accName.get(r.account_id) : "",
        r.tag,
        r.source === "import" ? "Google Sheet" : "App",
        r.created_at,
        r.updated_at,
        r.id,
      ]
        .map(cell)
        .join(";"),
    );
  }

  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="personal-budget-${romeDate()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
