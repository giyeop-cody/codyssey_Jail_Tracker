"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createGitHubSyncService, resolveGitHubConfig } = require("../lib/github-sync");

function response(status, body = null) {
  const text = body == null ? "" : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; },
    async text() { return text; },
  };
}

function logger() {
  return { log() {}, error() {}, warn() {} };
}

test("Codespaces에서는 GH_PAT_SYNC만 사용하고 기본 GITHUB_TOKEN으로 대체하지 않는다", () => {
  assert.deepEqual(resolveGitHubConfig({
    CODESPACES: "true",
    GITHUB_TOKEN: "builtin",
    GITHUB_REPOSITORY: "owner/repo",
  }), {
    isCodespaces: true,
    tokenSource: "none",
    token: "",
    repository: "owner/repo",
    extraRepositories: [],
  });

  const configured = resolveGitHubConfig({
    CODESPACES: "true",
    GH_PAT_SYNC: "user-pat",
    GITHUB_TOKEN: "builtin",
    GITHUB_REPOSITORY: "owner/repo",
  });
  assert.equal(configured.tokenSource, "GH_PAT_SYNC");
  assert.equal(configured.token, "user-pat");
});

test("JSESSIONID 저장 후 Collect workflow를 dispatch한다", async () => {
  const calls = [];
  const responses = [
    response(200, { key: "public-key", key_id: "key-id" }),
    response(204),
    response(204),
  ];
  const service = createGitHubSyncService({
    env: { GH_PAT_SYNC: "pat", GITHUB_REPOSITORY: "owner/repo" },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return responses.shift();
    },
    encryptSecret: async (value, key) => `sealed:${value}:${key}`,
    logger: logger(),
  });

  const result = await service.syncSession("session-id");
  assert.equal(result.success, true);
  assert.equal(result.workflowTriggered, true);
  assert.equal(result.tokenSource, "GH_PAT_SYNC");
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /actions\/secrets\/public-key$/);
  assert.match(calls[1].url, /actions\/secrets\/CODYSSEY_SESSION$/);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    encrypted_value: "sealed:session-id:public-key",
    key_id: "key-id",
  });
  assert.match(calls[2].url, /actions\/workflows\/collect\.yml\/dispatches$/);
  assert.deepEqual(JSON.parse(calls[2].options.body), { ref: "main" });
  assert.equal(service.config.token, "[configured]");
});

test("Secret 저장 후 dispatch가 거부되면 부분 성공 원인을 보존한다", async () => {
  const responses = [
    response(200, { key: "public-key", key_id: "key-id" }),
    response(204),
    response(403, { message: "Resource not accessible by personal access token" }),
  ];
  const service = createGitHubSyncService({
    env: { GH_PAT_SYNC: "pat", GITHUB_REPOSITORY: "owner/repo" },
    fetchImpl: async () => responses.shift(),
    encryptSecret: async () => "sealed",
    logger: logger(),
  });

  const result = await service.syncSession("session-id");
  assert.equal(result.success, false);
  assert.equal(result.enabled, false);
  assert.equal(result.workflowTriggered, false);
  assert.ok(result.lastSync);
  assert.match(result.error, /CODYSSEY_SESSION 저장은 완료/);
  assert.match(result.error, /Actions: Read and write/);
});

test("GH_SYNC_EXTRA_REPOS 지정 시 본 레포 성공 후 추가 레포에도 세션 저장+dispatch한다", async () => {
  const calls = [];
  const responses = [
    response(200, { key: "pk-main", key_id: "k1" }), // 본 레포 secret
    response(204),
    response(204),                                   // 본 레포 dispatch
    response(200, { key: "pk-hub", key_id: "k2" }),  // 허브 secret
    response(204),
    response(204),                                   // 허브 dispatch
  ];
  const service = createGitHubSyncService({
    env: {
      GH_PAT_SYNC: "pat",
      GITHUB_REPOSITORY: "owner/repo",
      GH_SYNC_EXTRA_REPOS: "owner/roster_hub, bad-format",
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return responses.shift();
    },
    encryptSecret: async (value, key) => `sealed:${key}`,
    logger: logger(),
  });

  const result = await service.syncSession("session-id");
  assert.equal(result.success, true);
  assert.equal(calls.length, 6);
  assert.match(calls[3].url, /repos\/owner\/roster_hub\/actions\/secrets\/public-key$/);
  assert.deepEqual(JSON.parse(calls[4].options.body), { encrypted_value: "sealed:pk-hub", key_id: "k2" });
  assert.match(calls[5].url, /repos\/owner\/roster_hub\/actions\/workflows\/collect\.yml\/dispatches$/);
  assert.deepEqual(result.extraSyncs, [
    { repo: "owner/roster_hub", secretUploaded: true, dispatched: true, error: null },
  ]);
});

test("추가 레포 동기화 실패는 경고로만 남기고 본 레포 결과는 그대로 성공이다", async () => {
  const responses = [
    response(200, { key: "pk-main", key_id: "k1" }),
    response(204),
    response(204),
    response(403, { message: "Resource not accessible" }), // 허브 공개키 거부
  ];
  const service = createGitHubSyncService({
    env: { GH_PAT_SYNC: "pat", GITHUB_REPOSITORY: "owner/repo", GH_SYNC_EXTRA_REPOS: "owner/roster_hub" },
    fetchImpl: async () => responses.shift(),
    encryptSecret: async () => "sealed",
    logger: logger(),
  });

  const result = await service.syncSession("session-id");
  assert.equal(result.success, true);
  assert.equal(result.workflowTriggered, true);
  assert.equal(result.extraSyncs.length, 1);
  assert.equal(result.extraSyncs[0].secretUploaded, false);
  assert.equal(result.extraSyncs[0].dispatched, false);
  assert.match(result.extraSyncs[0].error, /공개키 조회 실패/);
});
