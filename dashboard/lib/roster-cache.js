"use strict";

// 길드 상세 API는 입퇴실(30분 주기 갱신)과 달리 준정적 데이터다.
// 목적은 mbrId ↔ 이름 매핑 + 레벨/프로필이라 하루 3~4회 갱신이면 충분하다.
//
// 이 모듈은 그 로스터의 캐시 직렬화/신선도 판정만 담당하는 순수 함수 모음이다.
// 실행 환경(GitHub Actions)에서는 actions/cache로 .roster-cache/ 디렉터리를
// 유지하고, 서버는 SECOM_ROSTER_FILE/SECOM_ROSTER_MAX_AGE_H로 참조한다.
//
// 캐시에는 공개 대시보드 수준의 필드만 둔다. 이메일 주소(개인정보)는 집계와
// 화면 표시 어디에도 쓰이지 않으므로 serializeRoster 단계에서 제외한다.

const DEFAULT_MAX_AGE_HOURS = 8; // 하루 3회 갱신 수준

function isRosterUsable(parsed) {
  return !!(
    parsed &&
    typeof parsed.fetchedAt === "string" &&
    !Number.isNaN(Date.parse(parsed.fetchedAt)) &&
    Array.isArray(parsed.guilds) && parsed.guilds.length > 0 &&
    Array.isArray(parsed.members) && parsed.members.length > 0
  );
}

function rosterAgeMs(parsed, nowMs = Date.now()) {
  if (!isRosterUsable(parsed)) return Infinity;
  return Math.max(0, nowMs - Date.parse(parsed.fetchedAt));
}

function isRosterFresh(parsed, maxAgeHours = DEFAULT_MAX_AGE_HOURS, nowMs = Date.now()) {
  return rosterAgeMs(parsed, nowMs) <= maxAgeHours * 3600 * 1000;
}

// mergeTrackedGuilds의 결과를 직렬화 가능한 형태로 변환.
// email(개인정보)은 캐시에 남기지 않는다. 원본 memberMap의 객체는 변경하지 않는다.
function serializeRoster(guilds, memberMap, now = new Date()) {
  const members = memberMap instanceof Map
    ? [...memberMap.values()].map((member) => {
        if (!member || typeof member !== "object") return member;
        const { email, ...rest } = member;
        return rest;
      })
    : [];
  return {
    fetchedAt: now.toISOString(),
    guilds: Array.isArray(guilds) ? guilds : [],
    members
  };
}

// 역직렬화. memberMap의 키 타입(mbrId 원형)과 필드를 그대로 복원한다.
function deserializeRoster(parsed) {
  if (!isRosterUsable(parsed)) return null;
  const memberMap = new Map();
  for (const member of parsed.members) {
    if (member && member.mbrId != null) {
      memberMap.set(member.mbrId, member);
    }
  }
  if (!memberMap.size) return null;
  return { guilds: parsed.guilds, memberMap };
}

// fs는 주입한다 (테스트에서 임시 디렉터리 사용 가능)
function readRosterFile(fs, path) {
  try {
    if (!path || !fs.existsSync(path)) return null;
    const parsed = JSON.parse(fs.readFileSync(path, "utf-8"));
    return isRosterUsable(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function writeRosterFile(fs, path, roster) {
  try {
    if (!path || !isRosterUsable(roster)) return false;
    fs.mkdirSync(require("path").dirname(path), { recursive: true });
    fs.writeFileSync(path, JSON.stringify(roster));
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  DEFAULT_MAX_AGE_HOURS,
  isRosterUsable,
  rosterAgeMs,
  isRosterFresh,
  serializeRoster,
  deserializeRoster,
  readRosterFile,
  writeRosterFile
};
