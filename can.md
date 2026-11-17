# EduPlan AI — เอกสารสรุปความสามารถ การทำงาน โครงสร้างไฟล์ และสถาปัตยกรรมทั้งระบบ
> **เอกสารเวอร์ชัน:** 3.0.0 (ปรับปรุงล่าสุด: พฤศจิกายน 2026)  
> **ระบบ:** EduPlan AI Suite (ระบบนิเวศช่วยจัดการเรียนรู้อัจฉริยะ ออกแบบแผนการสอน เกณฑ์รูบริก โครงการระยะยาว และจัดการห้องเรียน)  
> **เทคโนโลยีหลัก:** TypeScript, Vite (Multi-Page Application: MPA), Tailwind CSS, Dexie.js (IndexedDB), SheetJS (xlsx), Mammoth.js, Docx.js, Google Identity Services (GIS), Cloudflare Worker (Edge AI Gateway)  
> **สถาปัตยกรรม:** 100% Client-Side Heavy (Offline-First / Zero-Database Backend) + Google Cloud OAuth / Drive Sheets Sync + Serverless Edge AI Gateway

---

## 1. ภาพรวมและสถาปัตยกรรมระบบ (System Overview & Architecture)

EduPlan AI ได้รับการยกระดับจากระบบสร้างแผนการสอน สู่การเป็น **"All-in-One Education Ecosystem"** สำหรับครูไทยยุคใหม่ ครอบคลุม 4 เสาหลัก:
1. **การออกแบบการสอนตามเกณฑ์ วPA (Lesson Plan Generator - 11 หัวข้อ)**
2. **การวัดและประเมินผลเชิงคุณภาพ (Rubric Score Generator - K-P-A Descriptors)**
3. **การออกแบบหลักสูตรและแผนการสอนระยะยาว (Course Syllabus & Long-Term Plan Generator - 5 ส่วนมาตรฐาน)**
4. **ระบบจัดการห้องเรียน เช็คชื่อ และติดตามงาน (EduPlan Class - Offline-First + Google Sheets Sync)**

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 ผู้ใช้งาน (Browser Client)                             │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
        ┌───────────────────────────────────┼──────────────────────────────────┐
        ▼                                   ▼                                  ▼
┌───────────────────────┐       ┌───────────────────────┐       ┌────────────────────────┐
│  หน้าหลัก (Home Hub)  │       │  โครงการระยะยาว (Syllabus) │   │ EduPlan Class (เบต้า)  │
│  - 2x2 Cards Grid     │       │  - Wizard 10 ขั้นตอน   │       │ (classroom.html - MPA) │
│  - แผน / รูบริก / โครงการ │   │  - พรีวิว A4 5 ส่วน    │       │ - คลังห้องเรียน (Hub)   │
│  - ลิงก์สู่ Classroom │       │  - ส่งออก Word 9000DXA│       │ - เช็คชื่อ (Attendance) │
│  - ตั้งค่า BYOK / Presets│    │  - Rich-Text Clipboard│       │ - ติดตามงาน (Assignment)│
└───────────┬───────────┘       └───────────┬───────────┘       │ - Master Roster แก้ไข  │
            │                               │                   │ - Multi-Color Mapper   │
            ▼                               ▼                   │ - Sandbox Tour 23 สเต็ป│
┌───────────────────────┐       ┌───────────────────────┐       └───────────┬────────────┘
│  แผนการสอน วPA 11 ข้อ │       │  เกณฑ์รูบริก (Rubric) │                   │
│  - Wizard / All-in-One│       │  - สกัดไฟล์ .docx     │                   │
│  - curriculum.json    │       │  - K-P-A Descriptors  │                   │
│  - A4 Preview / Edit  │       │  - ตารางเกณฑ์ไร้ขอบ   │                   │
└───────────┬───────────┘       └───────────┬───────────┘                   │
            │                               │                               │
            └───────────────────────────────┼───────────────────────────────┘
                                            │
    ┌───────────────────────────────────────┴───────────────────────────────────────┐
    ▼                                                                               ▼
