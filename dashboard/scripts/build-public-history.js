"use strict";

// 기존 GitHub Pages의 월별 공개 데이터를 보존하면서 새 수집 결과를 병합해 정적 사이트를 만든다.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const artifactsDir = path.resolve(process.argv[2] || "artifacts");
const siteDir = path.resolve(process.argv[3] || "_site");
const publicBaseUrl = (process.argv[4] || "").replace(/\/$/, "");
const publicDir = path.resolve(__dirname, "../public");
const appHtml = path.join(publicDir, "app.html");
const sanitizer = path.resolve(__dirname, "sanitize-for-public.js");
const dataDir = path.join(siteDir, "data");

function monthKey(year, month) {
  return `${Number(year)}-${String(Number(month)).padStart(2, "0")}`;
}

function validMonthKey(key) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
}

async function fetchRequired(url) {
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
    headers: { "User-Agent": "jail-tracker-pages-builder" },
  });
  return res;
}

async function restorePublishedHistory() {
  if (!publicBaseUrl) return 0;

  const manifestRes = await fetchRequired(`${publicBaseUrl}/data/index.json`);
  if (manifestRes.status === 404) {
    console.log("No existing public history manifest; starting a new archive.");
    return 0;
  }
  if (!manifestRes.ok) {
    throw new Error(`기존 월별 데이터 목록 조회 실패: HTTP ${manifestRes.status}`);
  }

  const manifest = await manifestRes.json();
  const keys = (manifest.months || [])
    .map(item => typeof item === "string" ? item : item.key)
    .filter(validMonthKey);

  let restored = 0;
  for (const key of keys) {
    const dataRes = await fetchRequired(`${publicBaseUrl}/data/${key}.json`);
    if (!dataRes.ok) {
      throw new Error(`기존 월별 데이터 복원 실패 (${key}): HTTP ${dataRes.status}`);
    }
    fs.writeFileSync(path.join(dataDir, `${key}.json`), await dataRes.text());
    restored++;
  }
  console.log(`Restored ${restored} published month(s).`);
  return restored;
}

function discoverRawMonthlyFiles() {
  const monthlyDir = path.join(artifactsDir, "months");
  if (fs.existsSync(monthlyDir)) {
    const files = fs.readdirSync(monthlyDir)
      .filter(name => /^\d{4}-(0[1-9]|1[0-2])\.json$/.test(name))
      .map(name => path.join(monthlyDir, name));
    if (files.length) return files;
  }

  const latest = path.join(artifactsDir, "latest.json");
  return fs.existsSync(latest) ? [latest] : [];
}

function sanitizeMonthlyFiles(rawFiles) {
  const updated = [];
  for (const rawFile of rawFiles) {
    const raw = JSON.parse(fs.readFileSync(rawFile, "utf8"));
    if (!raw.meta || !raw.meta.year || !raw.meta.month) {
      throw new Error(`월 메타데이터가 없는 수집 파일: ${rawFile}`);
    }
    const key = monthKey(raw.meta.year, raw.meta.month);
    const output = path.join(dataDir, `${key}.json`);
    const result = spawnSync(process.execPath, [sanitizer, rawFile, output], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`공개 데이터 정제 실패: ${key}`);
    updated.push(key);
  }
  return updated;
}

function buildManifest() {
  const months = fs.readdirSync(dataDir)
    .filter(name => /^\d{4}-(0[1-9]|1[0-2])\.json$/.test(name))
    .map(name => {
      const key = name.slice(0, -5);
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, name), "utf8"));
      return {
        key,
        year: data.meta && data.meta.year,
        month: data.meta && data.meta.month,
        totalMembers: data.meta && data.meta.totalMembers || 0,
        totalActiveMembers: data.meta && data.meta.totalActiveMembers || 0,
        collectedAt: data.meta && data.meta.collectedAt || null,
        publishedAt: data.publishedAt || null,
        placeholder: !!data.placeholder,
      };
    })
    .sort((a, b) => b.key.localeCompare(a.key));

  if (!months.length) throw new Error("배포할 월별 데이터가 없습니다.");

  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const currentKey = monthKey(now.getUTCFullYear(), now.getUTCMonth() + 1);
  const latest = months.some(item => item.key === currentKey) ? currentKey : months[0].key;
  const manifest = { latest, current: currentKey, months, generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dataDir, "index.json"), JSON.stringify(manifest));
  fs.copyFileSync(path.join(dataDir, `${latest}.json`), path.join(siteDir, "data.json"));
  return manifest;
}

async function main() {
  fs.rmSync(siteDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.copyFileSync(appHtml, path.join(siteDir, "index.html"));
  fs.copyFileSync(appHtml, path.join(siteDir, "app.html"));
  for (const asset of ["app.css", "app.js"]) {
    fs.copyFileSync(path.join(publicDir, asset), path.join(siteDir, asset));
  }

  await restorePublishedHistory();
  const rawFiles = discoverRawMonthlyFiles();
  if (!rawFiles.length) throw new Error("수집 아티팩트를 찾지 못했습니다.");
  const updated = sanitizeMonthlyFiles(rawFiles);
  const manifest = buildManifest();
  fs.writeFileSync(path.join(siteDir, ".nojekyll"), "");

  console.log(`Public history ready: ${manifest.months.length} month(s), updated=[${updated.join(",")}], latest=${manifest.latest}`);
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
