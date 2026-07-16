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

test("로그인 시 JSESSIONID 저장 후 수집 workflow를 즉시 실행한다", () => {
  const loginRoute = sourceBetween(serverSource, 'app.post("/api/login"', 'app.post("/api/logout"');
  assert.match(loginRoute, /const githubSynced = await syncSessionToGitHub\(\)/);
  assert.match(loginRoute, /githubSyncError/);
  assert.match(serverSource, /const IS_CODESPACES = process\.env\.CODESPACES === "true"/);
  assert.match(serverSource, /GITHUB_TOKEN_SOURCE/);
  assert.match(serverSource, /actions\/workflows\/collect\.yml\/dispatches/);
  assert.match(serverSource, /workflowTriggered = true/);
});

test("동기화 실패 시 서버의 실제 GitHub API 오류를 표시한다", () => {
  const syncUi = sourceBetween(appHtml, "async function syncToGithub", "async function fetchAggregate");
  const syncRoute = sourceBetween(serverSource, 'app.post("/api/sync-github"', 'app.post("/api/login"');
  assert.match(syncUi, /data\.error \|\| data\.lastError/);
  assert.match(syncUi, /data\.tokenSource/);
  assert.match(syncRoute, /error, \.\.\.githubSyncStatus/);
});

test("정적 Pages에 세션이 없으면 Codespace 로그인 버튼을 표시한다", () => {
  assert.match(appHtml, /function publicSessionSetupHtml\(message\)/);
  assert.match(appHtml, /Codespace 실행하고 로그인하기/);
  assert.match(appHtml, /document\.getElementById\('app'\)\.innerHTML = publicSessionSetupHtml\(err\.message\)/);
});