[ AI Gateway Layer ]                                                    [ Local Storage & Cloud Sync ]
├── โหมด BYOK: ยิงตรง Gemini API                                        ├── Dexie IndexedDB (Local DB)
└── โหมด Shared: ผ่าน Cloudflare Worker Proxy                           ├── SheetJS (.xlsx Import/Export)
    ├── Multi-Key Failover 1-10 (0ms wait)                              ├── Google Identity Services (GIS)
    ├── Waterfall Model Cascading (3.8 -> 3.5 -> 2.0)                   ├── Google Drive AppData (Snapshot)
    └── Dynamic Model Control via Cloudflare KV                         └── Google Sheets (Real-time Sync)
```

---

## 2. เจาะลึก 4 โมดูลหลักของ EduPlan AI Suite

### 2.1 หน้าหลักและศูนย์รวมระบบ (Home Hub — 2x2 Grid Layout)
- **การจัดวางแบบ Responsive 2x2 Cards:**
  - **แถวที่ 1:** `[ สร้างแผนการจัดการเรียนรู้ (สีฟ้า) ]` — แผนการสอน 11 หัวข้อ วPA
  - **แถวที่ 1:** `[ สร้างเกณฑ์รูบริกสกอร์ (สีม่วง) ]` — สังเคราะห์รูบริก K-P-A จากไฟล์ Word
  - **แถวที่ 2:** `[ สร้างโครงการจัดการเรียนรู้ (สีเขียวมรกต) ]` — โครงสร้างรายวิชาและแผนระยะยาว 5 ส่วน
  - **แถวที่ 2:** `[ EduPlan Class เบต้า (สีคราม Indigo) ]` — ระบบจัดการห้องเรียน เช็คชื่อ และส่งงาน
- **ระบบนำทางและแถบเครื่องมือ:**
  - **ปุ่ม Preset:** ภาษาไทย ป.1, คณิต ป.1, วิทย์ ม.1, ปฐมวัย อ.2
  - **ปุ่มตั้งค่า (⚙️):** บริหารจัดการ Gemini API Key (BYOK) พร้อม Carousel ไกด์ 4 ขั้นตอน และรหัสผ่านเข้า Admin Panel

---

### 2.2 โมดูลที่ 1: ระบบสร้างแผนการจัดการเรียนรู้ (Lesson Plan Generator — วPA 11 หัวข้อ)
- **Dual-Mode Input:** สลับระหว่าง **Step-by-Step Wizard (10 ขั้นตอน)** กับ **All-in-One Form (หน้าเดียว)** โดยที่ Reactive State ซิงก์กัน 100%
- **ฐานข้อมูลหลักสูตรสมบูรณ์ (`curriculum.json`):** ครอบคลุม 8 กลุ่มสาระ ป.1–ม.6 (2,598 ตัวชี้วัด) และพัฒนาการ 4 ด้านปฐมวัย พร้อมระบบ Multi-select Search
- **AI Acceleration:** ปุ่มลัด `⚡ AI Draft K-P-A` ร่างจุดประสงค์ไวใน 2–3 วินาที และมี 9 รูปแบบการสอนมาตรฐาน (Active Learning, 5E, STEM, PBL ฯลฯ)
- **Interactive A4 Preview:**
  - แสดงผลด้วยฟอนต์ราชการ `TH SarabunPSK` (16pt เนื้อหา / 18pt หนาหัวข้อ)
  - ครบ 11 หัวข้อมาตรฐานกระทรวงฯ รวมตารางวัดผล 5 คอลัมน์
  - **Contenteditable:** พิมพ์แก้ข้อความสดบนหน้าเว็บได้ทุกจุด
  - **AI Refine Box:** สั่งปรับปรุงเนื้อหาเฉพาะส่วน เช่น ขอเพิ่มเกม หรือเปลี่ยนใบงาน
  - **ส่งออกสมบูรณ์แบบ:** คัดลอก Rich-Text HTML ลง Word, พิมพ์ PDF ผ่าน `@media print`, และดาวน์โหลดไฟล์ Word `.docx` กว้าง 9,000 DXA ขอบ 1 นิ้ว

---

### 2.3 โมดูลที่ 2: ระบบสร้างเกณฑ์รูบริกสกอร์ (Rubric Score Generator)
- **Zero-Server Extraction:** สกัดข้อความจากแผนการสอน `.docx` บนเบราว์เซอร์ด้วย `mammoth.js` 100% ไฟล์ไม่หลุดออกนอกเครื่อง
- **Scale Customization:** เลือกระดับคุณภาพได้ 3 แบบ: 3 ระดับ, 4 ระดับ (มาตรฐาน วPA), หรือ 5 ระดับ
- **AI Descriptors Synthesis:** สังเคราะห์พฤติกรรมบ่งชี้ที่สังเกตได้จริง แยกมิติ K (ความรู้), P (ทักษะ), A (เจตคติ)
- **ตารางส่งออกคู่ขนาน:**
  - ตารางเกณฑ์รูบริก (Rubric Criteria)
  - ตารางเกณฑ์การตัดสินระดับคุณภาพ (Scoring Guide) แบบไร้เส้นขอบตามระเบียบงานสารบรรณ

---

### 2.4 โมดูลที่ 3: ระบบสร้างโครงการจัดการเรียนรู้ / แผนระยะยาว (Course Syllabus Generator)
- **รองรับเอกสารราชการ 5 ส่วนมาตรฐาน:**
  1. คำอธิบายรายวิชา และจุดประสงค์การเรียนรู้ K-P-A
  2. โครงสร้างโครงการจัดการเรียนรู้ระยะยาว (ตาราง 6 คอลัมน์: หน่วยที่, ชื่อหน่วย, ผลการเรียนรู้/ตัวชี้วัด, สาระสำคัญ, เวลา, น้ำหนักคะแนน)
  3. ตารางแผนการจัดการเรียนรู้รายสัปดาห์ (ตาราง 8 คอลัมน์: สัปดาห์, แผนที่, ชื่อหน่วย, เรื่องที่สอน, ตัวชี้วัด, วิธีสอน, สื่อ, คะแนน พร้อมแถวคั่นชื่อแผนสีพื้น `#F1F5F9`)
  4. ตารางวิธีจัดเก็บคะแนน (ระหว่างเรียน 80 / ปลายภาค 20 รวม 100 คะแนน)
  5. ตารางเกณฑ์การตัดสินผลการเรียน (เกรด 4 ถึง 0, ร, มส)
