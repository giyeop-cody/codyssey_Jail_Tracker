#!/usr/bin/env node
/**
 * 길드 + SECOM 학습시간 원스톱 수집 스크립트
 *
 * 1) 지정 범위의 길드들에서 멤버(mbrId) 수집
 * 2) 수집된 모든 멤버의 SECOM 학습시간을 조회
 * 3) 길드별 랭킹 + 개인별 학습시간 랭킹 + 통합 통계 산출
 *
 * 사용법:
 *   node collect_all.js --start 1 --end 10 --year 2026 --month 7
 *   node collect_all.js --guilds 4,5 --year 2026 --month 7
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function parseArgs() {
  const args = process.argv.slice(2);
  const cfg = {
    start: 1, end: 10, guilds: null,
    season: 5, week: 9,
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    outDir: ".",
    delay: 300,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--start": cfg.start = parseInt(args[++i],10); break;
      case "--end": cfg.end = parseInt(args[++i],10); break;
      case "--guilds": cfg.guilds = args[++i]; break;
      case "--season": cfg.season = parseInt(args[++i],10); break;
      case "--week": cfg.week = parseInt(args[++i],10); break;
      case "--year": cfg.year = parseInt(args[++i],10); break;
      case "--month": cfg.month = parseInt(args[++i],10); break;
      case "--out": cfg.outDir = args[++i]; break;
      case "--delay": cfg.delay = parseInt(args[++i],10); break;
      case "-h": case "--help":
        console.log("사용법: node collect_all.js --start 1 --end 10 --year 2026 --month 7");
        process.exit(0);
    }
  }
  return cfg;
}

function run(cmd) {
  console.log(`\n▶ ${cmd}\n`);
  execSync(cmd, { stdio: "inherit", cwd: __dirname });
}

const cfg = parseArgs();
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0,19);
const guildFile = path.join(cfg.outDir, `guilds_s${cfg.season}_w${cfg.week}_${ts}.json`);
const secomFile = path.join(cfg.outDir, `secom_${cfg.year}-${String(cfg.month).padStart(2,"0")}_${ts}.json`);

let guildCmd = `node ${path.join(__dirname,"collect_guild_members.js")} --season ${cfg.season} --week ${cfg.week} --delay ${cfg.delay} --include-private --output ${guildFile}`;
if (cfg.guilds) guildCmd += ` --guilds ${cfg.guilds}`;
else guildCmd += ` --start ${cfg.start} --end ${cfg.end}`;

run(guildCmd);
run(`node ${path.join(__dirname,"collect_secom.js")} --from-guild ${guildFile} --year ${cfg.year} --month ${cfg.month} --delay ${cfg.delay} --include-private --output ${secomFile}`);

// 병합 리포트 생성
console.log("\n▶ 통합 리포트 생성 중...");
const guilds = JSON.parse(fs.readFileSync(guildFile,"utf-8"));
const secom = JSON.parse(fs.readFileSync(secomFile,"utf-8"));

const secomByMbr = new Map();
for (const m of secom.members) secomByMbr.set(m.mbrId, m);
for (const g of guilds.guilds) {
  for (const m of g.members) {
    const sc = secomByMbr.get(m.mbrId);
    if (sc) {
      m.secomHours = sc.recognizedHours;
      m.secomDuration = sc.totalRecognizedDuration;
      m.secomDays = sc.attendedDays;
    }
  }
}

const report = {
  meta: { ...guilds.meta, ...secom.meta, generatedAt: new Date().toISOString() },
  guilds: guilds.guilds,
  secomRanking: secom.ranking,
  failedGuilds: guilds.failedGuilds,
  failedSecom: secom.failed,
};

const reportFile = path.join(cfg.outDir, `report_s${cfg.season}_w${cfg.week}_${cfg.year}-${String(cfg.month).padStart(2,"0")}_${ts}.json`);
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf-8");

console.log(`\n═══════════════════════════════════════════════`);
console.log(`✅ 모든 수집 완료!`);
console.log(`   길드 데이터: ${guildFile}`);
console.log(`   SECOM 데이터: ${secomFile}`);
console.log(`   통합 리포트:  ${reportFile}`);
console.log(`═══════════════════════════════════════════════`);
