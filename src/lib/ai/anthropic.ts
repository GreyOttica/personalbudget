import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat, betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { emptyUsage, type Usage } from "./client";
import { AiError, runTool, type ChatTurn, type LlmResult, type ToolDef } from "./llm";

const client = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 80_000 /* dentro i 120 s della funzione su Vercel */ });

/** Se un filtro di sicurezza declina la richiesta, l'API la ripete su un modello di riserva. */
const FALLBACK = { betas: ["server-side-fallback-2026-07-01" as const], fallbacks: "default" as const };

function add(total: Usage, u: Anthropic.Beta.BetaUsage) {
  total.input += u.input_tokens;
  total.output += u.output_tokens;
  total.cacheRead += u.cache_read_input_tokens ?? 0;
  total.cacheWrite += u.cache_creation_input_tokens ?? 0;
}

export async function structured<S extends z.ZodObject>(model: string, system: string, user: string, schema: S): Promise<LlmResult<z.infer<S>>> {
  const res = await client().beta.messages.parse({
    model,
    max_tokens: 8000,
    ...FALLBACK,
    output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") throw new AiError("L'AI ha rifiutato la richiesta. Riprova più tardi.");
  if (!res.parsed_output) throw new AiError(`Risposta dell'AI non valida (${res.stop_reason}).`);
  const usage = emptyUsage();
  add(usage, res.usage);
  return { ok: true, value: res.parsed_output as z.infer<S>, model: res.model, usage };
}

export async function chat(model: string, system: string, turns: ChatTurn[], tools: ToolDef[]): Promise<LlmResult<{ text: string; toolsUsed: string[] }>> {
  const usage = emptyUsage();
  const used = new Set<string>();
  let final: Anthropic.Beta.BetaMessage | null = null;
  const runner = client().beta.messages.toolRunner({
    model,
    max_tokens: 6000,
    max_iterations: 6,
    ...FALLBACK,
    output_config: { effort: "medium" },
    cache_control: { type: "ephemeral" }, // istruzioni e strumenti si riusano tra domande ravvicinate
    system,
    tools: tools.map((t) =>
      betaZodTool({ name: t.name, description: t.description, inputSchema: t.schema, run: (input) => runTool(t, input) }),
    ),
    messages: turns,
  });
  for await (const message of runner) {
    add(usage, message.usage);
    for (const b of message.content) if (b.type === "tool_use") used.add(b.name);
    final = message;
  }
  if (!final) throw new AiError("Nessuna risposta dall'AI.");
  if (final.stop_reason === "refusal") throw new AiError("L'AI non ha risposto a questa domanda. Prova a riformularla.");
  const text = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new AiError(`Risposta vuota (${final.stop_reason}). Riprova.`);
  return { ok: true, value: { text, toolsUsed: [...used] }, model: final.model, usage };
}