- **UI Card-based Selector & Modal Drawer:**
  - เลือกกลุ่มสาระ 9 กลุ่มด้วยการ์ด Active Visual
  - เลือกมาตรฐานและตัวชี้วัดผ่าน Drawer Modal พร้อมแสดง Badge สรุปจำนวนตัวชี้วัดที่เลือก
- **ระบบคำนวณและเกลี่ยคะแนนอัตโนมัติ:** คำนวณชั่วโมงรวม หน่วยกิต และเกลี่ยคะแนน 100 คะแนนเต็มให้สอดคล้องกับจำนวนหน่วยการเรียนรู้
- **การส่งออกคุณภาพสูง:** จัดการสระลอยและวรรคขาดด้วย `cleanThaiText()` ส่งออกเป็นไฟล์ `.docx` และ Rich-Text HTML

---

### 2.5 โมดูลที่ 4: EduPlan Class (ระบบจัดการห้องเรียน — `classroom.html`)
ระบบบริหารจัดการชั้นเรียนแบบ Offline-First ที่ผสานพลังของ IndexedDB, Excel และ Google Cloud:

#### 1) สถาปัตยกรรมจัดเก็บข้อมูล (Offline-First via Dexie.js)
- ข้อมูลทั้งหมดทำงานบนเบราว์เซอร์ผ่าน IndexedDB ไม่ต้องมี Backend Server ครูใช้งานได้แม้ไม่มีอินเทอร์เน็ต
- โครงสร้าง 7 ตาราง: `rooms`, `students`, `attendance_sessions`, `attendance_records`, `assignments`, `assignment_submissions`, `meta`

#### 2) การนำเข้าและส่งออกข้อมูล (Excel Engine & Smart Column Mapper)
- **นำเข้ารายชื่อได้ 3 วิธี:** พิมพ์รายชื่อเอง, นำเข้าจากไฟล์ Excel (`.xlsx`), หรือเชื่อมต่อ Google Sheet
- **Multi-Color Column Mapper Modal:**
  - แสดงพรีวิวตาราง Excel จริง รองรับเซลล์ที่ผสาน (Merged Cells)
  - คลิกเลือกแถวหัวตาราง (Header Row) ได้อิสระ
  - จับคู่คอลัมน์ด้วย **6 โทนสีเฉพาะตัว** เห็นชัดเจน ไม่สับสน:
    - แถวหัวตาราง (`is-header`): สีน้ำเงิน (`#2563EB`)
    - เลขที่ (`role-number`): สีส้มทอง Amber (`#D97706`)
    - รหัสนักเรียน (`role-code`): สีม่วง Purple (`#9333EA`)
    - ชื่อ-สกุล / ชื่อ (`role-name`): สีเขียว Emerald (`#16A34A`)
    - คำนำหน้า (`role-prefix`): สีฟ้า Cyan (`#0891B2`)
    - นามสกุล (`role-last`): สีชมพู Rose (`#E11D48`)
