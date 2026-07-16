#!/usr/bin/env node
/**
 * SECOM 출입/학습시간 수집 스크립트
 *
 * API: https://api.usr.codyssey.kr/rest/secom/detail?mbrId={mbrId}&year={year}&month={month}
 *
 * 사용법:
 *   # 특정 멤버 단일 조회
 *   node collect_secom.js --mbrid 1000271067 --year 2026 --month 7
 *
 *   # 여러 멤버 조회 (콤마 구분)
 *   node collect_secom.js --mbrids 1000271067,1000267035,1000269049
 *
 *   # 길드 수집 결과 파일의 멤버 전체에 대해 조회
 *   node collect_secom.js --from-guild guild_members.json --include-private
 *
 *   # 연/월 지정
 *   node collect_secom.js --from-guild guild_members.json --year 2026 --month 7
 *
 *   # 출력 지정
 *   node collect_secom.js --from-guild guild_members.json --output secom_result.json
 */

const fs = require("fs");
const path = require("path");

const CONFIG = {
  baseUrl: "https://api.usr.codyssey.kr/rest/secom/detail",
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  mbrIds: null,
  fromGuildFile: null,
  outputFile: "secom_result.json",
  delayMs: 300,
  timeoutMs: 10000,
  retries: 2,
  includePrivateFields: false,
};

function parseArgs() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--mbrid":
        CONFIG.mbrIds = [args[++i]];
        break;
      case "--mbrids":
        CONFIG.mbrIds = args[++i].split(",").map((s) => s.trim());
        break;
      case "--from-guild":
        CONFIG.fromGuildFile = args[++i];
        break;
      case "--year":
        CONFIG.year = parseInt(args[++i], 10);
        break;
      case "--month":
        CONFIG.month = parseInt(args[++i], 10);
        break;
      case "--output":
        CONFIG.outputFile = args[++i];
        break;
      case "--delay":
        CONFIG.delayMs = parseInt(args[++i], 10);
        break;
      case "--include-private":
        CONFIG.includePrivateFields = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }
}

function printHelp() {
  console.log(`
SECOM 학습시간 수집 스크립트

옵션:
  --mbrid <id>              단일 멤버 ID
  --mbrids <id1,id2,...>    여러 멤버 ID
  --from-guild <파일>       길드 수집 결과 JSON의 멤버 전체에 대해 수집
  --year <연도>             조회 연도 (기본: 올해)
  --month <월>              조회 월 (기본: 이번달)
  --output <파일>           출력 파일 (기본: secom_result.json)
  --delay <ms>              요청 간 딜레이 (기본: 300ms)
  --include-private         길드 파일에서 mbrId를 읽으려면 필수
  -h, --help                도움말
  `);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(mbrId) {
  const mm = String(CONFIG.month).padStart(2, "0");
  return `${CONFIG.baseUrl}?mbrId=${mbrId}&year=${CONFIG.year}&month=${mm}`;
}

async function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function fetchSecom(mbrId) {
  const url = buildUrl(mbrId);
  let lastErr;
  for (let attempt = 0; attempt <= CONFIG.retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, CONFIG.timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { mbrId, success: data.success, data, error: null };
    } catch (err) {
      lastErr = err;
      if (attempt < CONFIG.retries) await sleep(500 * (attempt + 1));
    }
  }
  return { mbrId, success: false, data: null, error: lastErr ? lastErr.message : "unknown" };
}

/**
 * 일별 세션 요약 및 통계 계산
 */
function summarizeMember(mbrId, name, data) {
  const detailList = (data && data.detail_list) || [];
  const maxHours = (data && data.max_recog_hours) || 12;
  const note = data && data.note;

  let totalSeconds = 0;
  let actualSeconds = 0; // daily_total_duration 기준 (12시간 상한 적용)
  let sessionCount = 0;
  let missingCount = 0;
  const days = [];

  for (const d of detailList) {
    let dayActualSec = 0;
    const dailyTotal = d.daily_total_duration || "00:00:00";
    const parts = dailyTotal.split(":").map(Number);
    dayActualSec = parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);

    let dayRawSec = 0;
    for (const s of d.sessions || []) {
      dayRawSec += s.duration_seconds || 0;
      if (s.is_missing) missingCount++;
    }
    sessionCount += d.session_count || 0;

    totalSeconds += dayRawSec;
    actualSeconds += dayActualSec;

    days.push({
      date: d.date,
      dayOfWeek: d.day_of_week,
      sessionCount: d.session_count,
      dailyTotalDuration: d.daily_total_duration,
      dailyTotalSeconds: dayActualSec,
      rawTotalSeconds: dayRawSec,
      wasCapped: dayRawSec > dayActualSec && dayActualSec >= maxHours * 3600 - 60,
      hasMissing: (d.sessions || []).some((s) => s.is_missing),
      sessions: (d.sessions || []).map((s) => ({
        sessionNo: s.session_no,
        entryTime: s.entry_time,
        exitTime: s.exit_time || null,
        duration: s.duration || null,
        durationSeconds: s.duration_seconds || 0,
        isMissing: s.is_missing || false,
        missingType: s.missing_type || null,
        isAddTime: s.is_add_time || false,
      })),
    });
  }

  const attendedDays = days.length;
  const hours = actualSeconds / 3600;
  const avgHoursPerDay = attendedDays > 0 ? hours / attendedDays : 0;

  return {
    mbrId: CONFIG.includePrivateFields ? mbrId : undefined,
    name: name || null,
    year: CONFIG.year,
    month: String(CONFIG.month).padStart(2, "0"),
    maxRecogHoursPerDay: maxHours,
    note: note || null,
    attendedDays,
    totalSessions: sessionCount,
    missingSessions: missingCount,
    totalRawSeconds: totalSeconds,
    totalRawDuration: formatDuration(totalSeconds),
    totalRecognizedSeconds: actualSeconds,
    totalRecognizedDuration: formatDuration(actualSeconds),
    recognizedHours: Math.round(hours * 100) / 100,
    avgHoursPerAttendedDay: Math.round(avgHoursPerDay * 100) / 100,
    days: days.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function loadTargetsFromGuildFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const targets = [];
  const seen = new Set();
  const guilds = raw.guilds || [];
  for (const g of guilds) {
    for (const m of g.members || []) {
      if (m.mbrId && !seen.has(m.mbrId)) {
        seen.add(m.mbrId);
        targets.push({ mbrId: m.mbrId, name: m.name || m.mbrNm });
      }
    }
  }
  if (targets.length === 0) {
    console.log("⚠️  경고: 길드 파일에서 mbrId를 찾지 못했습니다.");
    console.log("    길드 수집 시 --include-private 옵션을 사용해 mbrId를 포함시켜 주세요.");
  }
  return targets;
}

