/**
 * SECOM / Guild 대시보드 백엔드 서버
 *
 * 지원하는 인증 방식 (우선순위 순):
 *  1) 환경변수 CODYSSEY_SESSION 에 JSESSIONID 가 직접 있으면 즉시 사용 (권장, 비밀번호 불필요)
 *  2) 환경변수 CODYSSEY_ID / CODYSSEY_PW 가 있으면 서버 시작 시 자동 로그인 (CI용)
 *  3) 둘 다 없으면 브라우저에서 로그인 폼으로 로그인 (대화형 모드)
 */

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const setCookie = require("set-cookie-parser");
const path = require("path");
const { createGitHubSyncService } = require("./lib/github-sync");
const { TRACKED_GUILD_IDS, mergeTrackedGuilds } = require("./lib/tracked-guilds");
const { isCurrentlyInside, isOpenSession, hasOpenSessionOn, kstDateStrings, prevYearMonth } = require("./lib/open-session");

const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const API_BASE = "https://api.usr.codyssey.kr";
const AUTH_URL = "https://api.ams.codyssey.kr/authenticate";
const CACHE_TTL_MS = 2 * 60 * 1000;
// TRACKED_GUILD_IDS는 클라이언트 입력으로 변경할 수 없는 서버 고정 범위다.
const COOKIE_FILE = process.env.SECOM_COOKIE_FILE || path.join(__dirname, ".session-cookies.json");

// Secret 암호화·업로드와 workflow_dispatch는 독립 서비스로 분리한다.
const githubSync = createGitHubSyncService({ fetchImpl: fetch, env: process.env });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// /app 과 /app/ 로 접속 시 로그인 폼이 있는 풀 대시보드(app.html) 제공
app.get(["/app", "/app/"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app.html"));
});

// ---------- 세션 ----------
let session = {
  cookies: {},
  userId: null,
  loggedInAt: null,
  autoLoginTried: false,
};

function saveCookiesToDisk() {
  try {
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(session, null, 2));
  } catch (e) { /* CI read-only 등 무시 */ }
}

function loadCookiesFromDisk() {
  try {
    if (!fs.existsSync(COOKIE_FILE)) return false;
    const raw = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
    if (raw && raw.cookies && raw.cookies.JSESSIONID) {
      session = raw;
      return true;
    }
  } catch (e) {}
  return false;
}

function cookieHeaderForUrl(url) {
  const u = new URL(url);
  const parts = [];
  for (const [name, c] of Object.entries(session.cookies)) {
    if (c.domain) {
      const dom = c.domain.replace(/^\./, "");
      if (!u.hostname.endsWith(dom) && u.hostname !== dom) continue;
    }
    if (c.path && !u.pathname.startsWith(c.path)) continue;
    parts.push(`${name}=${c.value}`);
  }
  return parts.join("; ");
}

function applyCookies(setCookieHeader) {
  if (!setCookieHeader) return;
  const cookies = setCookie.parse(
    Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader],
    { decodeValues: false }
  );
  for (const c of cookies) session.cookies[c.name] = c;
  // 세션 쿠키가 갱신될 때마다 디스크에 저장 (Actions 캐시 대응)
  if (cookies.some(c => c.name === "JSESSIONID")) {
    saveCookiesToDisk();
  }
}

function setSessionId(jsessionId) {
  // 환경변수로 세션 ID를 직접 주입받은 경우
  session.cookies["JSESSIONID"] = {
    name: "JSESSIONID",
    value: jsessionId,
    domain: ".codyssey.kr",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "None",
  };
}

// ---------- 캐시 ----------
const cache = new Map();
function cacheGet(k) {
  const v = cache.get(k);
  if (!v) return null;
  if (Date.now() - v.ts > CACHE_TTL_MS) { cache.delete(k); return null; }
  return v.data;
}
function cacheSet(k, d) { cache.set(k, { ts: Date.now(), data: d }); }
function clearCache() { cache.clear(); }

function isUnauthenticatedResponse(data) {
  return !!(data && (data.__unauthenticated || data.__loginRedirect));
}

