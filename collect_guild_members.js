#!/usr/bin/env node
/**
 * 코디시 길드 멤버 정보 수집 스크립트
 *
 * 사용법:
 *   node collect_guild_members.js                       # 기본 설정 (guildId 1~100)
 *   node collect_guild_members.js --start 1 --end 50    # guildId 1~50
 *   node collect_guild_members.js --guilds 4,5,6,10     # 지정된 guildId만
 *   node collect_guild_members.js --season 5 --week 9   # 시즌/주차 변경
 *   node collect_guild_members.js --output result.json  # 출력 파일 지정
 *   node collect_guild_members.js --delay 500           # 요청 간 지연(ms)
 *   node collect_guild_members.js --include-email       # 이메일 포함 (기본: 제외)
 *
 * 결과물:
 *   - {output} 파일에 수집된 모든 길드/멤버 정보가 JSON으로 저장됨
 *   - 콘솔에 진행 상황 실시간 출력
 */

const fs = require("fs");
const path = require("path");

// ---------- 기본 설정 ----------
const CONFIG = {
  baseUrl: "https://api.usr.codyssey.kr/guild",
  guildSeasonId: 5,
  weekNo: 9,
  startGuild: 1,
  endGuild: 100,
  guilds: null, // 명시적 목록이 있으면 그것만 사용
  outputFile: "guild_members.json",
  delayMs: 300, // 요청 간 딜레이 (밀리초)
  timeoutMs: 10000, // 요청 타임아웃
  retries: 2, // 실패 시 재시도 횟수
  includeEmail: false, // 이메일 포함 여부
  includePrivateFields: false, // mbrId 등 내부 식별자 포함 여부
};

// ---------- CLI 인자 파싱 ----------
function parseArgs() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--start":
        CONFIG.startGuild = parseInt(args[++i], 10);
        break;
      case "--end":
        CONFIG.endGuild = parseInt(args[++i], 10);
        break;
      case "--guilds":
        CONFIG.guilds = args[++i].split(",").map((n) => parseInt(n.trim(), 10));
        break;
      case "--season":
        CONFIG.guildSeasonId = parseInt(args[++i], 10);
        break;
      case "--week":
        CONFIG.weekNo = parseInt(args[++i], 10);
        break;
      case "--output":
        CONFIG.outputFile = args[++i];
        break;
      case "--delay":
        CONFIG.delayMs = parseInt(args[++i], 10);
        break;
      case "--timeout":
        CONFIG.timeoutMs = parseInt(args[++i], 10);
        break;
      case "--retries":
        CONFIG.retries = parseInt(args[++i], 10);
        break;
      case "--include-email":
        CONFIG.includeEmail = true;
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
코디시 길드 멤버 수집 스크립트

