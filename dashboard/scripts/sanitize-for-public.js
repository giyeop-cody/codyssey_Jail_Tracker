// GitHub Pages 공개용 JSON에서 민감 필드 제거
const fs = require('fs');
const input = process.argv[2] || 'artifacts/latest.json';
const output = process.argv[3] || input;

let data = JSON.parse(fs.readFileSync(input, 'utf8'));

// 멤버에서 제거할 민감 필드
const STRIP_MEMBER_FIELDS = ['email', 'mbrId'];

function cleanMember(m) {
  const out = { ...m };
  for (const f of STRIP_MEMBER_FIELDS) delete out[f];
  if (out.days) {
    out.days = out.days.map(d => ({
      ...d,
      sessions: d.sessions.map(s => ({ ...s })),
    }));
  }
  return out;
}

if (data.members) data.members = data.members.map(cleanMember);
if (data.topMembers) data.topMembers = data.topMembers.map(cleanMember);
if (data.daily) {
  data.daily = data.daily.map(d => ({
    ...d,
    members: d.members.map(m => {
      const out = { ...m };
      for (const f of ['mbrId']) delete out[f];
      return out;
    }),
  }));
}
// 길드 멤버 상세의 mbrId도 제거
if (data.meta) {
  delete data.meta.loggedInAs;
}

// 공개 표식
data.public = true;
data.publishedAt = new Date().toISOString();
data.privacy = "Sensitive fields (email, mbrId) stripped for public release";

fs.writeFileSync(output, JSON.stringify(data, null, 2));
console.log(`Sanitized: ${Object.keys(data.members||{}).length||(data.members?data.members.length:0)} members, fields stripped:`, STRIP_MEMBER_FIELDS.join(', '));
