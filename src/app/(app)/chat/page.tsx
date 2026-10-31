import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { aiConfigured } from "@/lib/ai/client";
import { createClient } from "@/lib/supabase/server";
import { Chat, type ChatMessage } from "./Chat";
import { isMissingObject } from "@/lib/supabase/missing";

export const metadata: Metadata = { title: "Assistente" };

export default async function ChatPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, tools_used, cost_usd")
    .order("created_at", { ascending: true })
    .limit(200);
  const missing = isMissingObject(error);
  return (
    <main className="page chat-page">
      <PageHeader title="Assistente" back="/altro" />
      {!aiConfigured() && (
        <section className="card card-padded">
          <p>
            <strong>AI non configurata.</strong> Aggiungi <code>ANTHROPIC_API_KEY</code> su Vercel e rifai il deploy.
          </p>
        </section>
      )}
      {error ? (
        <section className="card card-padded">
          <p>{missing ? "Esegui su Supabase la migrazione 20261101000006_ai.sql (SQL Editor)." : error.message}</p>
        </section>
      ) : (
        <Chat initial={(data ?? []) as ChatMessage[]} disabled={!aiConfigured()} />
      )}
    </main>
  );
}
