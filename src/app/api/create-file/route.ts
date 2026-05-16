import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import PptxGenJS from "pptxgenjs";

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

function sanitizeFilename(raw: string, fallback: string, ext: string): string {
  const cleaned =
    (raw || fallback)
      .replace(/[^a-zA-Z0-9ก-๙._\- ]/g, "_")
      .replace(/\.{2,}/g, "_")
      .slice(0, 100)
      .trim() || fallback;
  const base = cleaned.replace(/\.[^.]+$/, "") || fallback.replace(/\.[^.]+$/, "");
  return `${base}.${ext}`;
}

const XLSX_TOOL = {
  type: "function",
  function: {
    name: "create_xlsx",
    description: "Create an Excel (.xlsx) spreadsheet file with tabular data.",
    parameters: {
      type: "object",
      properties: {
        filename:   { type: "string", description: "Output filename e.g. report.xlsx" },
        sheet_name: { type: "string", description: "Sheet tab name" },
        headers:    { type: "array",  items: { type: "string" }, description: "Column header names" },
        rows:       { type: "array",  items: { type: "array"  }, description: "Data rows" },
      },
      required: ["filename", "headers", "rows"],
    },
  },
};

const PPTX_TOOL = {
  type: "function",
  function: {
    name: "create_pptx",
    description: "Create a PowerPoint (.pptx) presentation with multiple slides.",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Output filename e.g. presentation.pptx" },
        slides: {
          type: "array",
          description: "List of slides",
          items: {
            type: "object",
            properties: {
              title:         { type: "string", description: "Slide title" },
              content:       { type: "string", description: "Main body text for the slide" },
              bullet_points: { type: "array", items: { type: "string" }, description: "Optional bullet point list (replaces content if provided)" },
            },
            required: ["title"],
          },
        },
      },
      required: ["filename", "slides"],
    },
  },
};

const DOCX_TOOL = {
  type: "function",
  function: {
    name: "create_docx",
    description: "Create a Word (.docx) document with headings and paragraphs.",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Output filename e.g. report.docx" },
        sections: {
          type: "array",
          description: "Document content as a list of headings and paragraphs",
          items: {
            type: "object",
            properties: {
              type:  { type: "string", enum: ["heading", "paragraph"] },
              text:  { type: "string" },
              level: { type: "integer", minimum: 1, maximum: 3, description: "Heading level 1–3 (only for type=heading)" },
            },
            required: ["type", "text"],
          },
        },
      },
      required: ["filename", "sections"],
    },
  },
};

const PY_TOOL = {
  type: "function",
  function: {
    name: "create_py",
    description: "Create a Python (.py) source file containing complete, runnable code.",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Output filename ending in .py, e.g. script.py" },
        code:     { type: "string", description: "The full Python source code to write to the file" },
      },
      required: ["filename", "code"],
    },
  },
};

type Section  = { type: string; text: string; level?: number };
type Slide    = { title: string; content?: string; bullet_points?: string[] };

const HEADING_LEVELS: Record<number, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
};

const TOOL_NAME: Record<string, string> = {
  xlsx: "create_xlsx",
  pptx: "create_pptx",
  docx: "create_docx",
  py:   "create_py",
};

const SYSTEM_PROMPT: Record<string, string> = {
  xlsx: "You are a spreadsheet assistant. The user will describe a spreadsheet. You MUST call the create_xlsx tool. Do not reply in plain text.",
  pptx: "You are a presentation assistant. The user will describe a slide deck. You MUST call the create_pptx tool. Do not reply in plain text.",
  docx: "You are a document assistant. The user will describe a Word document. You MUST call the create_docx tool. Do not reply in plain text.",
  py:   "You are a Python coding assistant. The user will describe what they want. You MUST call the create_py tool with complete, runnable Python code and a filename ending in .py. Do not reply in plain text.",
};

