"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { isCurrentlyInside, isOpenSession, kstDateStrings } = require("../lib/open-session");

const SERVER_JS = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

// 자정 롤오버 직후 순간: UTC 2026-07-18 15:17 == KST 2026-07-19 00:17
const ROLLOVER_MS = Date.UTC(2026, 6, 18, 15, 17, 0);

test("자정 직후 KST 오늘/어제 문자열 계산", () => {
  const { todayStr, yesterdayStr } = kstDateStrings(ROLLOVER_MS);
  assert.equal(todayStr, "2026-07-19");
  assert.equal(yesterdayStr, "2026-07-18");
});

test("월 경계 롤오버에서 어제는 전월 말일", () => {
  // KST 2026-08-01 00:30 == UTC 2026-07-31 15:30
  const { todayStr, yesterdayStr } = kstDateStrings(Date.UTC(2026, 6, 31, 15, 30, 0));
  assert.equal(todayStr, "2026-08-01");
  assert.equal(yesterdayStr, "2026-07-31");
});

test("연 경계 롤오버에서 어제는 전년 12월 31일", () => {
  // KST 2027-01-01 00:10 == UTC 2026-12-31 15:10
  const { todayStr, yesterdayStr } = kstDateStrings(Date.UTC(2026, 11, 31, 15, 10, 0));
  assert.equal(todayStr, "2027-01-01");
  assert.equal(yesterdayStr, "2026-12-31");
});

const openSession = { entry_time: "23:05:00", exit_time: null, is_missing: true, duration_seconds: 0 };
const closedSession = { entry_time: "21:00:00", exit_time: "23:50:00", is_missing: false, duration_seconds: 10200 };

test("버그 재현 케이스: 밤샘 중인 어제 세션도 입실 중이다", () => {
  // 자정 이후라 세션 날짜가 어제여도, 퇴실 안 했으면 입실 유지
  assert.equal(isCurrentlyInside("2026-07-18", openSession, "2026-07-19", "2026-07-18"), true);
});

test("오늘 날짜의 열린 세션은 종전대로 입실 중", () => {
  assert.equal(isCurrentlyInside("2026-07-19", openSession, "2026-07-19", "2026-07-18"), true);
});

test("어제 퇴실한 사람은 입실 중이 아니다", () => {
  assert.equal(isCurrentlyInside("2026-07-18", closedSession, "2026-07-19", "2026-07-18"), false);
});

test("그제 이전의 열린 세션은 유령 방지를 위해 입실로 보지 않는다", () => {
  assert.equal(isCurrentlyInside("2026-07-17", openSession, "2026-07-19", "2026-07-18"), false);
});

test("퇴실이 없어도 is_missing이 아니면 입실로 보지 않는다 (종전 의미 유지)", () => {
  const weird = { entry_time: "22:00:00", exit_time: null, is_missing: false };
  assert.equal(isOpenSession(weird), false);
  assert.equal(isCurrentlyInside("2026-07-19", weird, "2026-07-19", "2026-07-18"), false);
});

test("입실 기록 자체가 없으면 입실 중이 아니다", () => {
  const noEntry = { entry_time: null, exit_time: null, is_missing: true };
  assert.equal(isCurrentlyInside("2026-07-18", noEntry, "2026-07-19", "2026-07-18"), false);
});

test("server.js가 롤오버 판정 함수를 사용하도록 배선되어 있다", () => {
  assert.ok(SERVER_JS.includes('require("./lib/open-session")'), "open-session require 누락");
  assert.ok(SERVER_JS.includes("isCurrentlyInside(d.date, s, todayStr, yesterdayStr)"), "입실 판정 호출 누락");
  // 과거 구현(오늘 날짜 게이트) 부활 방지
  assert.equal(SERVER_JS.includes("d.date === todayStr && !s.exit_time"), false, "오늘 날짜 게이트 부활");
});
