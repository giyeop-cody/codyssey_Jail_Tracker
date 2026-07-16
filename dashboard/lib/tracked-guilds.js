"use strict";

// 이 대시보드는 길드 선택 없이 아래 네 길드만 하나의 랭킹으로 집계한다.
const TRACKED_GUILD_IDS = Object.freeze([3, 4, 5, 6]);

/**
 * 길드 API 응답들을 mbrId 기준의 단일 멤버 목록으로 병합한다.
 * 같은 멤버가 여러 응답에 포함되면 멤버는 한 번만 유지하고 소속 길드명만 합친다.
 */
function mergeTrackedGuilds(guildResults) {
  if (!Array.isArray(guildResults) || guildResults.length !== TRACKED_GUILD_IDS.length) {
    throw new Error(`길드 응답은 ${TRACKED_GUILD_IDS.length}개여야 합니다.`);
  }

  const guilds = [];
  const memberMap = new Map();

  guildResults.forEach((result, index) => {
    const info = result && result.guildInfo ? result.guildInfo : {};
    const guildName = info.guildNm || "이름 없는 길드";

    guilds.push({
      // API가 ID를 생략하더라도 실제로 조회한 고정 ID를 집계 메타데이터에 남긴다.
      guildId: info.guildId ?? TRACKED_GUILD_IDS[index],
      guildName,
      currentRanking: info.currentRanking,
      totalScore: info.totalScore,
    });

    for (const member of (result && result.members) || []) {
      if (member.mbrId == null) continue;

      const existing = memberMap.get(member.mbrId);
      if (existing) {
        if (!existing.guildNames.includes(guildName)) existing.guildNames.push(guildName);
        continue;
      }

      memberMap.set(member.mbrId, {
        mbrId: member.mbrId,
        name: member.mbrNm,
        level: member.level,
        email: member.emlAddr,
        profileImage: member.profImgPath,
        personalScore: member.personalScore,
        contributionRate: member.contributionRate,
        guildNames: [guildName],
      });
    }
  });

  return { guilds, memberMap };
}

module.exports = { TRACKED_GUILD_IDS, mergeTrackedGuilds };