export async function POST(req: NextRequest) {
  const { messages, model, mode } = await req.json();

  const VALID_MODES = new Set(["xlsx", "pptx", "docx", "py"]);
  if (!VALID_MODES.has(mode)) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  const VALID_MODELS = new Set(["openthaigpt", "pathumma", "typhoon", "thalle"]);
  const safeModel = VALID_MODELS.has(model) ? model : "openthaigpt";

  if (mode === "py" && safeModel !== "typhoon") {
    return NextResponse.json({ error: "Python mode is only available on Typhoon" }, { status: 400 });
  }

  if (!validateMessages(messages)) {
    return NextResponse.json({ error: "Invalid messages payload" }, { status: 400 });
  }

  const tool =
    mode === "xlsx" ? XLSX_TOOL :
    mode === "pptx" ? PPTX_TOOL :
    mode === "docx" ? DOCX_TOOL :
                      PY_TOOL;

  const upstream = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({
      model: safeModel,
      messages: [{ role: "system", content: SYSTEM_PROMPT[mode] }, ...messages],
      tools: [tool],
      tool_choice: { type: "function", function: { name: TOOL_NAME[mode] } },
      max_tokens: mode === "py" ? 4096 : 1024,
      stream: false,
    }),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    console.error("[upstream error]", upstream.status, text);
    return NextResponse.json({ error: "Upstream API error" }, { status: 502 });
  }

  const body = await upstream.json();
  const message = body.choices?.[0]?.message;
  let toolCalls = message?.tool_calls;

  // Some models emit <tool_call>{...}</tool_call> in the text content instead of tool_calls

  if (!toolCalls?.length && message?.content) {
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
  }

  if (!toolCalls?.length) {
    return NextResponse.json(
      { error: "Model did not use the tool", text: message?.content ?? "" },
      { status: 422 }
    );
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCalls[0].function.arguments);
  } catch {
    return NextResponse.json({ error: "Invalid tool arguments from model" }, { status: 500 });
  }

  if (mode === "pptx") {
    const slides   = args.slides   as Slide[];
    const filename = sanitizeFilename(args.filename as string, "presentation.pptx", "pptx");

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_16x9";

    for (const slide of slides) {
      const s = pptx.addSlide();

      // Title bar (top strip)
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 1.2, fill: { color: "1E3A5F" } });
      s.addText(slide.title, {
        x: 0.3, y: 0.1, w: 9.4, h: 1.0,
        fontSize: 24, bold: true, color: "FFFFFF", valign: "middle",
      });

      const bullets = slide.bullet_points?.length ? slide.bullet_points : null;
      const body    = slide.content ?? "";

      if (bullets) {
        const items = bullets.map((b) => ({ text: b, options: { bullet: true, fontSize: 18, color: "333333" } }));
        s.addText(items, { x: 0.5, y: 1.4, w: 9.0, h: 4.8, valign: "top" });
      } else if (body) {
        s.addText(body, { x: 0.5, y: 1.4, w: 9.0, h: 4.8, fontSize: 18, color: "333333", valign: "top", wrap: true });
      }
    }

    const buf = await pptx.write({ outputType: "nodebuffer" }) as Buffer;

    return NextResponse.json({
      filename,
      fileBase64: buf.toString("base64"),
      preview: { slides },
    });
  }

  if (mode === "xlsx") {
    const headers  = args.headers   as string[];
    const rows     = args.rows      as unknown[][];
    const sheet    = (args.sheet_name as string) || "Sheet1";
    const filename = sanitizeFilename(args.filename as string, "output.xlsx", "xlsx");

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

  if (mode === "docx") {
    const sections = args.sections as Section[];
    const filename = sanitizeFilename(args.filename as string, "output.docx", "docx");

    const children = sections.map((s) => {
      if (s.type === "heading") {
        return new Paragraph({
          text: s.text,
          heading: HEADING_LEVELS[s.level ?? 1] ?? HeadingLevel.HEADING_1,
        });
      }
      return new Paragraph({ children: [new TextRun(s.text)] });
    });

    const doc = new Document({ sections: [{ children }] });
    const buf = await Packer.toBuffer(doc);

    return NextResponse.json({
      filename,
      fileBase64: buf.toString("base64"),
      preview: { sections },
    });
  }

  // py
  const code     = (args.code as string) ?? "";
  const filename = sanitizeFilename(args.filename as string, "script.py", "py");
  return NextResponse.json({
    filename,
    fileBase64: Buffer.from(code, "utf8").toString("base64"),
    preview: { code },
  });
}
