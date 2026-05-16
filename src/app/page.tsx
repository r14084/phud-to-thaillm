"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

function parseThink(content: string): { think: string; reply: string } {
  const match = content.match(/^<think>([\s\S]*?)<\/think>\s*/);
  if (match) return { think: match[1].trim(), reply: content.slice(match[0].length) };
  return { think: "", reply: content };
}

const ALL_MODELS = [
  { id: "openthaigpt", label: "OpenThaiGPT", by: "AIEAT",   toolSupport: false, pptxSupport: false },
  { id: "pathumma",    label: "Pathumma",    by: "NECTEC",  toolSupport: true,  pptxSupport: true  },
  { id: "typhoon",     label: "Typhoon",     by: "SCB 10X", toolSupport: true,  pptxSupport: true  },
  { id: "thalle",      label: "THaLLE",      by: "KBTG",    toolSupport: true,  pptxSupport: false },
];

type Mode = "chat" | "xlsx" | "docx" | "pptx";

interface FilePreview {
  mode: "xlsx" | "docx" | "pptx";
  filename: string;
  fileBase64: string;
  headers?: string[];
  rows?: unknown[][];
  sections?: { type: string; text: string; level?: number }[];
  slides?: { title: string; content?: string; bullet_points?: string[] }[];
}

interface Message {
  role: "user" | "assistant";
  content: string;
  filePreview?: FilePreview;
}

const SUGGESTED: Record<Mode, string[]> = {
  chat: [
    "อธิบายเรื่อง AI ให้เข้าใจง่าย",
    "เขียน Python code อ่านไฟล์ CSV",
    "ข้อดีของ LLM ภาษาไทย คืออะไร?",
    "แนะนำที่เที่ยวในกรุงเทพ",
  ],
  xlsx: [
    "รายงานยอดขาย: สินค้า จำนวน ราคา 5 แถว",
    "ตารางติดตามงบประมาณรายเดือนแบ่งตามหมวดหมู่",
    "รายชื่อพนักงาน: ชื่อ ตำแหน่ง เงินเดือน",
    "ตารางติดตามโปรเจกต์พร้อมสถานะงาน",
  ],
  docx: [
    "ข้อเสนอโปรเจกต์พร้อมบทนำและไทม์ไลน์",
    "เทมเพลตบันทึกการประชุม",
    "เอกสารข้อกำหนดทางเทคนิค",
    "รายงานธุรกิจพร้อมบทสรุปผู้บริหาร",
  ],
  pptx: [
    "นำเสนอ AI ในประเทศไทย 5 สไลด์",
    "พรีเซนต์แผนธุรกิจ Startup 6 สไลด์",
    "สไลด์รายงานผลประจำไตรมาส",
    "นำเสนอแนะนำบริษัทพร้อม Mission และ Vision",
  ],
};

const MODE_META: Record<Mode, { icon: string; label: string; color: string; btnClass: string; chipClass: string; tabClass: string }> = {
  chat: { icon: "💬", label: "Chat", color: "blue",   btnClass: "bg-blue-600 hover:bg-blue-700 active:bg-blue-800",     chipClass: "bg-blue-100 text-blue-700",     tabClass: "bg-blue-100 text-blue-700"   },
  xlsx: { icon: "📊", label: "XLSX", color: "green",  btnClass: "bg-green-600 hover:bg-green-700 active:bg-green-800",   chipClass: "bg-green-100 text-green-700",   tabClass: "bg-green-100 text-green-700" },
  docx: { icon: "📄", label: "DOCX", color: "indigo", btnClass: "bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800", chipClass: "bg-indigo-100 text-indigo-700", tabClass: "bg-indigo-100 text-indigo-700"},
  pptx: { icon: "📑", label: "PPTX", color: "orange", btnClass: "bg-orange-500 hover:bg-orange-600 active:bg-orange-700", chipClass: "bg-orange-100 text-orange-700", tabClass: "bg-orange-100 text-orange-700"},
};

const MODE_PLACEHOLDER: Record<Mode, string> = {
  chat: "พิมพ์ข้อความ... (Enter ส่ง, Shift+Enter ขึ้นบรรทัดใหม่)",
  xlsx: "บอกว่าต้องการตารางแบบไหน เช่น 'รายงานยอดขาย มีคอลัมน์ สินค้า จำนวน ราคา 5 แถว'",
  docx: "บอกว่าต้องการเอกสารแบบไหน เช่น 'ข้อเสนอโปรเจกต์ มีบทนำ วัตถุประสงค์ และไทม์ไลน์'",
  pptx: "บอกว่าต้องการ Presentation แบบไหน เช่น 'นำเสนอ AI ในประเทศไทย 5 สไลด์'",
};

