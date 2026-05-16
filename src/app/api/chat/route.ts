import { NextRequest, NextResponse } from "next/server";

const BASE_URL = process.env.THAILLM_BASE_URL ?? "https://thaillm.or.th/api/v1";
const API_KEY  = process.env.THAILLM_API_KEY ?? "";

const MAX_MESSAGES = 50;
const MAX_CONTENT_LENGTH = 10_000;
const ALLOWED_ROLES = new Set(["user", "assistant"]);

function validateMessages(messages: unknown): messages is { role: string; content: string }[] {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return false;
  }
  return messages.every(
    (m) =>
      m !== null &&
      typeof m === "object" &&
      ALLOWED_ROLES.has((m as { role: string }).role) &&
      typeof (m as { content: string }).content === "string" &&
      (m as { content: string }).content.length <= MAX_CONTENT_LENGTH
  );
}

export async function POST(req: NextRequest) {
  const { messages, model } = await req.json();

  const VALID_MODELS = new Set(["openthaigpt", "pathumma", "typhoon", "thalle"]);
  const safeModel = VALID_MODELS.has(model) ? model : "openthaigpt";

  if (!validateMessages(messages)) {
    return NextResponse.json({ error: "Invalid messages payload" }, { status: 400 });
  }

  const upstream = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({
      model: safeModel,
      messages,
      max_tokens: 2048,
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    console.error("[upstream error]", upstream.status, text);
    return NextResponse.json({ error: "Upstream API error" }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const json = JSON.parse(data);
            const text = json.choices?.[0]?.delta?.content ?? "";
            if (text) controller.enqueue(encoder.encode(text));
          } catch {
            // skip malformed SSE lines
          }
        }
      }
      controller.close();
    },
  });

  return new NextResponse(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
