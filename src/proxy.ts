import { NextRequest, NextResponse } from "next/server";

// In-memory store — replace with Upstash Redis for multi-instance deployments.
const store = new Map<string, { count: number; windowStart: number }>();

const WINDOW_MS  = 60_000; // 1 minute
const MAX_REQ    = 30;     // max requests per IP per window

export function proxy(req: NextRequest) {
  const ip  = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const now = Date.now();
  const rec = store.get(ip) ?? { count: 0, windowStart: now };

  if (now - rec.windowStart > WINDOW_MS) {
    rec.count = 0;
    rec.windowStart = now;
  }

  rec.count += 1;
  store.set(ip, rec);

  if (rec.count > MAX_REQ) {
    return NextResponse.json(
      { error: "Too many requests — slow down." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
}

export const config = {
  matcher: ["/api/:path*"],
};
