import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/** Modello configurabile da Vercel (ANTHROPIC_MODEL); di default Claude Opus 5.5. */
export const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";

export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY?.trim();

export function anthropic() {
  // La chiave resta sul server: questo modulo non può finire nel browser (server-only).
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 110_000 });
}

/**
 * Se un filtro di sicurezza del modello declina la richiesta, l'API la ripete da sola
 * su un modello di riserva scelto da Anthropic per quella categoria di rifiuto.
 */
export const FALLBACK = { betas: ["server-side-fallback-2026-07-01" as const], fallbacks: "default" as const };

// Prezzi in $ per milione di token (listino ottobre 2026). La cache in scrittura costa 1,25× l'input.
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export function addUsage(total: Usage, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }) {
  total.input += u.input_tokens;
  total.output += u.output_tokens; // comprende i token di ragionamento
  total.cacheRead += u.cache_read_input_tokens ?? 0;
  total.cacheWrite += u.cache_creation_input_tokens ?? 0;
  return total;
}

export function costUsd(u: Usage, model = MODEL): number {
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"];
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.input * 1.25) / 1_000_000;
}
