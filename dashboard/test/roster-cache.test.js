"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const rosterCache = require("../lib/roster-cache");

const SERVER_JS = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const WORKFLOW_YML = fs.readFileSync(path.join(__dirname, "../../.github/workflows/collect.yml"), "utf8");

function sampleRoster(hoursAgo) {
  return {
    fetchedAt: new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString(),
    guilds: [{ guildId: 3, guildName: "길드3" }],
    members: [
      { mbrId: 1001, name: "테스터A", level: 3, profileImage: "", guildNames: ["길드3"] },
      { mbrId: 1002, name: "테스터B", level: 5, profileImage: "", guildNames: ["길드3"] }
    ]
  };
}

test("isRosterUsable: 유효/무효 형태 판정", () => {
  assert.equal(rosterCache.isRosterUsable(sampleRoster(1)), true);
  assert.equal(rosterCache.isRosterUsable(null), false);
  assert.equal(rosterCache.isRosterUsable({}), false);
  assert.equal(rosterCache.isRosterUsable({ fetchedAt: "bad", guilds: [{}], members: [{}] }), false);
  assert.equal(rosterCache.isRosterUsable({ fetchedAt: new Date().toISOString(), guilds: [], members: [{}] }), false);
});

test("isRosterFresh: 기본 8시간 경계 (하루 3회 갱신 수준)", () => {
  assert.equal(rosterCache.isRosterFresh(sampleRoster(0.5)), true);
  assert.equal(rosterCache.isRosterFresh(sampleRoster(7.9)), true);
  assert.equal(rosterCache.isRosterFresh(sampleRoster(8.1)), false);
  assert.equal(rosterCache.isRosterFresh(sampleRoster(30)), false);
  // 커스텀 기준
  assert.equal(rosterCache.isRosterFresh(sampleRoster(9), 12), true);
});

test("serialize/deserialize 왕복: 멤버 필드와 guildNames 보존", () => {
  const memberMap = new Map();
  memberMap.set(1001, { mbrId: 1001, name: "테스터A", level: 3, profileImage: "p.png", guildNames: ["길드3", "길드4"] });
  memberMap.set(1002, { mbrId: 1002, name: "테스터B", level: 5, profileImage: "", guildNames: ["길드3"] });
  const guilds = [{ guildId: 3, guildName: "길드3" }, { guildId: 4, guildName: "길드4" }];

  const serialized = rosterCache.serializeRoster(guilds, memberMap, new Date("2026-07-19T00:00:00Z"));
  assert.equal(serialized.members.length, 2);
  assert.equal(serialized.fetchedAt, "2026-07-19T00:00:00.000Z");

  const roundtrip = rosterCache.deserializeRoster(JSON.parse(JSON.stringify(serialized)));
  assert.equal(roundtrip.memberMap.size, 2);
  const m = roundtrip.memberMap.get(1001);
  assert.equal(m.name, "테스터A");
  assert.deepEqual([...m.guildNames], ["길드3", "길드4"]);
  assert.deepEqual(roundtrip.guilds.map((g) => g.guildId), [3, 4]);
});

test("readRosterFile/writeRosterFile: 파일 왕복과 깨진 파일 처리", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roster-test-"));
  const file = path.join(dir, "sub", "roster.json");

  assert.equal(rosterCache.readRosterFile(fs, file), null, "없는 파일은 null");

  assert.equal(rosterCache.writeRosterFile(fs, file, sampleRoster(0.2)), true);
  const loaded = rosterCache.readRosterFile(fs, file);
  assert.ok(loaded, "저장 후 읽기 실패");
  assert.equal(rosterCache.isRosterFresh(loaded), true);

  fs.writeFileSync(file, "{broken json");
  assert.equal(rosterCache.readRosterFile(fs, file), null, "깨진 파일은 null");

  // 무효 내용은 저장 거부
  assert.equal(rosterCache.writeRosterFile(fs, file, { foo: 1 }), false);
});

test("server.js가 로스터 캐시 계층을 사용하도록 배선되어 있다", () => {
  assert.ok(SERVER_JS.includes('require("./lib/roster-cache")'), "roster-cache require 누락");
  assert.ok(SERVER_JS.includes("readRosterFile"), "캐시 읽기 누락");
  assert.ok(SERVER_JS.includes("writeRosterFile"), "캐시 저장 누락");
  assert.ok(SERVER_JS.includes("SECOM_ROSTER_FILE"), "환경변수 참조 누락");
  // 신선도 판정 후 길드 API 생략/폴 백 로직 존재
  assert.ok(SERVER_JS.includes("isRosterFresh"), "신선도 판정 누락");
});

test("collect.yml이 로스터 캐시를 복원/저장하고 환경변수를 넘긴다", () => {
  assert.ok(WORKFLOW_YML.includes("actions/cache/restore@v4"), "cache restore 누락");
  assert.ok(WORKFLOW_YML.includes("actions/cache/save@v4"), "cache save 누락");
  assert.ok(WORKFLOW_YML.includes("secom-roster-v2-"), "v2 캐시 키 누락 (email 포함 구 캐시와 분리 필요)");
  assert.ok(WORKFLOW_YML.includes("SECOM_ROSTER_FILE"), "env 누락");
});


test("serializeRoster: email(개인정보)은 캐시에 남기지 않고 원본은 유지한다", () => {
  const memberMap = new Map();
  memberMap.set(1001, { mbrId: 1001, name: "테스터A", level: 3, email: "a@example.com", profileImage: "p.png", guildNames: ["길드3"] });
  const serialized = rosterCache.serializeRoster([{ guildId: 3, guildName: "길드3" }], memberMap);
  assert.equal(serialized.members.length, 1);
  assert.equal("email" in serialized.members[0], false, "캐시 직렬화에 email 잔존");
  assert.equal(JSON.stringify(serialized).includes("example.com"), false, "이메일 값 누락 확인 실패");
  // 원본 memberMap 객체는 비파괴
  assert.equal(memberMap.get(1001).email, "a@example.com");
  // 역직렬화도 정상 (email 없이도 이름/레벨 매핑 동작)
  const roundtrip = rosterCache.deserializeRoster(JSON.parse(JSON.stringify(serialized)));
  assert.equal(roundtrip.memberMap.get(1001).name, "테스터A");
});
