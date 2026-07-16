"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { TRACKED_GUILD_IDS, mergeTrackedGuilds } = require("../lib/tracked-guilds");

const APP_HTML = fs.readFileSync(path.join(__dirname, "../public/app.html"), "utf8");

test("조회 길드는 3, 4, 5, 6으로 고정된다", () => {
  assert.deepEqual([...TRACKED_GUILD_IDS], [3, 4, 5, 6]);
  assert.equal(Object.isFrozen(TRACKED_GUILD_IDS), true);
});

test("app.html에 길드 번호 입력/선택 UI가 없다", () => {
  const forbidden = [
    'id="guildIds"',
    'id="allGuilds"',
    "document.getElementById('guildIds')",
    "document.getElementById('allGuilds')",
    "길드ID",
    "길드 번호",
  ];

  for (const token of forbidden) {
    assert.equal(APP_HTML.includes(token), false, `길드 선택 UI 잔존: ${token}`);
  }
});

test("네 길드 멤버를 mbrId 기준의 단일 목록으로 병합한다", () => {
  const guildResults = TRACKED_GUILD_IDS.map((guildId, index) => ({
    guildInfo: {
      guildId,
      guildNm: `테스트길드-${index + 1}`,
      currentRanking: index + 1,
      totalScore: 1000 - index,
    },
    members: [],
  }));

  guildResults[0].members.push(
    { mbrId: 100, mbrNm: "중복멤버", level: 7 },
    { mbrId: 200, mbrNm: "첫번째길드", level: 4 },
  );
  guildResults[1].members.push(
    { mbrId: 100, mbrNm: "중복멤버", level: 7 },
    { mbrId: 300, mbrNm: "두번째길드", level: 5 },
  );
  guildResults[2].members.push({ mbrId: 400, mbrNm: "세번째길드", level: 6 });
  guildResults[3].members.push({ mbrId: 500, mbrNm: "네번째길드", level: 8 });

  const { guilds, memberMap } = mergeTrackedGuilds(guildResults);

  assert.deepEqual(guilds.map(g => g.guildId), [3, 4, 5, 6]);
  assert.equal(memberMap.size, 5);
  assert.deepEqual(memberMap.get(100).guildNames, ["테스트길드-1", "테스트길드-2"]);
  assert.deepEqual(
    [...memberMap.values()].map(member => member.name).sort(),
    ["네번째길드", "두번째길드", "세번째길드", "중복멤버", "첫번째길드"].sort(),
  );
});

test("길드 응답이 하나라도 빠지면 부분 대시보드를 만들지 않는다", () => {
  assert.throws(
    () => mergeTrackedGuilds([{ guildInfo: {}, members: [] }]),
    /4개여야 합니다/,
  );
});
