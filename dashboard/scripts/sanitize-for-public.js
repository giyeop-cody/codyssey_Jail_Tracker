// GitHub Pages 공개용 JSON에서 민감 필드 제거 + 정적 대시보드 호환 키 부여
const fs = require('fs');
const crypto = require('crypto');
const input = process.argv[2] || 'artifacts/latest.json';
const output = process.argv[3] || input;

let data = JSON.parse(fs.readFileSync(input, 'utf8'));

function hashId(mbrId) {
  if (mbrId == null) return null;
  return 'm' + crypto.createHash('sha1').update('jail:' + String(mbrId)).digest('hex').slice(0, 10);
}

const idMap = new Map();

function cleanMember(m) {
  const out = { ...m };
  delete out.email;
  if (out.mbrId != null) {
    out._publicId = hashId(out.mbrId);
    idMap.set(out.mbrId, out._publicId);
    delete out.mbrId;
  }
  if (out.days) {
    out.days = out.days.map(d => ({
      ...d,
      sessions: d.sessions.map(s => ({ ...s })),
    }));
  }
  return out;
}

if (Array.isArray(data.members)) data.members = data.members.map(cleanMember);
if (Array.isArray(data.topMembers)) data.topMembers = data.topMembers.map(cleanMember);

// memberMap 을 먼저 다 돌고 나서 daily/currentlyInside 의 mbrId 를 매핑
if (Array.isArray(data.daily)) {
  data.daily = data.daily.map(d => ({
    ...d,
    members: d.members.map(m => {
      const out = { ...m };
      if (out.mbrId != null) {
        out._publicId = idMap.get(out.mbrId) || hashId(out.mbrId);
        delete out.mbrId;
      }
      return out;
    }),
  }));
}
if (Array.isArray(data.currentlyInside)) {
  data.currentlyInside = data.currentlyInside.map(p => {
    const out = { ...p };
    if (out.mbrId != null) {
      out._publicId = idMap.get(out.mbrId) || hashId(out.mbrId);
      delete out.mbrId;
    }
    return out;
  });
}

if (data.meta) {
  delete data.meta.loggedInAs;
  // 정적 프런트에는 내부 길드 ID나 조회 범위를 노출하지 않고 길드명만 제공한다.
  delete data.meta.guildIds;
  delete data.meta.guildScope;
  if (data.placeholder) {
    // 첫 수집 전에는 임시 길드명(예: "길드 3")도 공개 화면에 표시하지 않는다.
    data.meta.guilds = [];
  } else if (Array.isArray(data.meta.guilds)) {
    data.meta.guilds = data.meta.guilds.map(g => {
      const out = { ...g };
      delete out.guildId;
      return out;
    });
  }
  data.meta.authMode = 'public-static';
}

data.public = true;
data.publishedAt = new Date().toISOString();
data.privacy = "Sensitive fields (email, internal mbrId) stripped for public release";

fs.writeFileSync(output, JSON.stringify(data));
console.log(`Sanitized: ${(data.members||[]).length} members, email/mbrId stripped`);
