/// <reference types="vite/client" />
// ============================================================
// EDUPLAN Classroom — Google Identity Services (GIS)
// Login / Session Persistence / Silent Token Refresh / Logout
// ============================================================

export interface GoogleProfile {
  name: string;
  email: string;
  picture: string;
}

export interface AuthState {
  configured: boolean;
  signedIn: boolean;
  profile: GoogleProfile | null;
  tokenValid: boolean;
  needsReconnect: boolean;
  busy: boolean;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  callback: (resp: TokenResponse) => void;
  error_callback?: (err: { type: string; message?: string }) => void;
  requestAccessToken: (overrides?: { prompt?: string; login_hint?: string }) => void;
}

interface GoogleOAuth2 {
  initTokenClient: (cfg: {
    client_id: string;
    scope: string;
    callback: (resp: TokenResponse) => void;
    error_callback?: (err: { type: string; message?: string }) => void;
    prompt?: string;
  }) => TokenClient;
  revoke: (token: string, done?: () => void) => void;
  hasGrantedAllScopes: (resp: TokenResponse, ...scopes: string[]) => boolean;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 }; picker?: any };
    gapi?: any;
  }
}

export const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
];

export const NOT_CONFIGURED_MESSAGE = 'ยังไม่ได้ตั้งค่า Google Client ID (ใช้งานโหมดในเครื่องได้ปกติ)';

const PROFILE_KEY = 'eduplan_classroom_google_profile';
const TOKEN_KEY = 'eduplan_classroom_google_token';
const SCOPE_VERSION = 3;

const RAW_CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();
const RAW_API_KEY = String(import.meta.env.VITE_GOOGLE_API_KEY ?? '').trim();

function looksLikePlaceholder(v: string): boolean {
  return !v || /your|xxx|placeholder|example|changeme|<|>/i.test(v);
}

const CLIENT_ID_VALID = !looksLikePlaceholder(RAW_CLIENT_ID) && RAW_CLIENT_ID.endsWith('.apps.googleusercontent.com');
const API_KEY_VALID = !looksLikePlaceholder(RAW_API_KEY);

export function isConfigured(): boolean {
  return CLIENT_ID_VALID;
}
export function getApiKey(): string | null {
  return API_KEY_VALID ? RAW_API_KEY : null;
}
/** Project number (ใช้กับ Google Picker setAppId) */
export function getAppId(): string {
  return RAW_CLIENT_ID.split('-')[0] ?? '';
}

// ---------------- script loader ----------------
const scriptCache = new Map<string, Promise<void>>();
export function loadScript(src: string): Promise<void> {
  const cached = scriptCache.get(src);
  if (cached) return cached;
  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptCache.delete(src);
      reject(new Error(`โหลดสคริปต์ไม่สำเร็จ: ${src} (ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต)`));
    };
    document.head.appendChild(el);
  });
  scriptCache.set(src, p);
  return p;
}

// ---------------- state ----------------
let accessToken: string | null = null;
let expiresAt = 0;
let tokenClient: TokenClient | null = null;
let pending: Promise<string> | null = null;
let refreshTimer: number | undefined;

const state: AuthState = {
  configured: CLIENT_ID_VALID,
  signedIn: false,
  profile: null,
  tokenValid: false,
  needsReconnect: false,
  busy: false,
};

type AuthListener = (s: AuthState) => void;
const listeners = new Set<AuthListener>();
export function onAuthChange(fn: AuthListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getAuthState(): AuthState {
  return { ...state, tokenValid: hasValidToken() };
}
function emit(): void {
  const snap = getAuthState();
  listeners.forEach((fn) => fn(snap));
}

function hasValidToken(): boolean {
  return !!accessToken && Date.now() < expiresAt - 60_000;
}

function persistToken(): void {
  try {
    if (accessToken) sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken, expiresAt, scopeVer: SCOPE_VERSION }));
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

function scheduleRefresh(): void {
  window.clearTimeout(refreshTimer);
  if (!accessToken) return;
  const wait = expiresAt - Date.now() - 5 * 60_000;
  if (wait <= 0) return;
  refreshTimer = window.setTimeout(() => {
    ensureToken(false).catch(() => {
      state.needsReconnect = true;
      emit();
    });
  }, wait);
}

async function fetchProfile(token: string): Promise<GoogleProfile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('ดึงข้อมูลโปรไฟล์ Google ไม่สำเร็จ');
  const j = (await res.json()) as { name?: string; email?: string; picture?: string };
  return { name: j.name ?? j.email ?? 'ผู้ใช้ Google', email: j.email ?? '', picture: j.picture ?? '' };
}

async function getTokenClient(): Promise<TokenClient> {
  if (tokenClient) return tokenClient;
  await loadScript('https://accounts.google.com/gsi/client');
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error('Google Identity Services ไม่พร้อมใช้งาน');
  tokenClient = oauth2.initTokenClient({
    client_id: RAW_CLIENT_ID,
    scope: SCOPES.join(' '),
    callback: () => undefined,
  });
  return tokenClient;
}

