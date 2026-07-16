"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const dashboardDir = path.resolve(__dirname, "..");
const appHtml = fs.readFileSync(path.join(dashboardDir, "public/app.html"), "utf8");
const appJs = fs.readFileSync(path.join(dashboardDir, "public/app.js"), "utf8");

function fixture(year, month, mbrId) {
  return {
    meta: {
      year, month,
      guildIds: [3, 4, 5, 6],
      guildScope: "fixed-3-6",
      guilds: [3, 4, 5, 6].map(guildId => ({ guildId, guildName: `g${guildId}` })),
      totalMembers: 1,
      totalActiveMembers: month % 2,
      collectedAt: new Date().toISOString(),
      loggedInAs: "private-user",
    },
    members: [{
      mbrId,
      name: `member-${month}`,
      email: "private@example.com",
      totalSeconds: month % 2 ? 3600 : 0,
      totalHours: month % 2 ? 1 : 0,
      attendedDays: month % 2,
      avgPerDay: month % 2 ? 1 : 0,
      guildNames: ["g3"],
      days: [],
    }],
    topMembers: [], daily: [], weekly: [], hourly: [], weekday: [], currentlyInside: [],
    records: { topDayByAttendance: null, topDayByHours: null, topWeek: null, peakHour: null },
  };
}

test("공개 UI는 현재 연월을 기본값으로 사용하면서 월별 JSON을 조회한다", () => {
  assert.match(appHtml, /app\.css/);
  assert.match(appHtml, /app\.js/);
  assert.match(appJs, /async function loadPublicData\(year, month\)/);
  assert.match(appJs, /fetch\(`data\/\$\{key\}\.json`/);
  assert.match(appJs, /currentYear = n\.getUTCFullYear\(\)/);
  assert.match(appJs, /currentMonth = n\.getUTCMonth\(\) \+ 1/);
  assert.doesNotMatch(appJs, /\['year','month'\][\s\S]{0,120}disabled = true/);
});

test("정적 사이트 빌드가 여러 월을 보존하고 민감 필드를 제거한다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jail-history-"));
  const artifacts = path.join(root, "artifacts");
  const months = path.join(artifacts, "months");
  const site = path.join(root, "site");
  fs.mkdirSync(months, { recursive: true });
  fs.writeFileSync(path.join(months, "2026-04.json"), JSON.stringify(fixture(2026, 4, 100)));
  fs.writeFileSync(path.join(months, "2026-07.json"), JSON.stringify(fixture(2026, 7, 200)));

  const result = spawnSync(process.execPath, [
    path.join(dashboardDir, "scripts/build-public-history.js"), artifacts, site,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const manifest = JSON.parse(fs.readFileSync(path.join(site, "data/index.json"), "utf8"));
  assert.deepEqual(manifest.months.map(item => item.key), ["2026-07", "2026-04"]);
  assert.equal(manifest.latest, "2026-07");

  const april = JSON.parse(fs.readFileSync(path.join(site, "data/2026-04.json"), "utf8"));
  assert.equal(april.members.length, 1);
  assert.equal("mbrId" in april.members[0], false);
  assert.equal("email" in april.members[0], false);
  assert.match(april.members[0]._publicId, /^m[0-9a-f]{10}$/);
  assert.equal("guildIds" in april.meta, false);
  assert.equal(fs.existsSync(path.join(site, "data.json")), true);
  assert.equal(fs.existsSync(path.join(site, "app.css")), true);
  assert.equal(fs.existsSync(path.join(site, "app.js")), true);

  fs.rmSync(root, { recursive: true, force: true });
});
