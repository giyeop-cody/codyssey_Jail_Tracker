"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appHtml = fs.readFileSync(path.join(__dirname, "../public/app.html"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `시작 마커 없음: ${start}`);
  assert.notEqual(endIndex, -1, `종료 마커 없음: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("aggregate 401 응답을 메시지가 아닌 인증 상태로 구분한다", () => {
  const fetchAggregate = sourceBetween(appHtml, "async function fetchAggregate", "function fmtDur");
  assert.match(fetchAggregate, /res\.status === 401 \|\| data\.requireAuth/);
  assert.match(fetchAggregate, /authError\.requireAuth = true/);
});

test("세션 만료 시 새로고침 반복 대신 로그인 화면을 표시한다", () => {
  const loadData = sourceBetween(appHtml, "async function loadData", "function render");
  assert.match(loadData, /if \(err\.requireAuth\)/);
  assert.match(loadData, /showLoginScreen\('세션이 만료되었습니다/);
  assert.doesNotMatch(loadData, /location\.reload/);
});

test("서버는 인증 거부 시 메모리와 디스크의 만료 세션을 제거한다", () => {
  assert.match(serverSource, /function invalidateSession\(reason = ""\)/);
  assert.match(serverSource, /isUnauthenticatedResponse\(response\)/);
  assert.match(serverSource, /invalidateSession\(`guild \$\{gid\} rejected session`\)/);
  assert.match(serverSource, /invalidateSession\("SECOM aggregate rejected session"\)/);
});

test("로그인 응답 전에 새 JSESSIONID를 GitHub Secret에 동기화한다", () => {
  const loginRoute = sourceBetween(serverSource, 'app.post("/api/login"', 'app.post("/api/logout"');
  assert.match(loginRoute, /const githubSynced = await syncSessionToGitHub\(\)/);
  assert.match(loginRoute, /githubSyncError/);
});
