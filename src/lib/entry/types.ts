// Tipi condivisi tra API, archivio offline e interfaccia di inserimento.

export type CategoryKind = "expense" | "income" | "investment";
export type TxnType = "expense" | "income" | "investment";

export type Category = {
  id: string;
  name: string;
  emoji: string;
  kind: CategoryKind;
  is_fixed: boolean;
  uses: number;
};

export type Subcategory = {
  id: string;
  category_id: string;
  name: string;
  uses: number;
};

export type Account = { id: string; name: string };

export type Reference = {
  categories: Category[];
  subcategories: Subcategory[];
  accounts: Account[];
  tags: string[];
};

/** Movimento come lo vede l'app. Importi sempre in centesimi. */
export type Txn = {
  id: string;
  occurred_on: string; // YYYY-MM-DD, giorno di calendario a Roma
  type: TxnType;
  amount_cents: number;
  category_id: string;
  subcategory_id: string | null;
  account_id: string | null;
  note: string | null;
  tag: string | null;
  updated_at: string; // ISO, serve per "vince la modifica più recente"
};

/** Movimento in uscita verso il server: può portare una sottocategoria nuova. */
export type TxnDraft = Txn & { subcategory_name?: string | null };

export type Op =
  | { op: "upsert"; id: string; updated_at: string; txn: TxnDraft }
  | { op: "delete"; id: string; updated_at: string };

/** Uscita "Da" un conto o entrata "A" un conto, come nel Google Form. */
export type Direction = "from" | "to";

export function txnType(direction: Direction, category: Pick<Category, "kind">): TxnType {
  if (direction === "to") return "income";
  return category.kind === "investment" ? "investment" : "expense";
}

export function defaultDirection(category: Pick<Category, "kind">): Direction {
  return category.kind === "income" ? "to" : "from";
}