function requestToken(prompt: string): Promise<string> {
  if (pending) return pending;
  pending = (async () => {
    const client = await getTokenClient();
    return new Promise<string>((resolve, reject) => {
      client.callback = (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || 'ไม่ได้รับสิทธิ์เข้าถึงจาก Google'));
          return;
        }
        const oauth2 = window.google?.accounts?.oauth2;
        if (oauth2 && !oauth2.hasGrantedAllScopes(resp, SCOPES[3], SCOPES[4], SCOPES[5], SCOPES[6])) {
          reject(
            new Error(
              'ต้องอนุญาตสิทธิ์ Google Drive, อ่านข้อมูลไฟล์ที่แชร์ และ Google Sheets ทั้งหมดเพื่อเปิดอ่านและซิงก์ห้องเรียนร่วม (กรุณาเข้าสู่ระบบใหม่และติ๊กอนุญาตทุกช่อง)',
            ),
          );
          return;
        }
        accessToken = resp.access_token;
        expiresAt = Date.now() + Number(resp.expires_in ?? 3600) * 1000;
        state.needsReconnect = false;
        persistToken();
        scheduleRefresh();
        resolve(accessToken);
      };
      client.error_callback = (err) => {
        const map: Record<string, string> = {
          popup_failed_to_open: 'เบราว์เซอร์บล็อกหน้าต่างล็อกอิน Google (กรุณาอนุญาต Pop-up แล้วลองอีกครั้ง)',
          popup_closed: 'หน้าต่างล็อกอิน Google ถูกปิดก่อนเสร็จสิ้น',
        };
        reject(new Error(map[err.type] ?? err.message ?? 'เชื่อมต่อ Google ไม่สำเร็จ'));
      };
      client.requestAccessToken({ prompt, login_hint: state.profile?.email || undefined });
    });
  })().finally(() => {
    pending = null;
  });
  return pending;
}

/** คืน access token ที่ใช้งานได้ (รีเฟรชแบบเงียบอัตโนมัติเมื่อหมดอายุ) */
export async function ensureToken(interactive = true): Promise<string> {
  if (!CLIENT_ID_VALID) throw new Error(NOT_CONFIGURED_MESSAGE);
  if (!state.signedIn) throw new Error('กรุณาเข้าสู่ระบบด้วย Google ก่อน');
  if (hasValidToken()) return accessToken!;
  try {
    const promptMode = state.needsReconnect && interactive ? 'consent' : '';
    const t = await requestToken(promptMode);
    emit();
    return t;
  } catch (e) {
    state.needsReconnect = true;
    emit();
    if (!interactive) throw e;
    throw e;
  }
}

/** บังคับขอ token ใหม่ (ใช้เมื่อ API ตอบ 401) */
export async function forceRefreshToken(): Promise<string> {
  accessToken = null;
  expiresAt = 0;
  persistToken();
  return ensureToken();
}

export async function signIn(forceConsent = false): Promise<GoogleProfile> {
  if (!CLIENT_ID_VALID) throw new Error(NOT_CONFIGURED_MESSAGE);
  state.busy = true;
  emit();
  try {
    const promptMode = forceConsent || state.needsReconnect ? 'consent' : state.profile ? '' : 'select_account';
    const token = await requestToken(promptMode);
    const profile = await fetchProfile(token);
    state.profile = profile;
    state.signedIn = true;
    state.needsReconnect = false;
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ profile, connected: true }));
    return profile;
  } finally {
    state.busy = false;
    emit();
  }
}

export async function signOut(): Promise<void> {
  const token = accessToken;
  window.clearTimeout(refreshTimer);
  accessToken = null;
  expiresAt = 0;
  state.signedIn = false;
  state.profile = null;
  state.needsReconnect = false;
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
  persistToken();
  if (token) {
    try {
      await getTokenClient();
      window.google?.accounts?.oauth2?.revoke(token);
    } catch {
      /* ignore revoke failure */
    }
  }
  emit();
}

/** เรียกครั้งเดียวตอนเปิดหน้า: กู้คืน Session จาก localStorage/sessionStorage */
export function initAuth(): AuthState {
  if (!CLIENT_ID_VALID) {
    emit();
    return getAuthState();
  }
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { profile?: GoogleProfile; connected?: boolean };
      if (saved.connected && saved.profile?.email) {
        state.profile = saved.profile;
        state.signedIn = true;
      }
    }
    const tok = sessionStorage.getItem(TOKEN_KEY);
    if (tok && state.signedIn) {
      const t = JSON.parse(tok) as { accessToken?: string; expiresAt?: number; scopeVer?: number };
      if (t.scopeVer === SCOPE_VERSION && t.accessToken && t.expiresAt && t.expiresAt > Date.now() + 60_000) {
        accessToken = t.accessToken;
        expiresAt = t.expiresAt;
        scheduleRefresh();
      }
    }
  } catch {
    /* corrupted storage -> ignore */
  }
  if (state.signedIn && !hasValidToken()) state.needsReconnect = true;
  // preload GIS แบบไม่บล็อก
  getTokenClient().catch(() => undefined);
  emit();
  return getAuthState();
}