- **ส่งออก Excel (.xlsx):** สร้างไฟล์ Excel สรุปครบ 3 แท็บ (`รายชื่อนักเรียน`, `การมาเรียน`, `คะแนนเก็บ`) จัดรูปแบบตารางสวยงามพร้อมพิมพ์

#### 3) การเช็คชื่อและการจัดการงาน (Attendance & Assignment Tracking)
- **เช็คชื่อ:** บันทึกรายวัน/รายคาบ, ปุ่มลัด "มาเรียนทั้งหมด", ตัวเลือก "มา / ลา/ขาด / มาสาย" พร้อมสรุปเปอร์เซ็นต์เข้าเรียน Real-time
- **ติดตามงาน:** สร้างชิ้นงาน กำหนดคะแนนเต็ม ตรวจงานรายคน (ส่งแล้ว / ยังไม่ส่ง / คะแนน) พร้อมแถบ Progress Bar สรุปความคืบหน้าของห้อง

#### 4) การแก้ไขข้อมูลห้องเรียนและรายชื่อ (Master Roster & Settings)
- ปรับแต่งข้อมูลวิชา ชั้น ภาคเรียน ปีการศึกษา
- แก้ไข Master Roster: แก้ไขข้อความรายคน, เลื่อนลำดับแถวขึ้น-ลง, ลบ/เพิ่มนักเรียน, และปุ่ม **"เรียงลำดับใหม่"** รันเลขที่ 1–N อัตโนมัติ

#### 5) การเชื่อมต่อ Google Cloud (Zero Secret Leak Architecture)
- **Google Identity Services (GIS):** ล็อกอินด้วย Token Client ฝั่ง Frontend **ไม่มีการใช้ Google Client Secret** ปลอดภัย 100%
- **Google Sheets & Drive Real-Time Sync:**
  - สร้างไฟล์ Google Sheet อัตโนมัติ 3 แท็บ
  - ซิงก์ข้อมูลสองทางแบบ Real-time พร้อม Backup Snapshot (`classroom_snapshot_*.json`) ลงโฟลเดอร์ Google Drive AppData
  - ป้องกัน Formula Injection ด้วย `valueInputOption: 'RAW'`

#### 6) Interactive Sandbox Tour (ระบบสอนใช้งานจำลอง 23 สเต็ป)
- **Spotlight Highlight:** ส่องไฟเฉพาะปุ่มหรือจุดที่กำลังสอน พื้นหลังส่วนอื่นเป็น Overlay มืด
- **Floating Dock:** กล่องคำอธิบายลอยมุมจอ ไม่บังพื้นที่ทำงาน พร้อม Dropdown เลือกข้ามบทได้ 9 หมวด (23 ขั้นตอน)
- **Dummy Sandbox Stage:** ใช้ฉากจำลองในการสาธิตทุกหน้าจอ (เพิ่มห้อง, แมปคอลัมน์, เช็คชื่อ, ตรวจงาน, แก้ไขรายชื่อ) **โดยไม่แตะต้องหรือสร้างขยะลงฐานข้อมูลจริงของครู**

#### 7) Two-Tier TopBar & Contextual Back Navigation
- **บรรทัดที่ 1:** โลโก้และชื่อระบบ `EduPlan Class (เบต้า)`
- **บรรทัดที่ 2 ฝั่งซ้าย:** ปุ่ม `[ย้อนกลับ / กลับหน้าหลัก]` (อยู่ในงาน -> ถอยไปหน้ารวมงาน, อยู่ในห้อง -> ถอยไปคลังห้องเรียน, อยู่ในคลัง -> กลับหน้าหลัก EduPlan AI) + ป้ายสถานะการซิงก์
- **บรรทัดที่ 2 ฝั่งขวา:** ปุ่ม `[ตั้งค่า]` (มีเมนูย่อย วิธีใช้งาน & ซิงก์ข้อมูล) + ปุ่มโปรไฟล์/ล็อกอิน Google + ปุ่มออกจากระบบ

