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
  return { log() {}, error() {} };
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
