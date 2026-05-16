# Security Patch Plan — ThaiLLM Chat

**AI AGENT INSTRUCTIONS**
This document is the single source of truth for patching security vulnerabilities found
in a white-hat audit of this Next.js project. Work phase by phase, top to bottom.
Before touching any file, read the current file content first — the code may have already
been partially patched. After completing each task, mark it `[x]`. Do not skip tasks
without explaining why. Do not patch a later phase before all tasks in the current phase
are `[x]`.

**Project root:** `/Users/phud/Desktop/01-Tech/26-THAILLM/thaillm-chat`

**Audit report:** `docs/SECURITY_AUDIT.md` (full findings with exploit details)

**Status legend**
- `[ ]` — not started
- `[~]` — in progress / partially done
- `[x]` — complete
- `[!]` — blocked / needs human action

---

## Phase 1 — CRITICAL (must be done before any deployment)

### Task C1 — Rotate the API key
**Status:** `[!]`
**Why:** The key `<YOUR_API_KEY>` is visible in `.env.local` in plaintext.
Even though it was never committed to git, any machine backup or sync tool could expose it.
**Action required (human):**
1. Log in to https://thaillm.or.th and revoke the current API key.
2. Generate a new key.
3. Update `.env.local` line 1 with the new value.
4. If this app is deployed to Vercel/Railway/any host, update the env var there too.

**After human completes this:** change status to `[x]`.

---

### Task C2 — Fix HTTP upstream (API key sent in cleartext)
**Status:** `[x]`
**Severity:** CRITICAL
**Files to edit:**
- `src/app/api/chat/route.ts` — line 3
- `src/app/api/create-file/route.ts` — line 6

**Problem:** Both files use this default:
```typescript
const BASE_URL = process.env.THAILLM_BASE_URL ?? "http://thaillm.or.th/api/v1";
```
The `http://` default transmits the Bearer token in cleartext over the network.

**Fix — apply to BOTH files:**
Change:
```typescript
const BASE_URL = process.env.THAILLM_BASE_URL ?? "http://thaillm.or.th/api/v1";
```
To:
```typescript
const BASE_URL = process.env.THAILLM_BASE_URL ?? "https://thaillm.or.th/api/v1";
```

**Verify:** `grep -r "http://" src/app/api/` should return no results after patching.

---

### Task C3 — Add server-side rate limiting
**Status:** `[x]`
**Severity:** CRITICAL
**Why:** Both API routes have zero rate limiting. The UI hint "5 req/s · 200 req/min"
is display-only text — it is not enforced anywhere in code.
An attacker can exhaust the entire API quota in seconds with parallel curl calls.

**Step 1 — Create `src/middleware.ts`** (new file, does not exist yet):
```typescript
import { NextRequest, NextResponse } from "next/server";

// In-memory store — replace with Upstash Redis for multi-instance deployments.
const store = new Map<string, { count: number; windowStart: number }>();

const WINDOW_MS  = 60_000; // 1 minute
const MAX_REQ    = 30;     // max requests per IP per window

export function middleware(req: NextRequest) {
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
```

**Step 2 — Verify:** After creating the file, confirm it exists:
`ls src/middleware.ts`

**Note for AI:** If the project is later deployed to multiple instances (e.g., Vercel serverless),
swap the `Map` for Upstash Redis so the rate limit is shared across all instances.
Document that change here when done.

---

## Phase 2 — HIGH (complete before going live)

### Task H1 — Validate model parameter against allowlist
**Status:** `[x]`
**Severity:** HIGH
**Files to edit:**
- `src/app/api/chat/route.ts`
- `src/app/api/create-file/route.ts`

**Problem:** The `model` value from the request body is forwarded to the upstream API
without any validation. An attacker can pass arbitrary strings to probe backend models.

**Fix — add to BOTH files, immediately after the `req.json()` destructure:**
```typescript
const VALID_MODELS = new Set(["openthaigpt", "pathumma", "typhoon", "thalle"]);
const safeModel = VALID_MODELS.has(model) ? model : "openthaigpt";
```
Then replace every use of `model` in the `fetch` body with `safeModel`.

**In `chat/route.ts` the upstream fetch body becomes:**
```typescript
body: JSON.stringify({
  model: safeModel,
  messages,
  max_tokens: 2048,
  stream: true,
}),
```

**In `create-file/route.ts` the upstream fetch body becomes:**
```typescript
body: JSON.stringify({
  model: safeModel,
  messages,
  tools: [tool],
  tool_choice: "auto",
  max_tokens: 1024,
  stream: false,
}),
```

---