function invalidateSession(reason = "") {
  session = {
    cookies: {},
    userId: null,
    loggedInAt: null,
    // 만료된 환경변수/디스크 세션을 같은 요청에서 계속 재주입하지 않는다.
    autoLoginTried: true,
  };
  clearCache();
  try { if (fs.existsSync(COOKIE_FILE)) fs.unlinkSync(COOKIE_FILE); } catch (e) {}
  if (reason) console.warn(`[auth] Session invalidated: ${reason}`);
}

// ---------- 인증 fetch ----------
async function authFetch(url, options = {}) {
  if ((!options.method || options.method === "GET")) {
    const cached = cacheGet(url);
    if (cached) {
      if (!isUnauthenticatedResponse(cached)) return cached;
      cache.delete(url);
    }
  }
  const cookieHeader = cookieHeaderForUrl(url);
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    "X-Requested-With": "XMLHttpRequest",
    ...(options.headers || {}),
  };
  if (cookieHeader) headers["Cookie"] = cookieHeader;
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/x-www-form-urlencoded";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 15000);
  let res;
  try {
    res = await fetch(url, { ...options, headers, signal: controller.signal, redirect: "manual" });
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
  clearTimeout(timer);

  const sc = res.headers.raw()["set-cookie"];
  if (sc) applyCookies(sc);

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (location && location.includes("codyssey.kr")) {
      const u = new URL(location, url).toString();
      try { await authFetch(u, { method: "GET" }); } catch (e) {}
      return { __loginRedirect: true, location };
    }
  }
  if (res.status === 401 || res.status === 403) return { __unauthenticated: true, status: res.status };

  const ct = res.headers.get("content-type") || "";
  let data;
  if (ct.includes("application/json")) data = await res.json();
  else data = await res.text();

  if (!options.method || options.method === "GET") cacheSet(url, data);
  return data;
}

// 세션 유효성 체크 (메인 페이지 호출해서 정상 응답 오는지)
async function validateSession() {
  try {
    // usr.codyssey.kr/main은 인증과 무관하게 항상 SPA HTML을 반환하므로
    // 실제 인증이 필요한 길드 API로 JSESSIONID 유효성을 확인한다.
    const probeGuildId = TRACKED_GUILD_IDS[0];
    const url = `${API_BASE}/guild/${probeGuildId}/detail?guildSeasonId=5&weekNo=9`;
    const data = await authFetch(url, { method: "GET" });
    if (isUnauthenticatedResponse(data)) return false;
    return !!(data && data.code === 200 && data.result);
  } catch (e) {
    return false;
  }
}

