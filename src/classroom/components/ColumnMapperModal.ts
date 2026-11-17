// ============================================================
// EDUPLAN Classroom — Modal / Toast primitives + Column Mapper
// ตัวช่วยเลือกแถวหัวตารางและจับคู่คอลัมน์แบบ Real-time Preview
// (แยกสีคอลัมน์ เลขที่ / รหัสนักเรียน / ชื่อ-สกุล ชัดเจน + รองรับ Merged Cells)
// ============================================================
import { applyMapping, getEffectiveHeaderRow, guessHeaderRow, guessMapping } from '../excelService';
import {
  buildMergeLayout,
  colToLetter,
  escapeHtml,
  getMergedCellValue,
  icon,
  type ColumnMapping,
  type IconName,
  type ParsedStudent,
  type SheetMerge,
} from '../types';

// ---------------- Toast ----------------
export function toast(
  message: string,
  type: 'success' | 'error' | 'info' | 'warn' = 'info',
  ms = 4200,
  toastIcon?: IconName,
): void {
  let host = document.getElementById('cr-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'cr-toasts';
    host.className = 'cr-toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `cr-toast cr-toast--${type}`;
  if (toastIcon) {
    el.innerHTML = `<span class="cr-toast__inner">${icon(toastIcon, 16)}<span>${escapeHtml(message)}</span></span>`;
  } else {
    el.textContent = message;
  }
  host.appendChild(el);
  window.setTimeout(() => {
    el.classList.add('cr-toast--out');
    window.setTimeout(() => el.remove(), 250);
  }, type === 'error' ? Math.max(ms, 7000) : ms);
}

// ---------------- Modal ----------------
export interface ModalHandle {
  el: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  close: () => void;
}

export function openModal(opts: {
  title: string;
  titleIcon?: IconName;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  body?: string;
  footer?: string;
  onClose?: () => void;
  dismissable?: boolean;
}): ModalHandle {
  const prevFocus = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.className = 'cr-overlay';
  const titleHtml = opts.titleIcon
    ? `<span class="cr-modal__title-inner">${icon(opts.titleIcon, 18)}<span>${escapeHtml(opts.title)}</span></span>`
    : escapeHtml(opts.title);
  overlay.innerHTML = `
    <div class="cr-modal cr-modal--${opts.size ?? 'md'}" role="dialog" aria-modal="true" aria-label="${escapeHtml(opts.title)}">
      <div class="cr-modal__head">
        <h2 class="cr-modal__title">${titleHtml}</h2>
        <button type="button" class="cr-icon-btn" data-close aria-label="ปิดหน้าต่าง">${icon('x', 18)}</button>
      </div>
      <div class="cr-modal__body">${opts.body ?? ''}</div>
      <div class="cr-modal__foot">${opts.footer ?? ''}</div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('cr-no-scroll');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (!document.querySelector('.cr-overlay')) document.body.classList.remove('cr-no-scroll');
    opts.onClose?.();
    prevFocus?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && opts.dismissable !== false && overlay === [...document.querySelectorAll('.cr-overlay')].pop()) close();
  };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('[data-close]')!.addEventListener('click', close);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay && opts.dismissable !== false) close();
  });
  const modal = overlay.querySelector('.cr-modal') as HTMLElement;
  window.setTimeout(() => {
    const first = modal.querySelector<HTMLElement>('input:not([type=hidden]),select,textarea,button:not([data-close])');
    (first ?? modal).focus?.();
  }, 30);
  return {
    el: modal,
    body: modal.querySelector('.cr-modal__body') as HTMLElement,
    footer: modal.querySelector('.cr-modal__foot') as HTMLElement,
    close,
  };
}

export function confirmDialog(
  message: string,
  opts: { title?: string; confirmText?: string; cancelText?: string; danger?: boolean } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal({
      title: opts.title ?? 'ยืนยันการทำรายการ',
      size: 'sm',
      body: `<p class="cr-text-body whitespace-pre-line">${escapeHtml(message)}</p>`,
      footer: `
        <button type="button" class="cr-btn cr-btn--ghost" data-no>${escapeHtml(opts.cancelText ?? 'ยกเลิก')}</button>
        <button type="button" class="cr-btn ${opts.danger ? 'cr-btn--danger' : 'cr-btn--primary'}" data-yes>${escapeHtml(opts.confirmText ?? 'ยืนยัน')}</button>`,
      onClose: () => resolve(result),
    });
    m.footer.querySelector('[data-no]')!.addEventListener('click', () => m.close());
    m.footer.querySelector('[data-yes]')!.addEventListener('click', () => {
      result = true;
      m.close();
    });
  });
}

/** ปุ่มแสดงสถานะกำลังทำงาน */
export async function withBusy<T>(btn: HTMLButtonElement | null, label: string, fn: () => Promise<T>): Promise<T> {
  if (!btn) return fn();
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="cr-spinner" aria-hidden="true"></span>${label ? escapeHtml(label) : ''}`;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

// ---------------- Column Mapper ----------------
export interface MapperSource {
  name: string;
  merges?: SheetMerge[];
  load: () => Promise<string[][]>;
}

export interface MapperResult {
  sheetName: string;
  mapping: ColumnMapping;
  students: ParsedStudent[];
}

type MapFieldKey = 'number' | 'code' | 'name' | 'prefix' | 'first' | 'last';
type RoleColorKey = 'number' | 'code' | 'name' | 'prefix' | 'last';

interface ColRoleInfo {
  label: string;
  color: RoleColorKey;
}

const FIELD_COLOR: Record<MapFieldKey, RoleColorKey> = {
  number: 'number', // สีส้มทอง (Amber)
  code: 'code',     // สีม่วง (Purple)
  name: 'name',     // สีเขียวมรกต (Emerald)
  prefix: 'prefix', // สีฟ้าอมเขียว (Cyan)
  first: 'name',    // สีเขียวมรกต (Emerald)
  last: 'last',     // สีชมพูเข้ม (Rose)
};

const PREVIEW_ROWS = 15;

export function openColumnMapper(opts: {
  title: string;
  sources: MapperSource[];
  initialSource?: string;
  initialMapping?: ColumnMapping | null;
  confirmText?: string;
}): Promise<MapperResult | null> {
  return new Promise((resolve) => {
    let result: MapperResult | null = null;
    let grid: string[][] = [];
    let merges: SheetMerge[] = [];
    let mapping: ColumnMapping = { headerRow: 0, number: null, code: null, nameMode: 'single', name: null, prefix: null, first: null, last: null };
    let sourceName = opts.initialSource && opts.sources.some((s) => s.name === opts.initialSource) ? opts.initialSource : opts.sources[0]?.name ?? '';
    let activeMapKey: MapFieldKey | null = null;
    let firstLoad = true;

    const m = openModal({
      title: opts.title,
      size: 'xl',
      body: `<div data-mapper class="cr-mapper"><div class="cr-empty-mini"><span class="cr-spinner"></span> กำลังโหลดข้อมูล...</div></div>`,
      footer: `
        <span class="cr-mapper__count mr-auto" data-count></span>
        <button type="button" class="cr-btn cr-btn--ghost" data-cancel>ยกเลิก</button>
        <button type="button" class="cr-btn cr-btn--primary" data-ok disabled>${icon('check', 16)}${escapeHtml(opts.confirmText ?? 'ยืนยันการนำเข้า')}</button>`,
      onClose: () => resolve(result),
    });
    const root = m.body.querySelector('[data-mapper]') as HTMLElement;
    const okBtn = m.footer.querySelector('[data-ok]') as HTMLButtonElement;
    const countEl = m.footer.querySelector('[data-count]') as HTMLElement;
    m.footer.querySelector('[data-cancel]')!.addEventListener('click', () => m.close());

    const width = () => {
      const maxRowLen = Math.max(1, ...grid.slice(0, Math.max(PREVIEW_ROWS, mapping.headerRow + 1)).map((r) => r.length));
      const maxMergeCol = Math.max(0, ...merges.filter((x) => x.startRowIndex < PREVIEW_ROWS).map((x) => x.endColumnIndex));
      return Math.max(maxRowLen, maxMergeCol);
    };

    const colOptions = (selected: number | null) => {
      const head = getEffectiveHeaderRow(grid, mapping.headerRow, merges);
      let html = `<option value="">— ไม่ใช้ —</option>`;
      for (let c = 0; c < width(); c++) {
        const label = head[c] ? `${colToLetter(c)} · ${head[c]}` : `${colToLetter(c)}`;
        html += `<option value="${c}" ${selected === c ? 'selected' : ''}>${escapeHtml(label.slice(0, 42))}</option>`;
      }
      return html;
    };

    const roleOf = (c: number): ColRoleInfo | null => {
      if (mapping.number === c) return { label: 'เลขที่', color: 'number' };
      if (mapping.code === c) return { label: 'รหัสนักเรียน', color: 'code' };
      if (mapping.nameMode === 'single' && mapping.name === c) return { label: 'ชื่อ-สกุล', color: 'name' };
      if (mapping.nameMode === 'split') {
        if (mapping.prefix === c) return { label: 'คำนำหน้า', color: 'prefix' };
        if (mapping.first === c) return { label: 'ชื่อ', color: 'name' };
        if (mapping.last === c) return { label: 'นามสกุล', color: 'last' };
      }
      return null;
    };

    const activeColIndex = (): number | null => {
      if (!activeMapKey) return null;
      return mapping[activeMapKey] as number | null;
    };

    const renderPreviewTable = () => {
      const w = width();
      const rowEnd = Math.min(grid.length, Math.max(PREVIEW_ROWS, mapping.headerRow + 3));
      const rows = grid.slice(0, Math.max(rowEnd, 1));
      const layout = buildMergeLayout(merges, 0, rows.length, 0, w);
      const focusedCol = activeColIndex();

      let html = `<table class="cr-grid cr-grid--stroke"><thead><tr><th class="cr-grid__rn">แถว</th>`;
      for (let c = 0; c < w; c++) {
        const role = roleOf(c);
        const isFocused = focusedCol === c;
        const cls = [
          role ? `is-mapped is-role-${role.color} is-col-edge-top` : '',
          isFocused ? 'is-col-focused' : '',
        ].filter(Boolean).join(' ');
        html += `<th class="${cls}" data-col-head="${c}" title="คอลัมน์ ${colToLetter(c)}"><span class="cr-grid__col-letter">${colToLetter(c)}</span>${role ? `<span class="cr-grid__role is-role-badge-${role.color}">${escapeHtml(role.label)}</span>` : ''}</th>`;
      }
      html += `</tr></thead><tbody>`;
      rows.forEach((r, i) => {
        const isHeader = i === mapping.headerRow;
        const isSkipped = i < mapping.headerRow;
        const isLastRow = i === rows.length - 1;
        const trCls = [isHeader ? 'is-header' : '', isSkipped ? 'is-skipped' : ''].filter(Boolean).join(' ');
        html += `<tr class="${trCls}" data-row="${i}" tabindex="0" title="คลิกเพื่อตั้งแถวที่ ${i + 1} เป็นหัวตาราง"><td class="cr-grid__rn">${i + 1}${isHeader ? `<span class="cr-hdr-tag">หัวตาราง</span>` : ''}</td>`;
        for (let c = 0; c < w; c++) {
          const key = `${i}:${c}`;
          if (layout.covered.has(key)) continue;
          const anchor = layout.anchors.get(key);
          const spanEndCol = anchor ? anchor.endCol - 1 : c;
          const spanEndRow = anchor ? anchor.endRow - 1 : i;

          let mappedRole: ColRoleInfo | null = null;
          let isFocused = false;
          for (let sc = c; sc <= spanEndCol; sc++) {
            if (!mappedRole && roleOf(sc)) mappedRole = roleOf(sc);
            if (focusedCol === sc) isFocused = true;
          }
          const isTargetCell = isHeader && !!mappedRole;
          const tdCls = [
            mappedRole ? `is-mapped is-role-${mappedRole.color} is-col-edge` : '',
            mappedRole && spanEndRow === rows.length - 1 && isLastRow ? 'is-col-edge-bottom' : '',
            isFocused ? 'is-col-focused' : '',
            isTargetCell ? 'is-target-cell' : '',
            anchor ? 'is-merged-cell' : '',
          ].filter(Boolean).join(' ');
          const spanAttrs = anchor
            ? `${anchor.rowSpan > 1 ? ` rowspan="${anchor.rowSpan}"` : ''}${anchor.colSpan > 1 ? ` colspan="${anchor.colSpan}"` : ''}`
            : '';
          const val = anchor ? getMergedCellValue(grid, merges, i, c) : (r[c] ?? '');
          const mergeTag = anchor
            ? `<span class="cr-merge-tag" title="เซลล์รวม (${colToLetter(c)}${i + 1}:${colToLetter(spanEndCol)}${spanEndRow + 1})">${colToLetter(c)}${i + 1}:${colToLetter(spanEndCol)}${spanEndRow + 1}</span>`
            : '';
          html += `<td class="${tdCls}"${spanAttrs} data-cell-col="${c}">${escapeHtml(val)}${mergeTag}</td>`;
        }
        html += `</tr>`;
      });
      html += `</tbody></table>`;
      return html;
    };

    const renderResult = () => {
      const students = applyMapping(grid, mapping);
      const codes = students.map((s) => s.studentCode).filter(Boolean);
      const dupCodes = codes.filter((c, i) => codes.indexOf(c) !== i);
      const nameMissing = mapping.nameMode === 'single' ? mapping.name === null : mapping.first === null && mapping.last === null;
      okBtn.disabled = students.length === 0;
      countEl.textContent = students.length ? `พร้อมนำเข้า ${students.length} คน` : 'ยังไม่มีรายชื่อที่นำเข้าได้';
      const warn: string[] = [];
      if (nameMissing) warn.push('ยังไม่ได้เลือกคอลัมน์ชื่อนักเรียน');
      if (dupCodes.length) warn.push(`รหัสนักเรียนซ้ำ: ${[...new Set(dupCodes)].slice(0, 5).join(', ')}`);
      return `
        ${warn.map((w) => `<div class="cr-alert cr-alert--warn">${icon('warning', 15)}<span>${escapeHtml(w)}</span></div>`).join('')}
        <div class="cr-table-wrap cr-table-wrap--preview">
          <table class="cr-table cr-table--compact">
            <thead>
              <tr>
                <th class="w-16 text-center"><span class="cr-th-dot is-dot-number"></span>เลขที่</th>
                <th class="w-36"><span class="cr-th-dot is-dot-code"></span>รหัสนักเรียน</th>
                <th><span class="cr-th-dot is-dot-name"></span>ชื่อ-นามสกุล</th>
              </tr>
            </thead>
            <tbody>
              ${students
                .slice(0, 10)
                .map((s) => `<tr><td class="text-center cr-num">${escapeHtml(s.number)}</td><td class="cr-num">${escapeHtml(s.studentCode) || '<span class="cr-faint">-</span>'}</td><td>${escapeHtml(s.fullName)}</td></tr>`)
                .join('') || `<tr><td colspan="3" class="cr-faint text-center py-6">คลิกเลือกแถวหัวตารางและคอลัมน์ชื่อด้านซ้าย</td></tr>`}
              ${students.length > 10 ? `<tr><td colspan="3" class="cr-faint text-center">… และอีก ${students.length - 10} คน</td></tr>` : ''}
            </tbody>
          </table>
        </div>`;
    };

    const renderSelectionBadges = () => {
      const pills: string[] = [
        `<span class="cr-sel-pill is-header-pill">แถวหัวตาราง: <b>แถว ${mapping.headerRow + 1}</b></span>`,
      ];
      if (mapping.number !== null) pills.push(`<span class="cr-sel-pill is-pill-number">เลขที่: <b>คอลัมน์ ${colToLetter(mapping.number)}</b></span>`);
      if (mapping.code !== null) pills.push(`<span class="cr-sel-pill is-pill-code">รหัสนักเรียน: <b>คอลัมน์ ${colToLetter(mapping.code)}</b></span>`);
      if (mapping.nameMode === 'single' && mapping.name !== null) {
        pills.push(`<span class="cr-sel-pill is-pill-name">ชื่อ-สกุล: <b>คอลัมน์ ${colToLetter(mapping.name)}</b></span>`);
      } else if (mapping.nameMode === 'split') {
        if (mapping.prefix !== null) pills.push(`<span class="cr-sel-pill is-pill-prefix">คำนำหน้า: <b>${colToLetter(mapping.prefix)}</b></span>`);
        if (mapping.first !== null) pills.push(`<span class="cr-sel-pill is-pill-name">ชื่อ: <b>${colToLetter(mapping.first)}</b></span>`);
        if (mapping.last !== null) pills.push(`<span class="cr-sel-pill is-pill-last">นามสกุล: <b>${colToLetter(mapping.last)}</b></span>`);
      }
      if (merges.length) {
        pills.push(`<span class="cr-sel-pill is-merge-pill">เซลล์รวม (Merge) ${merges.length} จุด</span>`);
      }
      return pills.join('');
    };

    const render = () => {
      const sel = (key: MapFieldKey, label: string) => {
        const val = mapping[key];
        const roleColor = FIELD_COLOR[key];
        const badge = val !== null ? `<span class="cr-col-tag is-tag-${roleColor}">คอลัมน์ ${colToLetter(val)}</span>` : `<span class="cr-col-tag is-tag-empty">ยังไม่เลือก</span>`;
        return `<label class="cr-field cr-map-field cr-map-field--${roleColor} ${activeMapKey === key ? 'is-field-focused' : ''}">
          <span class="cr-label flex items-center justify-between">
            <span class="inline-flex items-center gap-1.5"><span class="cr-th-dot is-dot-${roleColor}"></span>${label}</span>
            ${badge}
          </span>
          <select class="cr-input" data-map="${key}">${colOptions(val)}</select>
        </label>`;
      };
      root.innerHTML = `
        ${opts.sources.length > 1 ? `
        <div class="cr-mapper__sources">
          <span class="cr-label">แท็บข้อมูล</span>
          <div class="cr-chips">${opts.sources
            .map((s) => `<button type="button" class="cr-chip ${s.name === sourceName ? 'is-active' : ''}" data-source="${escapeHtml(s.name)}">${icon('spreadsheet', 14)}${escapeHtml(s.name)}</button>`)
            .join('')}</div>
        </div>` : ''}
        <div class="cr-mapper__step">
          <div class="cr-step-head">
            <div class="cr-step-title"><span class="cr-step-no">1</span> คลิกเลือก "แถวหัวตาราง" จากตารางตัวอย่าง (แยกสีตามประเภทคอลัมน์)</div>
            <div class="cr-sel-pills" data-sel-pills>${renderSelectionBadges()}</div>
          </div>
          <div class="cr-grid-wrap">${grid.length ? renderPreviewTable() : '<div class="cr-empty-mini">แท็บนี้ไม่มีข้อมูล</div>'}</div>
        </div>
        <div class="cr-mapper__cols">
          <div class="cr-mapper__step">
            <div class="cr-step-title"><span class="cr-step-no">2</span> จับคู่คอลัมน์ (สีของช่องตรงกับสีกรอบในตารางด้านบน)</div>
            <div class="cr-form-grid cr-form-grid--2">
              ${sel('number', 'เลขที่')}
              ${sel('code', 'รหัสนักเรียน')}
            </div>
            <div class="cr-seg cr-seg--sm my-3" role="radiogroup" aria-label="รูปแบบคอลัมน์ชื่อ">
              <button type="button" role="radio" aria-checked="${mapping.nameMode === 'single'}" class="cr-seg__btn ${mapping.nameMode === 'single' ? 'is-on' : ''}" data-mode="single">ชื่อ-สกุล คอลัมน์เดียว</button>
              <button type="button" role="radio" aria-checked="${mapping.nameMode === 'split'}" class="cr-seg__btn ${mapping.nameMode === 'split' ? 'is-on' : ''}" data-mode="split">แยก คำนำหน้า / ชื่อ / นามสกุล</button>
            </div>
            <div class="cr-form-grid">
              ${mapping.nameMode === 'single' ? sel('name', 'คำนำหน้า/ชื่อ-สกุล') : `${sel('prefix', 'คำนำหน้า')}${sel('first', 'ชื่อ')}${sel('last', 'นามสกุล')}`}
            </div>
          </div>
          <div class="cr-mapper__step">
            <div class="cr-step-title"><span class="cr-step-no">3</span> ตัวอย่างรายชื่อที่อ่านได้</div>
            <div data-result>${renderResult()}</div>
          </div>
        </div>`;
    };

    const refreshPreviewOnly = () => {
      const gw = root.querySelector('.cr-grid-wrap');
      if (gw && grid.length) gw.innerHTML = renderPreviewTable();
      const pills = root.querySelector('[data-sel-pills]');
      if (pills) pills.innerHTML = renderSelectionBadges();
      const res = root.querySelector('[data-result]');
      if (res) res.innerHTML = renderResult();
      // อัปเดตป้ายคอลัมน์บน label ของ select
      (['number', 'code', 'name', 'prefix', 'first', 'last'] as MapFieldKey[]).forEach((k) => {
        const selEl = root.querySelector<HTMLSelectElement>(`select[data-map="${k}"]`);
        const tagEl = selEl?.closest('.cr-map-field')?.querySelector('.cr-col-tag');
        if (tagEl) {
          const v = mapping[k];
          const rc = FIELD_COLOR[k];
          tagEl.className = `cr-col-tag ${v !== null ? `is-tag-${rc}` : 'is-tag-empty'}`;
          tagEl.textContent = v !== null ? `คอลัมน์ ${colToLetter(v)}` : 'ยังไม่เลือก';
        }
      });
    };

    const loadSource = async (name: string) => {
      sourceName = name;
      const src = opts.sources.find((s) => s.name === name);
      if (!src) return;
      root.innerHTML = `<div class="cr-empty-mini"><span class="cr-spinner"></span> กำลังโหลดแท็บ "${escapeHtml(name)}"...</div>`;
      okBtn.disabled = true;
      try {
        grid = await src.load();
        merges = src.merges ?? [];
      } catch (e) {
        grid = [];
        merges = [];
        toast(e instanceof Error ? e.message : String(e), 'error');
      }
      if (firstLoad && opts.initialMapping && name === (opts.initialSource ?? name)) {
        mapping = { ...opts.initialMapping };
      } else {
        const hr = guessHeaderRow(grid, merges);
        mapping = guessMapping(grid, hr, merges);
      }
      firstLoad = false;
      render();
    };

    root.addEventListener('focusin', (e) => {
      const s = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-map]');
      if (!s) return;
      const key = s.dataset.map as MapFieldKey;
      if (activeMapKey !== key) {
        activeMapKey = key;
        root.querySelectorAll('.cr-map-field').forEach((f) => f.classList.remove('is-field-focused'));
        s.closest('.cr-map-field')?.classList.add('is-field-focused');
        const gw = root.querySelector('.cr-grid-wrap');
        if (gw && grid.length) gw.innerHTML = renderPreviewTable();
      }
    });

    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const srcBtn = t.closest<HTMLElement>('[data-source]');
      if (srcBtn) {
        if (srcBtn.dataset.source !== sourceName) void loadSource(srcBtn.dataset.source!);
        return;
      }
      const modeBtn = t.closest<HTMLElement>('[data-mode]');
      if (modeBtn) {
        const mode = modeBtn.dataset.mode as 'single' | 'split';
        if (mode !== mapping.nameMode) {
          const g = guessMapping(grid, mapping.headerRow, merges);
          mapping.nameMode = mode;
          if (mode === 'split') {
            mapping.prefix = g.prefix ?? mapping.prefix;
            mapping.first = g.first ?? mapping.first ?? mapping.name;
            mapping.last = g.last ?? mapping.last;
          } else {
            mapping.name = mapping.name ?? g.name ?? mapping.first;
          }
          render();
        }
        return;
      }
      const row = t.closest<HTMLElement>('tr[data-row]');
      if (row) {
        const hr = Number(row.dataset.row);
        if (hr !== mapping.headerRow) {
          const g = guessMapping(grid, hr, merges);
          const hasAny = g.number !== null || g.code !== null || g.name !== null || g.first !== null;
          mapping = hasAny ? g : { ...mapping, headerRow: hr };
          render();
        }
      }
    });
    root.addEventListener('keydown', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('tr[data-row]');
      if (row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        row.click();
      }
    });
    root.addEventListener('change', (e) => {
      const s = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-map]');
      if (!s) return;
      const key = s.dataset.map as MapFieldKey;
      mapping[key] = s.value === '' ? null : Number(s.value);
      activeMapKey = key;
      refreshPreviewOnly();
    });

    okBtn.addEventListener('click', () => {
      const students = applyMapping(grid, mapping);
      if (!students.length) return;
      result = { sheetName: sourceName, mapping: { ...mapping }, students };
      m.close();
    });

    void loadSource(sourceName);
  });
}
