import type { Metadata } from "next";
import { loadDashboard, parseMonth } from "@/lib/analytics/load";
import { BudgetEditor } from "./BudgetEditor";

export const metadata: Metadata = { title: "Budget" };

export default async function BudgetPage() {
  const month = parseMonth(undefined);
  const { dashboard, categories } = await loadDashboard(month);
  const byId = new Map(dashboard.categories.map((c) => [c.id, c]));
  const rows = categories
    .filter((c) => c.kind === "expense")
    .map((c) => {
      const r = byId.get(c.id);
      return {
        id: c.id,
        name: c.name,
        emoji: c.emoji,
        isFixed: c.is_fixed,
        budget: r?.budget ?? null,
        proposal: r?.proposal ?? 0,
        average: r?.average ?? 0,
        spent: r?.spent ?? 0,
      };
    })
    .sort((a, b) => b.average - a.average || a.name.localeCompare(b.name));

  return <BudgetEditor rows={rows} months={dashboard.averages.months} />;
}
