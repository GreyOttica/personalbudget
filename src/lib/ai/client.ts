import "server-only";

/**
 * Quale AI usare. AI_PROVIDER su Vercel ("gemini" o "anthropic"); se manca, quella di cui c'è la chiave
 * (Gemini se ci sono entrambe). Le chiavi restano sul server: questo modulo non può finire nel browser.
 */
export type Provider = "gemini" | "anthropic";

const env = (k: string) => process.env[k]?.trim() || undefined;

export function provider(): Provider {
  const p = env("AI_PROVIDER")?.toLowerCase();
  if (p === "gemini" || p === "anthropic") return p;
  if (env("GEMINI_API_KEY")) return "gemini";
  if (env("ANTHROPIC_API_KEY")) return "anthropic";
  return "gemini";
}

/** Gemini: alias che punta sempre all'ultimo modello Flash (gratuito). Anthropic: Claude Opus 5.5. */
export const DEFAULT_MODEL: Record<Provider, string> = { gemini: "gemini-flash-latest", anthropic: "claude-opus-5-5" };

export const modelFor = (p: Provider) => (p === "gemini" ? env("GEMINI_MODEL") : env("ANTHROPIC_MODEL")) ?? DEFAULT_MODEL[p];

export const KEY_NAME: Record<Provider, string> = { gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };

export const aiConfigured = () => !!env(KEY_NAME[provider()]);

/** Descrizione per le pagine: nome della variabile mancante, modello, se è gratis. */
export function aiInfo() {
  const p = provider();
  return { provider: p, model: modelFor(p), keyName: KEY_NAME[p], configured: aiConfigured(), free: p === "gemini" };
}

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

// Anthropic, $ per milione di token (listino ottobre 2026). La cache in scrittura costa 1,25× l'input.
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** Costo in dollari. Gemini con il piano gratuito: zero. */
export function costUsd(u: Usage, model: string): number {
  if (model.startsWith("gemini")) return 0;
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"];
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.input * 1.25) / 1_000_000;
}