---

## 3. สถาปัตยกรรมความปลอดภัย และระบบ AI (Security & AI Architecture)

### 3.1 Cloudflare Worker AI Edge Gateway (`worker/worker.js`)
- **Tiered Model Routing:**
  - Tier `kpa`: เน้นเบาเร็วพิเศษ (`gemini-3.5-flash-lite` -> `gemini-3.1-flash-lite` -> `gemini-2.5-flash-lite` -> `gemini-2.0-flash` -> `gemini-1.5-flash`)
  - Tier `fast`: สมดุลความเร็วและคุณภาพ (`gemini-3.5-flash` -> `flash-lite` -> `gemini-2.0-flash` -> `gemini-1.5-flash`)
  - Tier `precision`: วิเคราะห์เชิงลึกขั้นสูง (`gemini-3.8-flash` -> `gemini-3.7-flash` -> `gemini-3.6-flash` -> `gemini-3.5-flash` -> fallback)
- **Zero-Wait Multi-Key Failover:** ผูก Environment Variables รองรับ API Key 1 ถึง 10 คีย์ เมื่อติด 429 หรือ 503 สลับคีย์ทันทีใน 0ms
- **Secret Admin Panel (`#admin-modal`):** ปลดล็อกด้วย SHA-256 Hash (`09032547`) เพื่ออ่าน/เขียนคอนฟิกโมเดลลง Cloudflare KV (`CONFIG_KV`) ส่งผลต่อผู้ใช้ทุกคนแบบ Real-time

### 3.2 ความปลอดภัยของข้อมูลและการเชื่อมต่อ Google OAuth
- **ไม่มีการเก็บ Secret บน Git:** ไฟล์ `.env` ถูกกันใน `.gitignore` อย่างเคร่งครัด
- **OAuth 2.0 Web Client Security:** อาศัย **Authorized JavaScript origins** (`https://thianrawit.github.io`) ใน Google Cloud Console ป้องกันการนำ Client ID ไปใช้ที่โดเมนอื่น
- **API Key Restriction:** จำกัด HTTP Referrers (`https://thianrawit.github.io/*`) และจำกัดสิทธิ์เฉพาะ Sheets API, Picker API และ Drive API
- **Sanitization & URL Filtering:** กรอง URL โปรไฟล์และ Google Sheet ด้วยฟังก์ชัน `safeHttpsUrl()` ป้องกัน `javascript:` XSS และตรวจสอบ Schema Whitelist ก่อน Restore Snapshot

---

## 4. แผนผังและสารบัญไฟล์ในโปรเจกต์ (Project Directory & Inventory)