옵션:
  --start <번호>        시작 길드 번호 (기본: 1)
  --end <번호>          끝 길드 번호 (기본: 100)
  --guilds <목록>       콤마로 구분된 길드 번호들 (예: 4,5,6)
  --season <번호>       길드 시즌 ID (기본: 5)
  --week <번호>         주차 번호 (기본: 9)
  --output <파일>       결과 저장 파일명 (기본: guild_members.json)
  --delay <ms>          요청 간 딜레이 ms (기본: 300)
  --timeout <ms>        요청 타임아웃 ms (기본: 10000)
  --retries <횟수>      실패 시 재시도 횟수 (기본: 2)
  --include-email       이메일 주소 포함 (기본: 제외)
  --include-private     mbrId 등 내부 식별자 포함 (기본: 제외)
  -h, --help            도움말
  `);
}

// ---------- 유틸 ----------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(guildId) {
  return `${CONFIG.baseUrl}/${guildId}/detail?guildSeasonId=${CONFIG.guildSeasonId}&weekNo=${CONFIG.weekNo}`;
}

/**
 * 타임아웃이 적용된 fetch
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * 단일 길드 데이터 요청 (재시도 포함)
 */
async function fetchGuild(guildId) {
  const url = buildUrl(guildId);
  let lastErr;

  for (let attempt = 0; attempt <= CONFIG.retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {}, CONFIG.timeoutMs);
      if (res.status === 404 || res.status === 400) {
        return { guildId, exists: false, status: res.status };
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.code !== 200) {
        return { guildId, exists: false, message: data.message };
      }
      return { guildId, exists: true, data: data.result };
    } catch (err) {
      lastErr = err;
      if (attempt < CONFIG.retries) {
        await sleep(500 * (attempt + 1));
      }
    }
  }
  return { guildId, exists: false, error: lastErr ? lastErr.message : "unknown" };
}

/**
 * 멤버 데이터 정제 (필요한 필드만 추출)
 */
function sanitizeMember(m) {
  const out = {
    name: m.mbrNm,
    level: m.level,
    personalScore: m.personalScore,
    scoreChange: m.scoreChange,
    personalRanking: m.personalRanking,
    previousPersonalRanking: m.previousPersonalRanking,
    rankingChange: m.rankingChange,
    contributionRate: m.contributionRate,
    location: m.location,
  };
  if (CONFIG.includeEmail) out.email = m.emlAddr;
  if (CONFIG.includePrivateFields) {
    out.mbrId = m.mbrId;
    out.profileImage = m.profImgPath;
  }
  return out;
}

/**
 * 길드 데이터 정제
 */
function sanitizeGuild(guildId, result) {
  const info = result.guildInfo || {};
  return {
    guildId,
    guildName: info.guildNm,
    currentRanking: info.currentRanking,
    totalScore: info.totalScore,
    memberCount: (result.members || []).length,
    members: (result.members || []).map(sanitizeMember),
  };
}

// ---------- 메인 수집 로직 ----------
async function main() {
  parseArgs();

  let targets;
  if (CONFIG.guilds && Array.isArray(CONFIG.guilds)) {
    targets = CONFIG.guilds;
  } else {
    targets = [];
    for (let i = CONFIG.startGuild; i <= CONFIG.endGuild; i++) targets.push(i);
  }

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   코디시 길드 멤버 수집기                    ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`대상 길드: ${targets.length}개 (${targets[0]} ~ ${targets[targets.length - 1]})`);
  console.log(`시즌: ${CONFIG.guildSeasonId}, 주차: ${CONFIG.weekNo}`);
  console.log(`요청 딜레이: ${CONFIG.delayMs}ms`);
  console.log(`이메일 포함: ${CONFIG.includeEmail ? "예" : "아니오"}`);
  console.log(`출력 파일: ${CONFIG.outputFile}`);
  console.log("");

  const guilds = [];
  const failed = [];
  const empty = [];

  let processed = 0;
  for (const gid of targets) {
    processed++;
    const progress = `[${processed}/${targets.length}]`;

    const result = await fetchGuild(gid);

    if (!result.exists) {
      if (result.error) {
        console.log(`${progress} 길드 #${gid} → ❌ 실패 (${result.error})`);
        failed.push({ guildId: gid, reason: result.error });
      } else if (result.status === 404 || result.status === 400) {
        console.log(`${progress} 길드 #${gid} → ⚪ 없음 (${result.status})`);
        empty.push(gid);
      } else {
        console.log(`${progress} 길드 #${gid} → ⚪ 없음`);
        empty.push(gid);
      }
    } else {
      const g = sanitizeGuild(gid, result.data);
      guilds.push(g);
      const rankStr = g.currentRanking ? `#${g.currentRanking}` : "-";
      console.log(
        `${progress} 길드 #${gid} "${g.guildName}" → ✅ 랭킹 ${rankStr}, 점수 ${g.totalScore}, 멤버 ${g.memberCount}명`
      );
    }

    if (gid !== targets[targets.length - 1]) {
      await sleep(CONFIG.delayMs);
    }
  }

  // ---------- 통계 ----------
  const totalMembers = guilds.reduce((sum, g) => sum + g.memberCount, 0);
  const totalScore = guilds.reduce((sum, g) => sum + (g.totalScore || 0), 0);

  // 멤버 중복 제거 집계 (이메일 또는 mbrId 기준)
  const uniqueKey = CONFIG.includeEmail ? "email" : "name";
  const uniqueMembers = new Map();
  for (const g of guilds) {
    for (const m of g.members) {
      const key = m[uniqueKey] || `${g.guildId}:${m.name}`;
      if (!uniqueMembers.has(key)) {
        uniqueMembers.set(key, { ...m, guilds: [g.guildName] });
      } else {
        uniqueMembers.get(key).guilds.push(g.guildName);
      }
    }
  }

  const output = {
    meta: {
      collectedAt: new Date().toISOString(),
      seasonId: CONFIG.guildSeasonId,
      weekNo: CONFIG.weekNo,
      totalGuildsRequested: targets.length,
      guildsFound: guilds.length,
      guildsEmpty: empty.length,
      guildsFailed: failed.length,
      totalMembers,
      uniqueMembers: uniqueMembers.size,
      totalScoreSum: totalScore,
    },
    guilds: guilds.sort((a, b) => (a.currentRanking || 9999) - (b.currentRanking || 9999)),
    failedGuilds: failed,
    emptyGuilds: empty,
    allMembers: Array.from(uniqueMembers.values()).sort(
      (a, b) => (b.personalScore || 0) - (a.personalScore || 0)
    ),
  };

  // ---------- 저장 ----------
  const outPath = path.resolve(CONFIG.outputFile);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");

  console.log("");
  console.log("══════════════════ 결과 요약 ══════════════════");
  console.log(`✅ 수집 성공 길드 : ${guilds.length}`);
  console.log(`⚪ 빈/없음 길드   : ${empty.length}`);
  console.log(`❌ 실패 길드       : ${failed.length}`);
  console.log(`👥 총 멤버 수      : ${totalMembers} (중복 제외 ${uniqueMembers.size})`);
  console.log(`💯 총 점수 합계    : ${totalScore.toLocaleString()}`);
  console.log(`📁 저장 파일       : ${outPath}`);
  console.log("═══════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
