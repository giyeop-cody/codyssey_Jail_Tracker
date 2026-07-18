"use strict";

// "현재 입실 중" 판정을 위한 순수 함수 모음.
//
// 자정(롤오버) 버그 수정의 핵심:
//  - 밤샘 중인 사람의 열린 세션(입실 있음·퇴실 없음)은 날짜가 바뀌어도
//    SECOM 데이터상 "전날" 레코드에 남는다.
//  - 예전 구현은 오늘 날짜 세션만 봐서 자정이 지나면 입실 목록이 비었다.
//
// 어제까지만 보는 이유:
//  - 퇴실 태그를 잊은 오래된 세션도 데이터상 계속 "열림"으로 남는데,
//    이걸 무한정 입실로 볼 수는 없다. 그래서 이틀(오늘+어제) 창으로 제한한다.

function isOpenSession(session) {
  return !!(session && session.entry_time && !session.exit_time && session.is_missing);
}

function isCurrentlyInside(dayDate, session, todayStr, yesterdayStr) {
  if (!isOpenSession(session)) return false;
  return dayDate === todayStr || dayDate === yesterdayStr;
}

function kstDateStrings(nowMs = Date.now()) {
  const kst = new Date(nowMs + 9 * 3600 * 1000);
  const fmt = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const todayStr = fmt(kst);
  const yesterdayStr = fmt(new Date(kst.getTime() - 24 * 3600 * 1000));
  return { todayStr, yesterdayStr };
}

// 전월 (year, month) 계산 — 1월이면 전년 12월
function prevYearMonth(year, month) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

// 한 멤버의 월 상세(detail_list)에서 목표 날짜에 열린 세션이 하나라도 있으면 true.
// 월 경계 대응에서 전월 데이터를 스캔할 때 쓴다.
function hasOpenSessionOn(detailList, targetDate) {
  for (const d of detailList || []) {
    if (d.date !== targetDate) continue;
    for (const s of d.sessions || []) {
      if (isOpenSession(s)) return true;
    }
  }
  return false;
}

module.exports = { isOpenSession, isCurrentlyInside, kstDateStrings, prevYearMonth, hasOpenSessionOn };