```
Eduplan/
├── .github/workflows/
│   └── deploy.yml              # CI/CD: Multi-Page Build & Deploy สู่ GitHub Pages
├── dist/                       # ผลลัพธ์ Production Build (index.html, classroom.html, assets)
├── public/
│   ├── data/
│   │   └── curriculum.json     # [สำคัญสูงสุด] ฐานข้อมูลหลักสูตรแกนกลาง 2551/2560 (2,598 ตัวชี้วัด)
│   ├── fonts/                  # ฟอนต์ TH Sarabun แท้ 4 สไตล์ (Regular, Bold, Italic, BoldItalic)
│   ├── icons/
│   │   └── icon.png            # โลโก้ทางการ EduPlan Class
│   └── .nojekyll               # บังคับ GitHub Pages ให้บริการ assets โฟลเดอร์ขีดล่าง
├── src/
│   ├── classroom/              # [โมดูลใหม่] ระบบ EduPlan Class ทั้งหมด
│   │   ├── components/
│   │   │   ├── AssignmentsTab.ts     # จัดการงาน, สร้างงาน, ตรวจคะแนนรายคน
│   │   │   ├── AttendanceTab.ts      # เช็คชื่อรายวัน/รายคาบ สรุปยอด
│   │   │   ├── ClassroomHub.ts       # หน้ารวมคลังห้องเรียน, โมดอลสร้างห้อง 3 รูปแบบ
│   │   │   ├── ColumnMapperModal.ts  # แมปคอลัมน์ Excel แบบแยกสี 6 เฉดสี
│   │   │   ├── InteractiveTour.ts    # ระบบ Spotlight Tour 23 สเต็ป พร้อม Dummy Stage
│   │   │   ├── SettingsTab.ts        # แก้ไขห้องเรียน, Master Roster Editor, ตั้งค่า Sheet
│   │   │   └── TopBar.ts             # Two-Tier TopBar พร้อม Contextual Back
│   │   ├── classroom.css       # สไตล์เฉพาะของระบบ Classroom, Tour Spotlight และ Animations
│   │   ├── db.ts               # Dexie IndexedDB Schema 7 ตาราง และ Snapshot Merger
│   │   ├── excelService.ts     # SheetJS Wrapper สำหรับ Import/Export .xlsx
│   │   ├── googleAuth.ts       # Google Identity Services (GIS), Session & Silent Refresh
│   │   ├── googleSheets.ts     # Google Drive & Sheets Sync, Formula Injection Protection
│   │   ├── main.ts             # Router และตัวควบคุม Application Lifecycle ของ classroom.html
│   │   └── types.ts            # Type Definitions ของระบบ Classroom ทั้งหมด
│   ├── config.ts               # ค่าคงที่ระบบ, โมเดล AI, ตัวเลือกการสอน, Storage Keys
│   ├── curriculum.ts           # ฟังก์ชันค้นหาและคัดกรองหลักสูตรและตัวชี้วัด
│   ├── exporter.ts             # ส่งออก Word (.docx) แผนการสอน 11 หัวข้อ
│   ├── gemini.ts               # เชื่อมต่อ Gemini REST API (BYOK & Worker Proxy)
│   ├── longTermExporter.ts     # ส่งออก Word (.docx) โครงการระยะยาว 5 ส่วน (9,000 DXA)
│   ├── longTermModule.ts       # ตัวจัดการ Wizard 10 ขั้นตอน โครงการระยะยาว และ A4 Preview
│   ├── longTermTemplates.ts    # Prompts & Fallback Engine ของโครงการระยะยาว
│   ├── main.ts                 # ตัวควบคุมหลักหน้าแรก EduPlan AI (Navigation Hub, Wizard, Rubric)
│   ├── rubricExporter.ts       # ส่งออก Word (.docx) เกณฑ์รูบริกและตารางเกณฑ์ตัดสินคะแนน
│   ├── style.css               # สไตล์หลัก Tailwind CSS, Font-face และ Print Media
│   ├── telemetry.ts            # ส่งสถิตินิรนามเพื่อการวิจัยไปยัง Google Sheets
│   ├── templates.ts            # Prompts & Fallback สำหรับแผนการสอนและรูบริก
│   └── types.ts                # TypeScript Interfaces ของระบบหลัก
├── worker/
│   ├── worker.js               # Cloudflare Worker Edge Proxy (Multi-Key & Waterfall)
│   └── wrangler.toml           # การตั้งค่า Deploy Cloudflare Worker & KV Binding
├── index.html                  # หน้าหลัก EduPlan AI (2x2 Grid Hub, แผน, รูบริก, โครงการ)
├── classroom.html              # หน้าแอปพลิเคชัน EduPlan Class (Standalone MPA)
├── package.json                # รายการไลบรารีและคำสั่ง npm.cmd
├── tailwind.config.js          # คอนฟิกชุดสีและ Layout
├── tsconfig.json               # คอนฟิก TypeScript
├── vite.config.ts              # คอนฟิก Vite Multi-Page Build (index.html + classroom.html)
├── can.md                      # [เอกสารนี้] สรุปสถาปัตยกรรมและความสามารถทั้งระบบ ฉบับสมบูรณ์
├── ReviewIDE.md                # บันทึกประวัติและผลการทดสอบการพัฒนาทุกรอบ
└── README.md                   # คู่มือเริ่มต้นการใช้งานและภาพรวมโปรเจกต์
```

---

## 5. การวิเคราะห์ทางเทคนิค: ข้อดี ข้อเสีย และข้อเสนอแนะ (Pros, Cons & Recommendations)

