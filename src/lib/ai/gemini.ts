import "server-only";
import { z } from "zod";
import { emptyUsage, type Usage } from "./client";
import { AiError, runTool, type ChatTurn, type LlmResult, type ToolDef } from "./llm";

/** Chiamate REST all'API Gemini (Google AI Studio), senza SDK. */
const BASE = (process.env.GEMINI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
/** Se il modello principale esaurisce la quota gratuita del minuto o del giorno, si prova questo. */
const LITE = "gemini-flash-lite-latest";
const MAX_TOOL_ROUNDS = 6;

type Part = { text?: string; thought?: boolean; functionCall?: { id?: string; name: string; args?: Record<string, unknown> }; [k: string]: unknown };
type Content = { role: "user" | "model"; parts: Part[] };
type GeminiResponse = {
  candidates?: { content?: Content; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
  modelVersion?: string;
};

type Schema = { type: string; [k: string]: unknown };

/** JSON Schema (da zod) → sottoinsieme OpenAPI accettato da Gemini. */
export function toGeminiSchema(js: Record<string, unknown>): Schema {
  const anyOf = js.anyOf as Record<string, unknown>[] | undefined;
  if (anyOf) {
    const notNull = anyOf.filter((s) => s.type !== "null");
    return { ...toGeminiSchema(notNull[0] ?? {}), ...(notNull.length < anyOf.length ? { nullable: true } : {}) };
  }
  let type = js.type as string | string[] | undefined;
  let nullable = false;
  if (Array.isArray(type)) {
    nullable = type.includes("null");
    type = type.find((t) => t !== "null");
  }
  const out: Schema = { type: (type ?? "string").toUpperCase() };
  if (nullable) out.nullable = true;
  if (typeof js.description === "string") out.description = js.description;
  if (Array.isArray(js.enum)) out.enum = js.enum.map(String);
  for (const k of ["minimum", "maximum"] as const) if (typeof js[k] === "number" && Math.abs(js[k] as number) < 1e12) out[k] = js[k];
  if (typeof js.pattern === "string" && !out.description) out.description = `Formato: ${js.pattern}`;
  if (type === "object") {
    const props = (js.properties ?? {}) as Record<string, Record<string, unknown>>;
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, toGeminiSchema(v)]));
    out.propertyOrdering = Object.keys(props);
    if (Array.isArray(js.required) && js.required.length) out.required = js.required;
  }
  if (type === "array" && js.items) out.items = toGeminiSchema(js.items as Record<string, unknown>);
  return out;
}

const schemaOf = (s: z.ZodType) => toGeminiSchema(z.toJSONSchema(s) as Record<string, unknown>);

function retryDelayMs(body: string): number {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return Math.min(20_000, m ? Number(m[1]) * 1000 + 500 : 4000);
}

/** Tempo massimo complessivo per una risposta (tentativi compresi): la funzione su Vercel ha 120 s. */
const BUDGET_MS = 85_000;