async function doLoginWithCredentials(userId, password) {
  const body = new URLSearchParams();
  body.append("userId", userId);
  body.append("password", password);
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json, text/plain, */*",
      Origin: "https://ams.codyssey.kr",
      Referer: "https://ams.codyssey.kr/",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    },
    body: body.toString(),
    redirect: "manual",
  });
  const sc = res.headers.raw()["set-cookie"];
  if (sc) applyCookies(sc);
  let success = false;
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location") || "";
    if (loc.includes("/main") || loc.includes("usr.codyssey.kr")) success = true;
  } else {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (json.success || json.code === 200 || json.userId) success = true;
    } catch (e) {
      if (text.includes("main")) success = true;
    }
  }
  if (success) {
    session.userId = userId;
    session.loggedInAt = new Date().toISOString();
    session.autoLoginTried = true;
    clearCache();
    saveCookiesToDisk();
    return true;
  }
  return false;
}

async function syncSessionToGitHub() {
  const sessionId = session.cookies["JSESSIONID"] && session.cookies["JSESSIONID"].value;
  const result = await githubSync.syncSession(sessionId);
  return result.success;
}

// ---------- 자동 로그인 (파일/환경변수) ----------
let autoLoginInFlight = null;

async function performAutoLoginFromEnv() {
  session.autoLoginTried = true;

  // 0) 디스크에 저장된 쿠키가 있으면 우선 복원
  if (loadCookiesFromDisk()) {
    console.log(`[auth] Loaded ${Object.keys(session.cookies).length} cookies from ${COOKIE_FILE}`);
    if (await validateSession()) {
      console.log("[auth] Session from disk is valid ✓");
      return true;
    }
    console.log("[auth] Session from disk expired → showing login form");
    invalidateSession("disk session expired");
  }

  // 1) 환경변수로 세션 ID 직접 주입 (Actions의 Secret에서 오는 경우)
  if (process.env.CODYSSEY_SESSION) {
    setSessionId(process.env.CODYSSEY_SESSION);
    session.userId = process.env.CODYSSEY_ID || "(session)";
    session.loggedInAt = new Date().toISOString();
    console.log("[auth] Using session cookie from CODYSSEY_SESSION env var");
    if (await validateSession()) {
      saveCookiesToDisk();
      return true;
    }
    console.log("[auth] CODYSSEY_SESSION expired → showing login form");
    invalidateSession("CODYSSEY_SESSION expired");
  }

  // 2) ID/PW 자동 로그인 모드
  if (process.env.CODYSSEY_ID && process.env.CODYSSEY_PW) {
    console.log(`[auth] No valid cached session. Auto-logging in as ${process.env.CODYSSEY_ID} ...`);
    try {
      const ok = await doLoginWithCredentials(process.env.CODYSSEY_ID, process.env.CODYSSEY_PW);
      if (ok) {
        console.log("[auth] Auto-login success ✓ (session saved to disk)");
        await syncSessionToGitHub();
        return true;
      }
      console.log("[auth] Auto-login failed");
      invalidateSession("credential auto-login failed");
      return false;
    } catch (err) {
      console.error("[auth] Auto-login error:", err.message);
      invalidateSession("credential auto-login error");
      return false;
    }
  }
  return false;
}

async function tryAutoLoginFromEnv() {
  if (autoLoginInFlight) return autoLoginInFlight;
  if (session.autoLoginTried) return !!session.cookies["JSESSIONID"];

  autoLoginInFlight = performAutoLoginFromEnv();
  try {
    return await autoLoginInFlight;
  } finally {
    autoLoginInFlight = null;
  }
}

// ---------- API 라우트 ----------
app.get("/api/session", async (req, res) => {
  await tryAutoLoginFromEnv();
  const hasSession = !!session.cookies["JSESSIONID"];
  res.json({
    loggedIn: hasSession,
    userId: session.userId,
    loggedInAt: session.loggedInAt,
    cookieCount: Object.keys(session.cookies).length,
    authMode: process.env.CODYSSEY_SESSION ? "session-env" :
              (process.env.CODYSSEY_ID && process.env.CODYSSEY_PW ? "credentials-env" : "interactive"),
    githubSync: githubSync.getStatus(),
  });
});

app.post("/api/sync-github", async (req, res) => {
  const sessionId = session.cookies["JSESSIONID"] && session.cookies["JSESSIONID"].value;
  if (!sessionId) return res.status(400).json({ success: false, error: "먼저 로그인해주세요." });
  const result = await githubSync.syncSession(sessionId);
  res.status(result.success ? 200 : 502).json(result);
});

app.post("/api/login", async (req, res) => {
  try {
    const { userId, password } = req.body || {};
    if (!userId || !password) return res.status(400).json({ success: false, error: "아이디/비밀번호를 모두 입력" });
    session = { cookies: {}, userId: null, loggedInAt: null, autoLoginTried: true };
    clearCache();

    const ok = await doLoginWithCredentials(userId, password);
    if (ok) {
      // 로그인 응답 전에 JSESSIONID를 Repository Secret에 복사한다.
      // 실패해도 대시보드 로그인은 유지하되 UI가 동기화 오류를 명확히 안내한다.
      const githubSynced = await syncSessionToGitHub();
      const syncStatus = githubSync.getStatus();
      return res.json({
        success: true,
        userId,
        githubSynced,
        workflowTriggered: syncStatus.workflowTriggered,
        githubSyncError: githubSynced ? null : syncStatus.lastError,
      });
    }
    invalidateSession("interactive login failed");
    return res.status(401).json({ success: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." });
  } catch (err) {
    invalidateSession("interactive login error");
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/logout", (req, res) => {
  const envProvided = !!(process.env.CODYSSEY_SESSION || (process.env.CODYSSEY_ID && process.env.CODYSSEY_PW));
  invalidateSession("logout");
  // 명시적 로그아웃 뒤에는 환경변수 자동 인증을 다음 요청에서 한 번 재검증한다.
  session.autoLoginTried = false;
  if (envProvided) {
    // 서버 재시작 시 환경변수로 재로그인되므로 명시적 알림
    return res.json({ success: true, note: "브라우저 세션은 로그아웃되었습니다. 서버 환경변수 인증은 다음 요청에서 재시도됩니다." });
  }
  res.json({ success: true });
});

/** 디버그용: 현재 세션 쿠키 정보 (값은 반환하지 않음) */
app.get("/api/session/debug", (req, res) => {
  res.json({
    loggedIn: !!session.cookies["JSESSIONID"],
    userId: session.userId,
    cookieFile: COOKIE_FILE,
    cookieFileExists: fs.existsSync(COOKIE_FILE),
    cookieNames: Object.keys(session.cookies),
    loggedInAt: session.loggedInAt,
  });
});

// 미들웨어: 모든 API 요청 전에 자동 로그인 시도
app.use("/api/guild", async (req, res, next) => { await tryAutoLoginFromEnv(); next(); });
app.use("/api/secom", async (req, res, next) => { await tryAutoLoginFromEnv(); next(); });
app.use("/api/guilds", async (req, res, next) => { await tryAutoLoginFromEnv(); next(); });
app.use("/api/aggregate", async (req, res, next) => { await tryAutoLoginFromEnv(); next(); });

// 길드 목록 캐시 (TTL 10분)
let guildListCache = { guilds: null, fetchedAt: 0 };
const GUILD_LIST_TTL = 10 * 60 * 1000;

async function discoverGuilds(seasonId, weekNo, maxId = 50) {
  const now = Date.now();
  if (guildListCache.guilds && (now - guildListCache.fetchedAt) < GUILD_LIST_TTL) {
    return guildListCache.guilds;
  }
  const found = [];
  const BATCH = 5;
  for (let i = 1; i <= maxId; i += BATCH) {
    const batch = [];
    for (let j = i; j < Math.min(i + BATCH, maxId + 1); j++) batch.push(j);
    const results = await Promise.all(batch.map(async gid => {
      try {
        const url = `${API_BASE}/guild/${gid}/detail?guildSeasonId=${seasonId}&weekNo=${weekNo}`;
        const g = await authFetch(url);
        if (g && g.code === 200 && g.result && g.result.guildInfo) {
          return { guildId: gid, guildName: g.result.guildInfo.guildNm, currentRanking: g.result.guildInfo.currentRanking, totalScore: g.result.guildInfo.totalScore, memberCount: (g.result.members || []).length };
        }
      } catch (e) {}
      return null;
    }));
    for (const r of results) if (r) found.push(r);
  }
  found.sort((a,b) => (a.currentRanking||999) - (b.currentRanking||999));
  guildListCache = { guilds: found, fetchedAt: now };
  return found;
}

app.get("/api/guilds", async (req, res) => {
  try {
    if (!session.cookies["JSESSIONID"]) return res.status(401).json({ error: "로그인 필요", requireAuth: true });
    const seasonId = parseInt(req.query.seasonId || "5", 10);
    const weekNo = parseInt(req.query.weekNo || "9", 10);
    const maxId = parseInt(req.query.maxId || "50", 10);
    const guilds = await discoverGuilds(seasonId, weekNo, maxId);
    res.json({ success: true, count: guilds.length, guilds });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/guild/:guildId", async (req, res) => {
  try {
    const gid = req.params.guildId;
    const seasonId = req.query.seasonId || 5;
    const weekNo = req.query.weekNo || 9;
    const url = `${API_BASE}/guild/${gid}/detail?guildSeasonId=${seasonId}&weekNo=${weekNo}`;
    const data = await authFetch(url);
    if (isUnauthenticatedResponse(data)) {
      invalidateSession("guild API rejected session");
      return res.status(401).json({ error: "세션이 만료되었습니다", requireAuth: true });
    }
    if (data.code !== 200) return res.status(404).json({ error: data.message });
    res.json(data.result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/secom/:mbrId", async (req, res) => {
  try {
    const mid = req.params.mbrId;
    const year = req.query.year;
    const month = String(req.query.month).padStart(2, "0");
    const url = `${API_BASE}/rest/secom/detail?mbrId=${mid}&year=${year}&month=${month}`;
    const data = await authFetch(url);
    if (isUnauthenticatedResponse(data)) {
      invalidateSession("SECOM API rejected session");
      return res.status(401).json({ error: "세션이 만료되었습니다", requireAuth: true });
    }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/aggregate", async (req, res) => {
  try {
    await tryAutoLoginFromEnv();
    if (!session.cookies["JSESSIONID"]) {
      return res.status(401).json({ error: "로그인이 필요합니다", requireAuth: true });
    }
    const { seasonId = 5, weekNo = 9,
            year = new Date().getFullYear(), month = new Date().getMonth() + 1 } = req.body || {};

    // 요청 본문의 guildIds/allGuilds는 의도적으로 무시한다.
    // UI, Actions, 외부 호출 모두 항상 3·4·5·6 길드 멤버를 하나의 memberMap으로 합친다.
    const targetGuildIds = [...TRACKED_GUILD_IDS];

    // 네 길드를 각각 조회한다. 일부 길드 실패를 숨긴 채 부분 데이터만 보여주지 않도록
    // 네 요청이 모두 성공해야 다음 단계로 진행한다.
    const guildResults = await Promise.all(targetGuildIds.map(async (gid) => {
      const url = `${API_BASE}/guild/${gid}/detail?guildSeasonId=${seasonId}&weekNo=${weekNo}`;
      const response = await authFetch(url);
      if (isUnauthenticatedResponse(response)) {
        invalidateSession(`guild ${gid} rejected session`);
        const err = new Error("세션이 만료되었습니다");
        err.status = 401;
        throw err;
      }
      if (!response || response.code !== 200 || !response.result) {
        const message = response && response.message ? response.message : "invalid response";
        throw new Error(`길드 조회 실패 (${gid}): ${message}`);
      }
      return response.result;
    }));

    // 네 길드의 member list를 mbrId 기준으로 하나의 Map에 병합한다.
    const { guilds, memberMap } = mergeTrackedGuilds(guildResults);

    const members = [];
    const dailyMap = new Map();
    const hourMap = new Map();
    const weekdayMap = new Map();
    const insideIds = new Set();
    const mm = String(month).padStart(2, "0");
    // KST 기준 오늘/어제. 밤샘 세션은 전날 레코드에 남으므로 입실 판정에 둘 다 쓴다.
    const { todayStr, yesterdayStr } = kstDateStrings();

    const mbrIds = Array.from(memberMap.keys());
    const BATCH = 5;
    for (let i = 0; i < mbrIds.length; i += BATCH) {
      const batch = mbrIds.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async mid => {
          try {
            const url = `${API_BASE}/rest/secom/detail?mbrId=${mid}&year=${year}&month=${mm}`;
            const data = await authFetch(url);
            if (isUnauthenticatedResponse(data)) throw new Error("unauthenticated");
            return [mid, data];
          } catch (err) { return [mid, { success: false, error: err.message }]; }
        })
      );
      for (const [mid, data] of results) {
        if (data.error === "unauthenticated") {
          invalidateSession("SECOM aggregate rejected session");
          return res.status(401).json({ error: "세션이 만료되었습니다", requireAuth: true });
        }
        const info = memberMap.get(mid);
        if (!data.success) {
          // 조회 결과가 없거나 개별 조회가 실패해도 전체 멤버 랭킹에는 0시간으로 유지한다.
          members.push({
            ...info,
            totalSeconds: 0,
            totalRawSeconds: 0,
            totalHours: 0,
            totalDuration: "00:00:00",
            attendedDays: 0,
            avgPerDay: 0,
            missingSessions: 0,
            wasCapped: false,
            days: [],
          });
          continue;
        }
        const detail = data.detail_list || [];
        const maxH = data.max_recog_hours || 12;
        const days = [];
        let totalSec = 0, totalRaw = 0, missing = 0, insideNow = false;

        for (const d of detail) {
          const parts = (d.daily_total_duration || "00:00:00").split(":").map(Number);
          const daySec = parts[0]*3600 + parts[1]*60 + (parts[2]||0);
          totalSec += daySec;
          let dayRaw = 0;
          for (const s of d.sessions || []) {
            dayRaw += s.duration_seconds || 0;
            if (s.is_missing) missing++;
            // 자정 롤오버 대응: 오늘뿐 아니라 어제 날짜의 열린 세션도 입실 중으로 본다.
            if (isCurrentlyInside(d.date, s, todayStr, yesterdayStr)) insideNow = true;
            accumulateHours(hourMap, s.entry_time, s.exit_time, s.duration_seconds, s.is_missing);
          }
          totalRaw += dayRaw;
          if (!dailyMap.has(d.date)) dailyMap.set(d.date, new Map());
          dailyMap.get(d.date).set(mid, daySec);
          const dow = new Date(d.date + "T00:00:00Z").getUTCDay();
          weekdayMap.set(dow, (weekdayMap.get(dow) || 0) + daySec);
          days.push({
            date: d.date, dayOfWeek: d.day_of_week, totalSeconds: daySec,
            totalDuration: d.daily_total_duration, sessionCount: d.session_count,
            sessions: (d.sessions || []).map(s => ({
              entry: s.entry_time, exit: s.exit_time || null,
              duration: s.duration || null, durationSeconds: s.duration_seconds || 0,
              isMissing: !!s.is_missing, missingType: s.missing_type || null,
            })),
          });
        }
        if (insideNow) insideIds.add(mid);
        members.push({
          ...info,
          totalSeconds: totalSec, totalRawSeconds: totalRaw,
          totalHours: Math.round(totalSec/3600*100)/100,
          totalDuration: formatDur(totalSec),
          attendedDays: days.length,
          avgPerDay: days.length ? Math.round(totalSec/days.length/3600*100)/100 : 0,
          missingSessions: missing, wasCapped: totalRaw > totalSec,
          days: days.sort((a,b)=>a.date.localeCompare(b.date)),
        });
      }
    }

    // 월 경계 롤오버 대응: 오늘이 1일(KST)이면 어제(전월 말일)의 열린 세션은
    // 전월 데이터에만 실려 있어 이번 달 집계만으로는 입실 목록이 하루 비게 된다.
    // 이 경우에만 전월 상세를 추가 조회해 어제 열린 세션 소유자를 입실 목록에 병합한다.
    const requestedKey = `${year}-${String(month).padStart(2, "0")}`;
    const isCurrentMonth = todayStr.startsWith(requestedKey);
    if (isCurrentMonth && !yesterdayStr.startsWith(requestedKey)) {
      const prev = prevYearMonth(year, month);
      const pmm = String(prev.month).padStart(2, "0");
      console.log(`[aggregate] 월 경계 감지 — 전월(${prev.year}-${pmm}) 미퇴실 세션 추가 조회`);
      for (let i = 0; i < mbrIds.length; i += BATCH) {
        const batch = mbrIds.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(async mid => {
            try {
              const url = `${API_BASE}/rest/secom/detail?mbrId=${mid}&year=${prev.year}&month=${pmm}`;
              const data = await authFetch(url);
              if (isUnauthenticatedResponse(data)) throw new Error("unauthenticated");
              return [mid, data];
            } catch (err) { return [mid, { success: false, error: err.message }]; }
          })
        );
        for (const [mid, data] of results) {
          if (data.error === "unauthenticated") {
            invalidateSession("SECOM aggregate rejected session (prev-month pass)");
            return res.status(401).json({ error: "세션이 만료되었습니다", requireAuth: true });
          }
          if (!data.success) continue;
          if (hasOpenSessionOn(data.detail_list || [], yesterdayStr)) insideIds.add(mid);
        }
      }
    }

    const currentlyInside = Array.from(insideIds).map(mid => {
      const info = memberMap.get(mid) || {};
      return { mbrId: mid, name: info.name, level: info.level, profileImage: info.profileImage };
    });

    const dailyStats = Array.from(dailyMap.entries()).map(([date, map]) => {
      const ms = Array.from(map.entries()).map(([mid, sec]) => ({
        mbrId: mid, name: (memberMap.get(mid) || {}).name || mid, seconds: sec, duration: formatDur(sec),
      })).sort((a,b)=>b.seconds-a.seconds);
      const t = ms.reduce((s,m)=>s+m.seconds,0);
      return { date, totalSeconds: t, totalDuration: formatDur(t),
               totalHours: Math.round(t/3600*100)/100,
               attendance: ms.filter(m=>m.seconds>0).length, members: ms };
    }).sort((a,b)=>a.date.localeCompare(b.date));

    const wm = new Map();
    for (const d of dailyStats) {
      const wk = getWeekOfMonth(d.date);
      if (!wm.has(wk)) wm.set(wk, { week: wk, totalSeconds: 0, days: 0, attendance: 0 });
      const w = wm.get(wk);
      w.totalSeconds += d.totalSeconds; w.days++; w.attendance += d.attendance;
    }
    const weeklyStats = Array.from(wm.values()).map(w => ({
      ...w, totalDuration: formatDur(w.totalSeconds),
      totalHours: Math.round(w.totalSeconds/3600*100)/100,
      avgAttendance: Math.round(w.attendance/w.days*10)/10,
    }));

    const hourStats = Array.from({length:24}, (_,h) => ({
      hour: h, label: `${String(h).padStart(2,'0')}:00`,
      totalPersonSeconds: hourMap.get(h)||0,
      totalPersonHours: Math.round((hourMap.get(h)||0)/3600*10)/10,
    }));
    const dowNames = ["일","월","화","수","목","금","토"];
    const weekdayStats = Array.from({length:7}, (_,d) => ({
      day: d, dayName: dowNames[d],
      totalSeconds: weekdayMap.get(d)||0,
      totalHours: Math.round((weekdayMap.get(d)||0)/3600*10)/10,
    }));

    res.json({
      meta: {
        year, month,
        guildIds: targetGuildIds,
        guildScope: "fixed-3-6",
        guilds,
        totalMembers: members.length,
        totalActiveMembers: members.filter(m=>m.totalSeconds>0).length,
        collectedAt: new Date().toISOString(), todayStr,
        loggedInAs: session.userId,
        authMode: process.env.CODYSSEY_SESSION ? "session-env" :
                  (process.env.CODYSSEY_ID ? "credentials-env" : "interactive"),
        githubSync: githubSync.getStatus(),
      },
      members: members.sort((a,b)=>b.totalSeconds-a.totalSeconds),
      topMembers: members.filter(m=>m.totalSeconds>0).sort((a,b)=>b.totalSeconds-a.totalSeconds).slice(0,50),
      daily: dailyStats, weekly: weeklyStats, hourly: hourStats, weekday: weekdayStats,
      records: {
        topDayByAttendance: [...dailyStats].sort((a,b)=>b.attendance-a.attendance)[0]||null,
        topDayByHours: [...dailyStats].sort((a,b)=>b.totalSeconds-a.totalSeconds)[0]||null,
        topWeek: [...weeklyStats].sort((a,b)=>b.totalSeconds-a.totalSeconds)[0]||null,
        peakHour: [...hourStats].sort((a,b)=>b.totalPersonSeconds-a.totalPersonSeconds)[0]||null,
      },
      currentlyInside,
    });
  } catch (err) {
    console.error("Aggregate error:", err);
    const status = Number.isInteger(err.status) ? err.status : 500;
    res.status(status).json({ error: err.message, requireAuth: status === 401 });
  }
});

function formatDur(sec) {
  if (!sec || sec < 0) sec = 0;
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function accumulateHours(hourMap, entryStr, exitStr, durationSec, isMissing) {
  if (!entryStr) return;
  const [eh, em, es] = entryStr.split(":").map(Number);
  const entryS = eh*3600 + em*60 + (es||0);
  let endS;
  if (!exitStr || isMissing) {
    const n = new Date(Date.now()+9*3600*1000);
    endS = n.getUTCHours()*3600 + n.getUTCMinutes()*60 + n.getUTCSeconds();
    if (endS <= entryS) return;
  } else {
    const [xh, xm, xs] = exitStr.split(":").map(Number);
    endS = xh*3600 + xm*60 + (xs||0);
  }
  if (endS <= entryS) return;
  let cur = entryS;
  while (cur < endS) {
    const h = Math.floor(cur/3600);
    const nextH = (h+1)*3600;
    hourMap.set(h, (hourMap.get(h)||0) + Math.min(nextH, endS) - cur);
    cur = nextH;
  }
}

function getWeekOfMonth(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const offset = (first.getUTCDay() + 6) % 7;
  return Math.floor((d.getUTCDate() + offset - 1)/7) + 1;
}

// 기동 시 자동 로그인 시도 (CI 환경 등)
app.listen(PORT, async () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   SECOM Dashboard Server                     ║
║   http://localhost:${PORT}                   ║
╚══════════════════════════════════════════════╝`);
  await tryAutoLoginFromEnv();
});
