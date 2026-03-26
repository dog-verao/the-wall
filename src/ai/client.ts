/**
 * Thin AI client using native Node 18+ fetch.
 * Supports OpenAI and Anthropic — no heavy SDKs, keeps the npx package lean.
 */

import { AIProvider } from "../types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

// ── Default models ────────────────────────────────────────────────────────────
const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-haiku-20240307",
};

// ── OpenAI ───────────────────────────────────────────────────────────────────
async function callOpenAI(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number
): Promise<AIResponse> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content ?? "",
    model: data.model,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

// ── Anthropic ─────────────────────────────────────────────────────────────────
async function callAnthropic(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number
): Promise<AIResponse> {
  // Anthropic separates system from user messages
  const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
  const userMessages = messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system: systemMsg,
      messages: userMessages,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content.find((c) => c.type === "text")?.text ?? "";

  return {
    content,
    model: data.model,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

// ── Public interface ──────────────────────────────────────────────────────────
export async function callAI(
  provider: AIProvider,
  apiKey: string,
  messages: ChatMessage[],
  model?: string,
  maxTokens?: number
): Promise<AIResponse> {
  const m = model ?? DEFAULT_MODELS[provider];
  const tokens = maxTokens ?? 512;
  if (provider === "anthropic") return callAnthropic(apiKey, m, messages, tokens);
  return callOpenAI(apiKey, m, messages, tokens);
}

export function getDefaultModel(provider: AIProvider): string {
  return DEFAULT_MODELS[provider];
}
