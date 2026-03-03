/**
 * NAICS code definitions for the opportunity search filter.
 * Add, remove, or update entries here to change what appears in the UI.
 * Source: https://www.census.gov/naics/
 */

export interface NaicsCode {
  value: string;
  label: string;
  /** Optional category for grouping */
  category?: string;
}

export const NAICS_CODES: NaicsCode[] = [
  // ── Information Technology ────────────────────────────────────────────────
  { value: '541511', label: '541511 — Custom Computer Programming',         category: 'IT Services' },
  { value: '541512', label: '541512 — Computer Systems Design',             category: 'IT Services' },
  { value: '541513', label: '541513 — Computer Facilities Management',      category: 'IT Services' },
  { value: '541519', label: '541519 — Other Computer Related Services',     category: 'IT Services' },
  { value: '518210', label: '518210 — Data Processing / Hosting',           category: 'IT Services' },

  // ── Engineering & Science ─────────────────────────────────────────────────
  { value: '541330', label: '541330 — Engineering Services',                category: 'Engineering' },
  { value: '541380', label: '541380 — Testing Laboratories',                category: 'Engineering' },
  { value: '541715', label: '541715 — R&D in Physical / Engineering Sciences', category: 'Engineering' },

  // ── Professional Services ─────────────────────────────────────────────────
  { value: '541611', label: '541611 — Management Consulting',               category: 'Professional Services' },
  { value: '541690', label: '541690 — Other Scientific / Technical Consulting', category: 'Professional Services' },
  { value: '541990', label: '541990 — Other Professional / Scientific Services', category: 'Professional Services' },

  // ── Defense & Manufacturing ───────────────────────────────────────────────
  { value: '334111', label: '334111 — Electronic Computer Manufacturing',   category: 'Defense & Manufacturing' },
  { value: '334511', label: '334511 — Search / Detection / Navigation Equipment', category: 'Defense & Manufacturing' },
  { value: '336411', label: '336411 — Aircraft Manufacturing',              category: 'Defense & Manufacturing' },
  { value: '336414', label: '336414 — Guided Missile / Space Vehicle Manufacturing', category: 'Defense & Manufacturing' },
  { value: '928110', label: '928110 — National Security',                   category: 'Defense & Manufacturing' },

  // ── Telecommunications ────────────────────────────────────────────────────
  { value: '517110', label: '517110 — Wired Telecommunications Carriers',   category: 'Telecommunications' },
  { value: '517210', label: '517210 — Wireless Telecommunications Carriers', category: 'Telecommunications' },

  // ── Education & Health ────────────────────────────────────────────────────
  { value: '611430', label: '611430 — Professional / Management Training',  category: 'Education & Health' },
  { value: '621999', label: '621999 — Other Ambulatory Health Care Services', category: 'Education & Health' },
];

// ─── Set-aside codes ──────────────────────────────────────────────────────────

export interface SetAsideCode {
  value: string;
  label: string;
}

export const SET_ASIDE_CODES: SetAsideCode[] = [
  { value: 'SBA',     label: 'SBA — Small Business' },
  { value: '8A',      label: '8(a) — 8(a) Business Development' },
  { value: 'HZC',     label: 'HUBZone — Historically Underutilized Business Zone' },
  { value: 'SDVOSB',  label: 'SDVOSB — Service-Disabled Veteran-Owned Small Business' },
  { value: 'VOSB',    label: 'VOSB — Veteran-Owned Small Business' },
  { value: 'WOSB',    label: 'WOSB — Women-Owned Small Business' },
  { value: 'EDWOSB',  label: 'EDWOSB — Economically Disadvantaged WOSB' },
  { value: 'IEE',     label: 'IEE — Indian Economic Enterprise' },
  { value: 'ISBEE',   label: 'ISBEE — Indian Small Business Economic Enterprise' },
  { value: 'BICiv',   label: 'BICiv — Buy Indian' },
  { value: 'LOCAL',   label: 'LOCAL — Local Area Set-Aside' },
];
