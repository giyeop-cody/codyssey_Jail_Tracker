"use strict";

// 길드 시즌/주차 결정 규칙 (단일화 — 과거엔 server.js 여러 곳이 각자 기본값을 들고 있었다).
// 우선순위: env(GUILD_SEASON/GUILD_WEEK 둘 다 유효할 때만) > 허브 로스터 meta(season/week) > 기본 상수.
// 허브 meta는 공유 로스터 허브가 수집 시 심는 값 — 소비자는 허브 vars만 고치면 따라간다.

const DEFAULT_GUILD_SEASON = 5;
const DEFAULT_GUILD_WEEK = 9;

function asInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

// 반환: { seasonId, weekNo, source: "env" | "roster" | "default" }
function resolveSeasonWeek({ env = {}, roster = null } = {}) {
  const envSeason = asInt(env.GUILD_SEASON);
  const envWeek = asInt(env.GUILD_WEEK);
  if (envSeason != null && envWeek != null) {
    return { seasonId: envSeason, weekNo: envWeek, source: "env" };
  }

  const metaSeason = asInt(roster && roster.season);
  const metaWeek = asInt(roster && roster.week);
  if (metaSeason != null && metaWeek != null) {
    return { seasonId: metaSeason, weekNo: metaWeek, source: "roster" };
  }

  return { seasonId: DEFAULT_GUILD_SEASON, weekNo: DEFAULT_GUILD_WEEK, source: "default" };
}

module.exports = { DEFAULT_GUILD_SEASON, DEFAULT_GUILD_WEEK, resolveSeasonWeek };