async function main() {
  parseArgs();

  let targets = [];

  if (CONFIG.fromGuildFile) {
    if (!CONFIG.includePrivateFields) {
      console.log("⚠️  --from-guild 사용 시 --include-private 옵션이 필요합니다.");
      console.log("    (개인 식별자인 mbrId가 필요하기 때문)");
      console.log("    계속 진행하려면 명령어에 --include-private를 추가하세요.");
      process.exit(1);
    }
    targets = loadTargetsFromGuildFile(CONFIG.fromGuildFile);
  } else if (CONFIG.mbrIds) {
    targets = CONFIG.mbrIds.map((id) => ({ mbrId: id, name: null }));
  } else {
    console.log("❌ 대상을 지정해주세요: --mbrid, --mbrids, 또는 --from-guild");
    printHelp();
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   SECOM 학습시간 수집기                      ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`대상 멤버: ${targets.length}명`);
  console.log(`조회 기간: ${CONFIG.year}년 ${CONFIG.month}월`);
  console.log(`요청 딜레이: ${CONFIG.delayMs}ms`);
  console.log(`출력 파일: ${CONFIG.outputFile}`);
  console.log("");

  const results = [];
  const failed = [];

  for (let i = 0; i < targets.length; i++) {
    const { mbrId, name } = targets[i];
    const progress = `[${i + 1}/${targets.length}]`;
    const res = await fetchSecom(mbrId);

    if (!res.success) {
      console.log(`${progress} ${name || mbrId} → ❌ 실패 (${res.error})`);
      failed.push({ mbrId, name, error: res.error });
    } else {
      const summary = summarizeMember(mbrId, name, res.data);
      results.push(summary);
      console.log(
        `${progress} ${name || mbrId} → ✅ ${summary.attendedDays}일 / ${summary.totalRecognizedDuration} (누적 ${summary.recognizedHours}시간)`
      );
      if (summary.note) {
        console.log(`         ℹ️  ${summary.note}`);
      }
    }

    if (i < targets.length - 1) await sleep(CONFIG.delayMs);
  }

  // 전체 통계
  const totalSeconds = results.reduce((s, r) => s + r.totalRecognizedSeconds, 0);
  const totalDays = results.reduce((s, r) => s + r.attendedDays, 0);
  const totalMissing = results.reduce((s, r) => s + r.missingSessions, 0);
  const ranked = [...results].sort((a, b) => b.totalRecognizedSeconds - a.totalRecognizedSeconds);

  const output = {
    meta: {
      collectedAt: new Date().toISOString(),
      year: CONFIG.year,
      month: String(CONFIG.month).padStart(2, "0"),
      totalMembersRequested: targets.length,
      membersSucceeded: results.length,
      membersFailed: failed.length,
      totalAttendedDays: totalDays,
      totalStudySeconds: totalSeconds,
      totalStudyDuration: formatDuration(totalSeconds),
      totalStudyHours: Math.round((totalSeconds / 3600) * 100) / 100,
      totalMissingSessions: totalMissing,
    },
    ranking: ranked.map((r, idx) => ({
      rank: idx + 1,
      name: r.name,
      attendedDays: r.attendedDays,
      totalHours: r.recognizedHours,
      totalDuration: r.totalRecognizedDuration,
      avgHoursPerDay: r.avgHoursPerAttendedDay,
      missingSessions: r.missingSessions,
    })),
    members: results,
    failed: failed,
  };

  const outPath = path.resolve(CONFIG.outputFile);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");

  console.log("");
  console.log("══════════════════ 결과 요약 ══════════════════");
  console.log(`✅ 성공: ${results.length}명 / ❌ 실패: ${failed.length}명`);
  console.log(`📅 총 출석일: ${totalDays}일`);
  console.log(`⏱️  총 학습시간: ${formatDuration(totalSeconds)} (${(totalSeconds / 3600).toFixed(1)}시간)`);
  if (totalMissing > 0) console.log(`⚠️  미처리 세션: ${totalMissing}건 (퇴실 미기록 등)`);
  console.log("");
  console.log("🏆 Top 5 학습시간:");
  ranked.slice(0, 5).forEach((r, i) => {
    console.log(
      `   ${i + 1}. ${r.name || r.mbrId} - ${r.totalRecognizedDuration} (${r.attendedDays}일, 일평균 ${r.avgHoursPerAttendedDay}h)`
    );
  });
  console.log(`📁 저장 파일: ${outPath}`);
  console.log("═══════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