### Task H2 — Add request body validation and size limits
**Status:** `[x]`
**Severity:** HIGH
**Files to edit:**
- `src/app/api/chat/route.ts`
- `src/app/api/create-file/route.ts`

**Problem:** No validation on `messages` type, array length, individual message size,
or message roles. Attackers can inject `role: "system"` messages for prompt injection,
send massive payloads to exhaust memory, or crash with wrong types.

**Fix — validation helper to add at the top of EACH route file (after imports):**
```typescript
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
```

**Fix — add validation in the POST handler, after `req.json()`, before the upstream fetch:**
```typescript
if (!validateMessages(messages)) {
  return NextResponse.json({ error: "Invalid messages payload" }, { status: 400 });
}
```

**Additional check for `create-file/route.ts` — validate `mode`:**
```typescript
const VALID_MODES = new Set(["xlsx", "pptx", "docx"]);
if (!VALID_MODES.has(mode)) {
  return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
}
```

---

### Task H3 — Replace vulnerable `xlsx` package with `exceljs`
**Status:** `[x]`
**Severity:** HIGH
**Why:** `xlsx@0.18.5` (SheetJS npm version) has two known CVEs:
- **GHSA-4r6h-8v6p-xvw6** — Prototype Pollution (HIGH)
- **GHSA-5pgg-2g8v-p4x9** — ReDoS (MODERATE)
There is no fix available — the package is abandoned on npm. Must migrate.

**Step 1 — Install replacement:**
```bash
npm uninstall xlsx
npm install exceljs
```

**Step 2 — Update `src/app/api/create-file/route.ts`:**

Remove:
```typescript
import * as XLSX from "xlsx";
```
Add:
```typescript
import ExcelJS from "exceljs";
```

Replace the XLSX file-generation block (currently lines ~184–199) with:
```typescript
if (mode === "xlsx") {
  const headers  = args.headers   as string[];
  const rows     = args.rows      as unknown[][];
  const sheet    = (args.sheet_name as string) || "Sheet1";
  const filename = (args.filename  as string)  || "output.xlsx";

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(headers);
  for (const row of rows) ws.addRow(row as ExcelJS.CellValue[]);

  const buf = await wb.xlsx.writeBuffer();
  return NextResponse.json({
    filename,
    fileBase64: Buffer.from(buf).toString("base64"),
    preview: { headers, rows },
  });
}
```

**Step 3 — Verify:** `npm audit` should no longer report xlsx vulnerabilities.

---

### Task H4 — Add security headers to Next.js config
**Status:** `[x]`
**Severity:** HIGH
**File to edit:** `next.config.ts`

**Current content:**
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
```

**Replace with:**
```typescript
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "X-Frame-Options",           value: "DENY" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self' https://thaillm.or.th",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
```

**Verify:** Start dev server and check browser DevTools → Network → any request →
Response Headers. You should see `x-frame-options: DENY` and `content-security-policy`.

---

## Phase 3 — MEDIUM (complete before production traffic)

### Task M1 — Suppress verbose upstream error responses
**Status:** `[x]`
**Severity:** MEDIUM
**Files to edit:**
- `src/app/api/chat/route.ts` — lines 24–27
- `src/app/api/create-file/route.ts` — lines 113–116

**Problem:** Raw upstream error text is returned verbatim to the browser,
potentially leaking internal API error messages, version strings, or structure.

**Current code (chat/route.ts):**
```typescript
if (!upstream.ok || !upstream.body) {
  const text = await upstream.text();
  return NextResponse.json({ error: text }, { status: upstream.status });
}
```

**Fix — apply to BOTH files:**
```typescript
if (!upstream.ok || !upstream.body) {
  const text = await upstream.text();
  console.error("[upstream error]", upstream.status, text); // log server-side only
  return NextResponse.json({ error: "Upstream API error" }, { status: 502 });
}
```

---

### Task M2 — Sanitize AI-generated filename
**Status:** `[x]`
**Severity:** MEDIUM
**File to edit:** `src/app/api/create-file/route.ts`

**Problem:** The `filename` field comes from the AI model's tool call output and flows
directly into the JSON response and then to `a.download = filename` on the client.
A prompt-injected filename like `../../evil.exe` or one with null bytes could misbehave.

**Fix — create a shared sanitize function at the top of the file (after imports):**
```typescript
function sanitizeFilename(raw: string, fallback: string): string {
  return (raw || fallback)
    .replace(/[^a-zA-Z0-9ก-๙._\- ]/g, "_")
    .replace(/\.{2,}/g, "_")
    .slice(0, 100)
    .trim() || fallback;
}
```

**Apply to all three filename extraction points in the file:**
```typescript
// pptx block:
const filename = sanitizeFilename(args.filename as string, "presentation.pptx");