async function call(model: string, body: Record<string, unknown>, deadline: number): Promise<GeminiResponse & { model: string }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new AiError("Manca GEMINI_API_KEY su Vercel.");
  let current = model;
  for (let attempt = 0; ; attempt++) {
    const left = deadline - Date.now();
    if (left < 5_000) throw new AiError("Gemini non ha risposto in tempo. Riprova tra qualche minuto.");
    const res = await fetch(`${BASE}/v1beta/models/${encodeURIComponent(current)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.min(50_000, left)),
      cache: "no-store",
    });
    if (res.ok) return { ...((await res.json()) as GeminiResponse), model: current };
    const text = await res.text();
    const busy = res.status === 429 || res.status >= 500; // quota finita o server sovraccarico
    if (busy && attempt < 3) {
      // Un nuovo tentativo sullo stesso modello, poi passo al Lite (quota e server separati).
      if (attempt >= 1 && current !== LITE) current = LITE;
      else await new Promise((r) => setTimeout(r, Math.min(res.status === 429 ? retryDelayMs(text) : 2500 * (attempt + 1), Math.max(0, deadline - Date.now() - 5_000))));
      continue;
    }
    if (res.status >= 500) throw new AiError("I server di Google Gemini sono sovraccarichi in questo momento. Riprova tra qualche minuto.");
    if (res.status === 429) throw new AiError("Raggiunto il limite gratuito di Gemini (richieste al minuto o al giorno). Riprova tra un po'.");
    if (res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(text)) throw new AiError("La chiave GEMINI_API_KEY non è valida: ricontrollala su Vercel.");
    if (res.status === 403) throw new AiError("Gemini ha rifiutato la chiave (403): controlla che sia di Google AI Studio e che l'API sia attiva.");
    if (res.status === 404) throw new AiError(`Modello Gemini "${current}" non trovato: correggi GEMINI_MODEL su Vercel o toglila.`);
    let message = text.slice(0, 300);
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
    } catch {}
    throw new AiError(`Gemini: errore ${res.status}: ${message}`);
  }
}

function addUsage(total: Usage, r: GeminiResponse) {
  const u = r.usageMetadata ?? {};
  total.input += (u.promptTokenCount ?? 0) - (u.cachedContentTokenCount ?? 0);
  total.cacheRead += u.cachedContentTokenCount ?? 0;
  total.output += (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
}

function candidate(r: GeminiResponse): Content {
  if (r.promptFeedback?.blockReason) throw new AiError(`Gemini ha bloccato la richiesta (${r.promptFeedback.blockReason}). Prova a riformularla.`);
  const c = r.candidates?.[0];
  if (!c?.content?.parts?.length) {
    const reason = c?.finishReason ?? "nessuna risposta";
    throw new AiError(reason === "SAFETY" ? "Gemini non ha risposto per i suoi filtri di sicurezza. Prova a riformulare." : `Risposta vuota da Gemini (${reason}). Riprova.`);
  }
  return { role: "model", parts: c.content.parts };
}

const textOf = (c: Content) =>
  c.parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();

export async function structured<S extends z.ZodObject>(model: string, system: string, user: string, schema: S): Promise<LlmResult<z.infer<S>>> {
  const r = await call(model, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schemaOf(schema), maxOutputTokens: 8192, temperature: 0.4 },
  }, Date.now() + BUDGET_MS);
  const usage = emptyUsage();
  addUsage(usage, r);
  const raw = textOf(candidate(r)).replace(/^```(?:json)?\s*|\s*```$/g, "");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AiError(`Risposta di Gemini non valida (${r.candidates?.[0]?.finishReason ?? "?"}). Riprova.`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AiError("Risposta di Gemini incompleta. Riprova.");
  return { ok: true, value: parsed.data as z.infer<S>, model: r.modelVersion ?? r.model, usage };
}

export async function chat(model: string, system: string, turns: ChatTurn[], tools: ToolDef[]): Promise<LlmResult<{ text: string; toolsUsed: string[] }>> {
  const usage = emptyUsage();
  const used = new Set<string>();
  const byName = new Map(tools.map((t) => [t.name, t]));
  const contents: Content[] = turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] }));
  const declarations = tools.map((t) => {
    const params = schemaOf(t.schema);
    return { name: t.name, description: t.description, ...(Object.keys((params.properties as object) ?? {}).length ? { parameters: params } : {}) };
  });
  let current = model;
  const deadline = Date.now() + BUDGET_MS;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const last = round === MAX_TOOL_ROUNDS;
    const r = await call(current, {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: [{ functionDeclarations: declarations }],
      // All'ultimo giro niente strumenti: deve rispondere con quello che ha.
      toolConfig: { functionCallingConfig: { mode: last ? "NONE" : "AUTO" } },
      generationConfig: { maxOutputTokens: 4096, temperature: 0.4 },
    }, deadline);
    current = r.model; // se è passato al Lite per la quota, resto sul Lite
    addUsage(usage, r);
    const msg = candidate(r);
    // Rimando le parti del modello così come sono: contengono le "firme" del ragionamento richieste dai modelli Gemini 3.
    contents.push(msg);
    const calls = msg.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    if (!calls.length) {
      const text = textOf(msg);
      if (!text) throw new AiError("Risposta vuota da Gemini. Riprova.");
      return { ok: true, value: { text, toolsUsed: [...used] }, model: r.modelVersion ?? r.model, usage };
    }
    const results = await Promise.all(
      calls.map(async (c) => {
        used.add(c.name);
        const out = await runTool(byName.get(c.name), c.args);
        let response: unknown;
        try {
          response = JSON.parse(out);
        } catch {
          response = out;
        }
        return { functionResponse: { ...(c.id ? { id: c.id } : {}), name: c.name, response: { result: response } } };
      }),
    );
    contents.push({ role: "user", parts: results });
  }
  throw new AiError("L'assistente non è arrivato a una risposta. Prova a fare una domanda più precisa.");
}
