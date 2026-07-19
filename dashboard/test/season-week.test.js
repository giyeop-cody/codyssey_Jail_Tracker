"use strict";

// 시즌/주차 결정 규칙 단위 테스트 (순수 함수 — 네트워크 없음)

const assert = require("node:assert/strict");
const test = require("node:test");
const { DEFAULT_GUILD_SEASON, DEFAULT_GUILD_WEEK, resolveSeasonWeek } = require("../lib/season-week");

test("env 둘 다 유효 → env가 최우선 (roster meta보다 앞섬)", () => {
  const r = resolveSeasonWeek({
    env: { GUILD_SEASON: "6", GUILD_WEEK: "1" },
    roster: { season: 5, week: 9 },
  });
  assert.deepEqual(r, { seasonId: 6, weekNo: 1, source: "env" });
});

test("env 일부만 있으면 env 미적용 → roster meta 사용", () => {
  const r = resolveSeasonWeek({
    env: { GUILD_SEASON: "6" },
    roster: { season: 5, week: 9 },
  });
  assert.deepEqual(r, { seasonId: 5, weekNo: 9, source: "roster" });
});

test("env 없고 roster meta 유효 → roster", () => {
  const r = resolveSeasonWeek({ env: {}, roster: { season: 5, week: 12 } });
  assert.deepEqual(r, { seasonId: 5, weekNo: 12, source: "roster" });
});

test("아무것도 없으면 기본 상수", () => {
  const r = resolveSeasonWeek({ env: {} });
  assert.deepEqual(r, { seasonId: DEFAULT_GUILD_SEASON, weekNo: DEFAULT_GUILD_WEEK, source: "default" });
});

test("roster meta가 숫자가 아니면(구버전 파일) 기본 상수로 폰백", () => {
  const r = resolveSeasonWeek({ env: {}, roster: { season: null, week: null, members: [{}] } });
  assert.equal(r.source, "default");
});