// xlsx block:
const filename = sanitizeFilename(args.filename as string, "output.xlsx");

// docx block:
const filename = sanitizeFilename(args.filename as string, "output.docx");
```

---

### Task M3 — Validate `<tool_call>` parsed name
**Status:** `[x]`
**Severity:** MEDIUM
**File to edit:** `src/app/api/create-file/route.ts` — lines 122–130

**Problem:** The fallback `<tool_call>` XML parser extracts `parsed.name` from AI output
but never validates it against the expected tool for the current `mode`.

**Current code:**
```typescript
const match = message.content.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
if (match) {
  try {
    const parsed = JSON.parse(match[1]);
    toolCalls = [{ function: { name: parsed.name, arguments: JSON.stringify(parsed.arguments) } }];
  } catch { /* ignore malformed */ }
}
```

**Fix — add name validation:**
```typescript
const TOOL_NAME: Record<string, string> = {
  xlsx: "create_xlsx",
  pptx: "create_pptx",
  docx: "create_docx",
};

const match = message.content.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
if (match) {
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed.name !== TOOL_NAME[mode]) {
      throw new Error("unexpected tool name in model output");
    }
    toolCalls = [{ function: { name: parsed.name, arguments: JSON.stringify(parsed.arguments) } }];
  } catch { /* ignore malformed or mismatched */ }
}
```

---

### Task M4 — Add `rehype-sanitize` to ReactMarkdown
**Status:** `[x]`
**Severity:** MEDIUM
**File to edit:** `src/app/page.tsx`

**Problem:** ReactMarkdown renders AI output including links. A model could generate
`[click](javascript:alert(1))` which some browsers may execute.

**Step 1 — Install:**
```bash
npm install rehype-sanitize
```

**Step 2 — Update `src/app/page.tsx` import block** (add after existing imports):
```typescript
import rehypeSanitize from "rehype-sanitize";
```

**Step 3 — Update the ReactMarkdown component** (currently line 489):
Change:
```tsx
<ReactMarkdown remarkPlugins={[remarkGfm]}>{reply}</ReactMarkdown>
```
To:
```tsx
<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
  {reply}
</ReactMarkdown>
```

**Verify:** Test in browser that normal Markdown (bold, code blocks, tables) still renders
correctly. Test that a `javascript:` link does not execute.

---

## Phase 4 — LOW (good housekeeping)

### Task L1 — Monitor postcss CVE (no action yet)
**Status:** `[!]`
**Severity:** LOW (dev-only)
**Why blocked:** The postcss XSS vulnerability is inside Next.js's own dependency tree.
The suggested fix (`npm audit fix --force`) would downgrade Next.js to v9, which is
unacceptable. This is a dev-only build-time tool — it does not affect deployed users.
**Action:** When Next.js releases a version that ships postcss ≥ 8.5.10, upgrade:
```bash
npm install next@latest
```
Check monthly: `npm audit 2>&1 | grep postcss`

### Task L2 — Validate `mode` parameter to strict enum
**Status:** `[x]`
**Note:** Handled by Task H2. `VALID_MODES = new Set(["xlsx", "pptx", "docx"])` guard added to `create-file/route.ts` POST handler; invalid values return HTTP 400.

---

## Completion checklist

Run this after all phases are done to verify the patch is solid:

```bash
# 1. No plaintext HTTP in API routes
grep -r "http://" src/app/api/ && echo "FAIL — still using HTTP" || echo "OK"

# 2. middleware exists
ls src/middleware.ts && echo "OK" || echo "FAIL — middleware missing"

# 3. xlsx is gone
grep -r '"xlsx"' package.json && echo "FAIL — xlsx still in deps" || echo "OK"

# 4. No raw upstream error passthrough
grep -r '"error: text"' src/app/api/ && echo "FAIL — leaking errors" || echo "OK"

# 5. Audit clean (expect only postcss moderate)
npm audit 2>&1 | grep "high\|critical" && echo "FAIL — high/critical vulns remain" || echo "OK"
```

---

## Notes for AI agent

- Always read the current file before editing — the patch order matters and code may differ.
- Mark tasks `[~]` when you start them so if you are interrupted the next agent knows.
- If you encounter a compile error after a patch, fix it before moving on.
- After Phase 1 is fully done, run `npm run build` to verify the app still compiles.
- Do not add feature functionality while patching — security fixes only.
- If `.env.local` content changes (Task C1), do not print the new key value in responses.
