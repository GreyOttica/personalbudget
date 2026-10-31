import "server-only";
import type { z } from "zod";
import { modelFor, provider, type Usage } from "./client";

/** Uno strumento che l'AI può chiamare in chat: input validato con zod, risultato in JSON. */
export type ToolDef = {
  name: string;
  description: string;
  schema: z.ZodObject;
  run: (input: Record<string, unknown>) => Promise<string>;
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type LlmResult<T> = { ok: true; value: T; model: string; usage: Usage } | { ok: false; error: string };

export class AiError extends Error {}

/** Risposta strutturata (JSON validato dallo schema). */
export async function generateStructured<S extends z.ZodObject>(system: string, user: string, schema: S): Promise<LlmResult<z.infer<S>>> {
  const p = provider();
  const model = modelFor(p);
  try {
    if (p === "gemini") return await (await import("./gemini")).structured(model, system, user, schema);
    return await (await import("./anthropic")).structured(model, system, user, schema);
  } catch (e) {
    return { ok: false, error: e instanceof AiError ? e.message : `Chiamata all'AI non riuscita: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Conversazione con strumenti: l'AI chiama gli strumenti finché ha i dati, poi risponde. */
export async function toolChat(system: string, turns: ChatTurn[], tools: ToolDef[]): Promise<LlmResult<{ text: string; toolsUsed: string[] }>> {
  const p = provider();
  const model = modelFor(p);
  try {
    if (p === "gemini") return await (await import("./gemini")).chat(model, system, turns, tools);
    return await (await import("./anthropic")).chat(model, system, turns, tools);
  } catch (e) {
    return { ok: false, error: e instanceof AiError ? e.message : `Chiamata all'AI non riuscita: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Esegue uno strumento validando l'input; gli errori tornano all'AI come testo, non bloccano la chat. */
export async function runTool(tool: ToolDef | undefined, input: unknown): Promise<string> {
  if (!tool) return JSON.stringify({ errore: "Strumento inesistente" });
  const parsed = tool.schema.safeParse(input ?? {});
  if (!parsed.success) return JSON.stringify({ errore: "Parametri non validi", dettagli: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  try {
    return await tool.run(parsed.data as Record<string, unknown>);
  } catch (e) {
    return JSON.stringify({ errore: e instanceof Error ? e.message : String(e) });
  }
}
