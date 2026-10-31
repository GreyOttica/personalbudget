import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { aiInfo } from "@/lib/ai/client";
import { createClient } from "@/lib/supabase/server";
import { Chat, type ChatMessage } from "./Chat";
import type { Proposal } from "@/lib/ai/chat";
import { isMissingObject } from "@/lib/supabase/missing";

export const metadata: Metadata = { title: "Assistente" };

export default async function ChatPage() {
  const ai = aiInfo();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, tools_used, cost_usd, proposal_id")
    .order("created_at", { ascending: true })
    .limit(200);
  const missing = isMissingObject(error);
  // Proposte di budget collegate ai messaggi (se la migrazione 0007 manca, la colonna non c'è: ricarico senza).
  let rows = (data ?? []) as (ChatMessage & { proposal_id?: string | null })[];
  if (error && /proposal_id/.test(error.message)) {
    const retry = await supabase.from("chat_messages").select("id, role, content, tools_used, cost_usd").order("created_at", { ascending: true }).limit(200);
    rows = (retry.data ?? []) as ChatMessage[];
  }
  const ids = rows.map((r) => r.proposal_id).filter((x): x is string => !!x);
  const proposals = ids.length ? ((await supabase.from("budget_proposals").select("id, items, summary, applied_at").in("id", ids)).data ?? []) : [];
  const byId = new Map(proposals.map((p) => [p.id as string, p as Proposal]));
  const messages: ChatMessage[] = rows.map(({ proposal_id, ...m }) => ({ ...m, proposal: proposal_id ? (byId.get(proposal_id) ?? null) : null }));
  const failed = error && !/proposal_id/.test(error.message);
  return (
    <main className="page chat-page">
      <PageHeader title="Assistente" back="/altro" />
      {!ai.configured && (
        <section className="card card-padded">
          <p>
            <strong>AI non configurata.</strong> Aggiungi <code>{ai.keyName}</code> su Vercel e rifai il deploy.
          </p>
        </section>
      )}
      {failed ? (
        <section className="card card-padded">
          <p>{missing ? "Esegui su Supabase la migrazione 20261101000006_ai.sql (SQL Editor)." : error?.message}</p>
        </section>
      ) : (
        <Chat initial={messages} disabled={!ai.configured} />
      )}
    </main>
  );
}