### ข้อดีของระบบ (Key Advantages)
1. **ระบบนิเวศการศึกษาที่ครบวงจรที่สุด (Complete Ecosystem):** ครอบคลุมตั้งแต่การวางแผนระยะยาว (Syllabus), แผนการสอนรายชั่วโมง (วPA), เกณฑ์ประเมิน (Rubric), ไปจนถึงการปฏิบัติงานจริงในชั้นเรียน (Classroom Attendance & Grading) ในที่เดียว
2. **ต้นทุนโครงสร้างพื้นฐาน 0 บาท (Zero Server Cost):** ฝั่งเว็บรันบน GitHub Pages ฟรี 100%, ระบบฐานข้อมูลใช้ IndexedDB ในเครื่องครู, ระบบคลาวด์ใช้ Google Drive/Sheets ของครูเอง และ AI Gateway รันบน Cloudflare Worker Free Tier
3. **ความเสถียรและความพร้อมใช้งานสูงสุด (High Availability):** สลับคีย์ AI 1-10 ทันทีใน 0ms เมื่อเจอ Rate Limit และมีระบบ Fallback Engine สร้างเอกสารจำลองให้ครูได้ทันทีแม้อินเทอร์เน็ตหลุด
4. **ความถูกต้องตามระเบียบงานสารบรรณ 100%:** ไฟล์ Word `.docx` ทุกประเภทถูกล็อกขนาดตาราง 9,000 DXA ขอบกระดาษ 1 นิ้วรอบด้าน ฟอนต์ `TH SarabunPSK` แท้ พร้อมล้างสระลอยวรรคขาด นำไปพิมพ์ยื่นประเมินได้ทันที
5. **ความปลอดภัยและสิทธิส่วนบุคคล (PDPA & Security First):** ไม่มีการเก็บข้อมูลนักเรียนบนเซิร์ฟเวอร์ส่วนกลาง, สกัดไฟล์ในเครื่องครู, ไม่มี Client Secret หลุดขึ้น Git, และป้องกัน Formula Injection

### ข้อเสียและข้อควรระวัง (Limitations & Caveats)
1. **การใช้งานหลายอุปกรณ์ในโหมด Local:** หากครูไม่ได้ล็อกอินด้วย Google ข้อมูลห้องเรียนจะถูกเก็บเฉพาะในเบราว์เซอร์ของเครื่องนั้น หากเปลี่ยนเครื่องหรือล้างข้อมูลเบราว์เซอร์ ข้อมูลอาจสูญหายได้ (ระบบจึงมีคำเตือนแนะนำให้ล็อกอิน Google เสมอ)
2. **ขนาดไฟล์ฐานข้อมูลหลักสูตร (~970 KB):** การเปิดหน้าเว็บครั้งแรกอาจใช้เวลาโหลด 1–2 วินาทีบนเครือข่ายความเร็วต่ำ
3. **ข้อจำกัดของ Google API Quota รายบุคคล:** การซิงก์ Google Sheets ถี่เกินไปอาจชน Rate Limit ของ Google Sheets API (ระบบจึงมีปุ่มให้กดซิงก์แบบ Batch Update)

### ข้อแนะนำสำหรับการพัฒนาในอนาคต (Actionable Recommendations)
1. **การทำ Progressive Web App (PWA):** เพิ่ม `manifest.json` และ Service Worker เพื่อให้ครูสามารถติดตั้ง EduPlan AI เป็นแอปบน iPad, แท็บเล็ต หรือมือถือ และเปิดใช้งานแบบออฟไลน์ได้ 100%
2. **การแยก Chunk ฐานข้อมูลหลักสูตร:** แยก `curriculum.json` เป็นไฟล์ย่อยตามระดับชั้น (ปฐมวัย, ประถม, มัธยม) โหลดเฉพาะชั้นที่ครูเลือก เพื่อเพิ่มความเร็วในการเปิดหน้าเว็บครั้งแรก
3. **การนำเข้ารายชื่อจาก Google Classroom:** ต่อยอด Google OAuth Scopes เพิ่มความสามารถดึงรายชื่อนักเรียนจาก Google Classroom โดยตรงเข้ามายัง EduPlan Class
4. **การคำนวณและสรุปเกรดอัตโนมัติ:** นำคะแนนเก็บจากแท็บการส่งงานและคะแนนจิตพิสัยจากการมาเรียน มาประมวลผลตัดเกรด (เกรด 4 ถึง 0) ลงในตารางสรุปผลการเรียนอัตโนมัติ

---
*จัดทำขึ้นโดยละเอียดเพื่อเป็นเอกสารอ้างอิงสถาปัตยกรรมระบบ EduPlan AI Suite ล่าสุดตรงตาม Source Code ทุกประการ*
