# ThaiLLM Chat

แอปพลิเคชันแชทสำหรับโมเดลภาษาไทย (Thai LLM) พร้อมระบบสร้างไฟล์ Office ด้วย AI รองรับการสนทนาแบบเรียลไทม์และการสร้างเอกสาร Excel, Word, PowerPoint อัตโนมัติ

---

## คุณสมบัติหลัก

- **โหมดแชท** — สนทนากับโมเดลภาษาไทยแบบ Streaming เรียลไทม์
- **โหมด XLSX** — สร้างไฟล์ Excel พร้อมแสดงตัวอย่างและดาวน์โหลดได้ทันที
- **โหมด DOCX** — สร้างเอกสาร Word พร้อมแสดงตัวอย่างและดาวน์โหลดได้ทันที
- **โหมด PPTX** — สร้างงานนำเสนอ PowerPoint พร้อมแสดงตัวอย่างและดาวน์โหลดได้ทันที
- **รองรับหลายโมเดล** — เลือกใช้งานโมเดลภาษาไทยได้ 4 โมเดล
- **แสดง Reasoning** — แสดงขั้นตอนการคิดของโมเดลแบบพับเก็บได้
- **Rate Limiting** — จำกัด 30 คำขอ/นาที ต่อ IP เพื่อป้องกันการใช้งานเกินขีดจำกัด

---

## โมเดลที่รองรับ

| โมเดล | ผู้พัฒนา | แชท | XLSX | DOCX | PPTX |
|-------|---------|:---:|:----:|:----:|:----:|
| OpenThaiGPT | AIEAT | ✓ | | | |
| Pathumma | NECTEC | ✓ | ✓ | ✓ | ✓ |
| Typhoon | SCB 10X | ✓ | ✓ | ✓ | ✓ |
| THaLLE | KBTG | ✓ | ✓ | ✓ | |

---

## เทคโนโลยีที่ใช้

- **Frontend:** Next.js 16, React 19, Tailwind CSS 4, TypeScript
- **สร้างไฟล์:** ExcelJS (XLSX), docx (DOCX), PptxGenJS (PPTX)
- **Markdown:** react-markdown, remark-gfm, rehype-sanitize
- **LLM API:** OpenAI SDK (เชื่อมต่อกับ ThaiLLM API)
- **ฟอนต์:** Noto Sans Thai + Geist Mono

---

## การติดตั้งและใช้งาน

### 1. ติดตั้ง Dependencies

```bash
npm install
```

### 2. ตั้งค่า Environment Variables

สร้างไฟล์ `.env.local` และกำหนดค่าดังนี้:

```env
THAILLM_API_KEY=your_api_key_here
THAILLM_BASE_URL=https://thaillm.or.th/api/v1
```

> `THAILLM_BASE_URL` มีค่าเริ่มต้นเป็น `https://thaillm.or.th/api/v1` หากไม่ระบุ

### 3. รันในโหมดพัฒนา

```bash
npm run dev
```

เปิดเบราว์เซอร์ที่ [http://localhost:3000](http://localhost:3000)

### 4. Build สำหรับ Production

```bash
npm run build
npm run start
```

---

## โครงสร้างโปรเจกต์

```
src/
├── app/
│   ├── page.tsx              # UI หลักของแอป
│   ├── layout.tsx            # Layout พร้อมฟอนต์ภาษาไทย
│   ├── globals.css           # Tailwind + custom styles
│   └── api/
│       ├── chat/
│       │   └── route.ts      # Endpoint สำหรับแชท (SSE Streaming)
│       └── create-file/
│           └── route.ts      # Endpoint สร้างไฟล์ Office
├── proxy.ts                  # Rate limiting middleware
next.config.ts                # Security headers + Turbopack
docs/                         # เอกสาร Security Audit
```

---

## API Endpoints

### `POST /api/chat`

ส่งข้อความและรับการตอบกลับแบบ Streaming

```json
{
  "messages": [{ "role": "user", "content": "สวัสดี" }],
  "model": "pathumma"
}
```

ตอบกลับเป็น Server-Sent Events (SSE) text stream

### `POST /api/create-file`

สร้างไฟล์ Office ด้วย AI

```json
{
  "messages": [{ "role": "user", "content": "สร้างตารางข้อมูลพนักงาน" }],
  "model": "typhoon",
  "mode": "xlsx"
}
```

ตอบกลับ:

```json
{
  "filename": "ตารางพนักงาน.xlsx",
  "fileBase64": "...",
  "preview": "..."
}
```

---

## ความปลอดภัย

- Security Headers ครบชุด (CSP, X-Frame-Options, HSTS ฯลฯ)
- Rate Limiting: 30 คำขอ/นาที ต่อ IP
- ตรวจสอบ Input: สูงสุด 50 ข้อความ, 10,000 ตัวอักษร/ข้อความ
- XSS Protection ผ่าน rehype-sanitize
- Allowlist validation สำหรับชื่อโมเดลและโหมด

---

## การ Deploy บน Vercel

```bash
npx vercel deploy
```

อย่าลืมตั้งค่า Environment Variables ใน Vercel Dashboard:
- `THAILLM_API_KEY`
- `THAILLM_BASE_URL` (ถ้าต้องการเปลี่ยน endpoint)