function downloadFile(filename: string, base64: string, mime: string) {
  const a = document.createElement("a");
  a.href = `data:${mime};base64,${base64}`;
  a.download = filename;
  a.click();
}

function XlsxPreview({ headers, rows, filename, fileBase64 }: {
  headers: string[];
  rows: unknown[][];
  filename: string;
  fileBase64: string;
}) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-green-200">
        <table className="text-sm min-w-full">
          <thead className="bg-green-50">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="px-3 py-2 text-left font-semibold text-green-800 border-b border-green-200 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-green-50/40"}>
                {(row as unknown[]).map((cell, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-gray-700 border-b border-gray-100 whitespace-nowrap">
                    {String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={() => downloadFile(filename, fileBase64, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        ⬇ Download {filename}
      </button>
    </div>
  );
}

function PptxPreview({ slides, filename, fileBase64 }: {
  slides: { title: string; content?: string; bullet_points?: string[] }[];
  filename: string;
  fileBase64: string;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
        {slides.map((slide, i) => (
          <div key={i} className="rounded-xl border border-orange-200 overflow-hidden shadow-sm">
            {/* Slide title bar */}
            <div className="bg-[#1E3A5F] px-4 py-2 flex items-center gap-2">
              <span className="text-xs font-bold text-white/60 shrink-0">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-sm font-bold text-white leading-snug">{slide.title}</span>
            </div>
            {/* Slide body */}
            <div className="bg-white px-4 py-2.5 min-h-[3rem]">
              {slide.bullet_points?.length ? (
                <ul className="space-y-0.5">
                  {slide.bullet_points.map((b, bi) => (
                    <li key={bi} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="text-orange-400 mt-0.5 shrink-0">▸</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              ) : slide.content ? (
                <p className="text-sm text-gray-600 leading-relaxed">{slide.content}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className="font-medium">{slides.length} slides</span>
        <span>·</span>
        <span>16:9</span>
      </div>
      <button
        onClick={() => downloadFile(filename, fileBase64, "application/vnd.openxmlformats-officedocument.presentationml.presentation")}
        className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        ⬇ Download {filename}
      </button>
    </div>
  );
}

function DocxPreview({ sections, filename, fileBase64 }: {
  sections: { type: string; text: string; level?: number }[];
  filename: string;
  fileBase64: string;
}) {
  return (
    <div className="space-y-3">
      <div className="border border-blue-200 rounded-lg bg-white px-5 py-4 space-y-2 max-h-72 overflow-y-auto">
        {sections.map((s, i) => {
          if (s.type === "heading") {
            const lvl = s.level ?? 1;
            const cls =
              lvl === 1 ? "text-xl font-bold text-gray-900 mt-3 first:mt-0" :
              lvl === 2 ? "text-lg font-semibold text-gray-800 mt-2" :
                          "text-base font-semibold text-gray-700 mt-1";
            return <p key={i} className={cls}>{s.text}</p>;
          }
          return <p key={i} className="text-sm text-gray-600 leading-relaxed">{s.text}</p>;
        })}
      </div>
      <button
        onClick={() => downloadFile(filename, fileBase64, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        ⬇ Download {filename}
      </button>
    </div>
  );
}

export default function ChatPage() {
  const [mode, setMode]         = useState<Mode>("chat");
  const [model, setModel]       = useState("pathumma");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const visibleModels =
    mode === "chat" ? ALL_MODELS :
    mode === "pptx" ? ALL_MODELS.filter((m) => m.pptxSupport) :
    ALL_MODELS.filter((m) => m.toolSupport);

  useEffect(() => {
    if (!visibleModels.find((m) => m.id === model)) {
      setModel(visibleModels[0].id);
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    const next: Message[] = [...messages, { role: "user", content: msg }];
    setMessages(next);
    setInput("");
    setLoading(true);

    if (mode === "chat") {
      setMessages([...next, { role: "assistant", content: "" }]);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, model }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: updated[updated.length - 1].content + chunk,
          };
          return updated;
        });
      }
    } else {
      setMessages([...next, { role: "assistant", content: "" }]);

      const res = await fetch("/api/create-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, model, mode }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: `Error: ${data.text || data.error || "Unknown error"}`,
          };
          return updated;
        });
      } else {
        const preview: FilePreview = {
          mode,
          filename: data.filename,
          fileBase64: data.fileBase64,
          ...(mode === "xlsx" ? { headers: data.preview.headers, rows: data.preview.rows } :
              mode === "pptx" ? { slides: data.preview.slides } :
                                { sections: data.preview.sections }),
        };
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: "", filePreview: preview };
          return updated;
        });
      }
    }

    setLoading(false);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const meta = MODE_META[mode];
  const currentModel = visibleModels.find((m) => m.id === model);

  return (
    <div className="flex flex-col h-screen bg-gray-50">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex items-center gap-3 shadow-sm flex-shrink-0">
        {/* Brand */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-2xl leading-none shrink-0">🇹🇭</span>
          <div className="leading-tight min-w-0">
            <h1 className="font-bold text-base sm:text-lg text-gray-900 truncate">ThaiLLM Chat</h1>
            <p className="text-xs text-gray-400 hidden sm:block">
              Powered by{" "}
              <a href="https://thaillm.or.th" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-gray-600 transition-colors">
                thaillm.or.th
              </a>
              {" "}· Design by{" "}
              <a href="https://www.phud.me" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-gray-600 transition-colors">
                phud.me
              </a>
              {" "}·{" "}
              <a href="https://github.com/r14084/phud-to-thaillm" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-gray-600 transition-colors">
                github
              </a>
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="text-sm text-gray-400 hover:text-red-500 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-lg px-2.5 py-1.5 transition-colors hidden sm:block"
            >
              ล้างแชท
            </button>
          )}

          {/* Mode indicator chip */}
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full hidden sm:block ${meta.chipClass}`}>
            {meta.icon} {meta.label} mode
          </span>

          {/* Model selector */}
          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5">
            <span className="text-xs text-gray-400 font-medium hidden md:block">โมเดล</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="text-sm font-semibold text-gray-700 bg-transparent border-0 focus:outline-none cursor-pointer max-w-[160px] sm:max-w-none"
            >
              {visibleModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.by}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto py-5 sm:py-6">
        <div className="max-w-3xl mx-auto px-3 sm:px-6 space-y-5">

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="text-center mt-8 sm:mt-14">
              <div className="text-5xl sm:text-6xl mb-3">{meta.icon}</div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-1">
                {mode === "chat" ? "ยินดีต้อนรับสู่ ThaiLLM Chat" :
                 mode === "xlsx" ? "สร้างไฟล์ Excel (XLSX)" :
                 mode === "docx" ? "สร้างเอกสาร Word (DOCX)" :
                                   "สร้าง PowerPoint (PPTX)"}
              </h2>
              {mode === "chat" ? (
                <p className="text-gray-500 text-sm sm:text-base mb-1">
                  กำลังใช้งาน{" "}
                  <span className="font-semibold text-gray-700">{currentModel?.label}</span>
                  <span className="text-gray-400"> โดย {currentModel?.by}</span>
                </p>
              ) : (
                <p className="text-gray-500 text-sm sm:text-base mb-1">
                  บอก AI ว่าต้องการไฟล์แบบไหน — ระบบจะสร้างให้ดาวน์โหลดได้ทันที
                </p>
              )}
              <p className="text-xs sm:text-sm text-gray-400 mb-6 sm:mb-8">
                {mode === "chat" ? "เลือกโมเดลด้านบน แล้วเริ่มพิมพ์ได้เลย" : `ใช้งานโมเดล ${currentModel?.label} โดย ${currentModel?.by}`}
              </p>

              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
                {mode === "chat" ? "ลองถามว่า..." : "ลองสั่งว่า..."}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg mx-auto">
                {SUGGESTED[mode].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => send(prompt)}
                    className={`text-left text-sm bg-white hover:bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 transition-all hover:shadow-sm ${
                      mode === "chat"  ? "text-gray-600 hover:border-blue-300 hover:text-blue-700" :
                      mode === "xlsx"  ? "text-gray-600 hover:border-green-300 hover:text-green-700" :
                      mode === "pptx"  ? "text-gray-600 hover:border-orange-300 hover:text-orange-700" :
                                         "text-gray-600 hover:border-indigo-300 hover:text-indigo-700"
                    }`}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message bubbles */}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex items-start gap-2.5 sm:gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {/* AI avatar */}
              {msg.role === "assistant" && (
                <div className="flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold shadow-sm mt-0.5">
                  AI
                </div>
              )}

              {/* Bubble */}
              <div
                className={`max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-3 text-base sm:text-lg shadow-sm ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-tr-sm"
                    : "bg-white text-gray-800 rounded-tl-sm border border-gray-200"
                }`}
              >
                {msg.filePreview ? (
                  msg.filePreview.mode === "xlsx" ? (
                    <XlsxPreview
                      headers={msg.filePreview.headers!}
                      rows={msg.filePreview.rows!}
                      filename={msg.filePreview.filename}
                      fileBase64={msg.filePreview.fileBase64}
                    />
                  ) : msg.filePreview.mode === "pptx" ? (
                    <PptxPreview
                      slides={msg.filePreview.slides!}
                      filename={msg.filePreview.filename}
                      fileBase64={msg.filePreview.fileBase64}
                    />
                  ) : (
                    <DocxPreview
                      sections={msg.filePreview.sections!}
                      filename={msg.filePreview.filename}
                      fileBase64={msg.filePreview.fileBase64}
                    />
                  )
                ) : msg.content ? (
                  msg.role === "assistant" ? (
                    (() => {
                      const { think, reply } = parseThink(msg.content);
                      return (
                        <div className="space-y-2">
                          {think && (
                            <details className="text-sm text-gray-400 border border-gray-100 rounded-lg px-3 py-1.5 bg-gray-50">
                              <summary className="cursor-pointer select-none font-medium">
                                💭 Thinking...
                              </summary>
                              <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{think}</p>
                            </details>
                          )}
                          <div className="tight-prose prose prose-base sm:prose-lg max-w-none prose-pre:bg-gray-100 prose-pre:text-gray-800 prose-code:bg-gray-100 prose-code:px-1 prose-code:rounded">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{reply}</ReactMarkdown>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <span className="whitespace-pre-wrap leading-relaxed">{msg.content}</span>
                  )
                ) : (
                  <span className="inline-flex gap-1 items-center text-blue-300">
                    <span className="animate-bounce">●</span>
                    <span className="animate-bounce [animation-delay:0.15s]">●</span>
                    <span className="animate-bounce [animation-delay:0.3s]">●</span>
                  </span>
                )}
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input Area ── */}
      <div className="bg-white border-t border-gray-200 px-3 sm:px-6 pt-2 pb-2.5 flex-shrink-0">
        <div className="max-w-3xl mx-auto space-y-1.5">

          {/* Mode tabs */}
          <div className="flex items-center gap-1">
            {(["chat", "xlsx", "docx", "pptx"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors ${
                  mode === m ? MODE_META[m].tabClass : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {MODE_META[m].icon}
                <span className="hidden sm:inline">{MODE_META[m].label}</span>
              </button>
            ))}
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="ml-auto text-xs text-gray-400 hover:text-red-500 transition-colors sm:hidden"
              >
                ล้างแชท
              </button>
            )}
          </div>

          {/* Textarea + Send */}
          <div className={`flex gap-2 items-center bg-white border rounded-xl px-3 py-1.5 shadow-sm transition-all focus-within:ring-2 ${
            mode === "chat"  ? "border-gray-300 focus-within:border-blue-400   focus-within:ring-blue-100"   :
            mode === "xlsx"  ? "border-gray-300 focus-within:border-green-400  focus-within:ring-green-100"  :
            mode === "pptx"  ? "border-gray-300 focus-within:border-orange-400 focus-within:ring-orange-100" :
                               "border-gray-300 focus-within:border-indigo-400 focus-within:ring-indigo-100"
          }`}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={MODE_PLACEHOLDER[mode]}
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-gray-900 focus:outline-none max-h-40 overflow-y-auto placeholder-gray-400 leading-relaxed"
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              className={`flex-shrink-0 text-white rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${meta.btnClass}`}
            >
              {mode === "chat" ? "ส่ง" : `สร้าง ${meta.label}`}
            </button>
          </div>

          {/* Footer hint */}
          <p className="text-center text-xs text-gray-400 leading-none">
            Rate limit: 30 req/min
            {mode === "pptx" && (
              <span className="ml-1.5 text-amber-500">· PPTX mode: Typhoon / Pathumma เท่านั้น</span>
            )}
            {(mode === "xlsx" || mode === "docx") && (
              <span className="ml-1.5 text-amber-500">· โหมดไฟล์ต้องใช้ Typhoon / Pathumma / THaLLE</span>
            )}
          </p>
        </div>
      </div>

    </div>
  );
}
