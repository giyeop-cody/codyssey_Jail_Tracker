let DATA = null;
let CHARTS = {};
let currentMonth = new Date().getMonth() + 1;
let currentYear = new Date().getFullYear();
let PUBLIC_MODE = false;       // GitHub Pages 정적 뷰
let MEMBER_KEY = 'mbrId';      // 라이브는 'mbrId', 공개는 '_publicId'
let REFRESH_TIMER = null;
function detectPagesRepository() {
  const host = window.location.hostname.toLowerCase();
  if (!host.endsWith('.github.io')) return null;
  const owner = host.slice(0, -'.github.io'.length);
  const repository = window.location.pathname.split('/').filter(Boolean)[0];
  return owner && repository ? `${owner}/${repository}` : null;
}

function codespaceUrl(repository = detectPagesRepository()) {
  const target = repository || 'giyeop-cody/codyssey_Jail_Tracker';
  return `https://github.com/codespaces/new/${target}?devcontainer_path=.devcontainer%2Fdevcontainer.json`;
}

const CODESPACE_URL = codespaceUrl();

async function checkSession() {
  try {
    const res = await fetch('/api/session', { cache: 'no-store' });
    if (!res.ok) throw new Error('no backend');
    return await res.json();
  } catch (e) {
    return { __static: true };
  }
}

function showLoginScreen(message = '') {
  DATA = null;
  if (REFRESH_TIMER) {
    clearInterval(REFRESH_TIMER);
    REFRESH_TIMER = null;
  }
  document.getElementById('mainUI').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';

  const errBox = document.getElementById('loginError');
  if (message) {
    errBox.textContent = message;
    errBox.style.display = 'block';
  } else {
    errBox.textContent = '';
    errBox.style.display = 'none';
  }

  document.getElementById('loginPw').value = '';
  setTimeout(() => document.getElementById('loginId').focus(), 0);
}

function publicSessionSetupHtml(message) {
  return `
    <div class="grid">
      <div class="card span-12" style="max-width:760px;margin:40px auto;text-align:center;padding:36px 28px">
        <div style="font-size:42px;margin-bottom:12px">🔑</div>
        <h2 style="font-size:22px;margin-bottom:10px">새 로그인이 필요합니다</h2>
        <p style="color:var(--muted);line-height:1.8;margin:0 auto 22px;max-width:600px">
          ${message || 'GitHub Actions에서 사용할 Codyssey 세션이 없거나 만료되었습니다.'}<br>
          Codespace를 실행해 로그인하면 새 세션 쿠키가 Repository Secret에 저장되고,<br>
          다음 GitHub Actions 실행에서 통합 대시보드가 자동으로 갱신됩니다.
        </p>
        <a href="${CODESPACE_URL}" target="_blank" rel="noopener"
           style="display:inline-block;background:var(--accent);color:white;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700">
          🚀 Codespace 실행하고 로그인하기
        </a>
        <div style="margin-top:18px;color:var(--muted);font-size:12px">
          로그인하면 <strong>Collect SECOM Data</strong>가 자동 실행되고 완료 후 이 페이지가 갱신됩니다.
        </div>
      </div>
    </div>`;
}

function publicMonthUnavailableHtml(year, month, message) {
  return `
    <div class="grid">
      <div class="card span-12" style="max-width:760px;margin:40px auto;text-align:center;padding:36px 28px">
        <div style="font-size:42px;margin-bottom:12px">📅</div>
        <h2 style="font-size:22px;margin-bottom:10px">${year}년 ${month}월 기록이 없습니다</h2>
        <p style="color:var(--muted);line-height:1.8;margin:0 auto 20px">${message || '아직 공개 저장된 월별 데이터가 없습니다.'}</p>
        <button onclick="goThisMonth()" style="background:var(--accent);color:white;border:0;border-radius:10px;padding:11px 18px;font-weight:700;cursor:pointer">
          이번 달로 돌아가기
        </button>
      </div>
    </div>`;
}

async function loadPublicData(year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  let res = await fetch(`data/${key}.json`, { cache: 'no-store' });

  // 월별 아카이브 도입 전 배포본과의 일시적인 호환을 위해 현재 data.json도 확인한다.
  if (res.status === 404) {
    const fallback = await fetch('data.json', { cache: 'no-store' });
    if (fallback.ok) {
      const data = await fallback.json();
      if (data.meta && Number(data.meta.year) === Number(year) && Number(data.meta.month) === Number(month)) {
        return data;
      }
    }
    const err = new Error(`${year}년 ${month}월 데이터가 아직 수집되지 않았습니다.`);
    err.code = 'MONTH_NOT_FOUND';
    throw err;
  }
  if (!res.ok) throw new Error(`공개 데이터 조회 실패 (HTTP ${res.status})`);

  const data = await res.json();
  if (!data.members || data.members.length === 0) {
    const err = new Error('아직 수집된 데이터가 없습니다. Codespace에서 로그인하면 자동 수집됩니다.');
    err.code = 'SESSION_REQUIRED';
    throw err;
  }
  return data;
}

async function doLogin() {
  const userId = document.getElementById('loginId').value.trim();
  const password = document.getElementById('loginPw').value;
  const errBox = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  errBox.style.display = 'none';
  if (!userId || !password) {
    errBox.textContent = '아이디와 비밀번호를 모두 입력해주세요.';
    errBox.style.display = 'block';
    return;
  }
  btn.disabled = true;
  btn.textContent = '로그인 중...';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, password })
    });
    const data = await res.json();
    if (data.success) {
      await boot();
      if (data.githubSynced === false) {
        alert(`로그인은 성공했지만 GitHub Secret 동기화에 실패했습니다.\n\n${data.githubSyncError || 'Codespaces Secret GH_PAT_SYNC 설정을 확인해주세요.'}\n\n세션은 유지되며 상단의 '재시도' 버튼으로 다시 동기화할 수 있습니다.`);
      }
    } else {
      errBox.textContent = data.error || '로그인에 실패했습니다.';
      errBox.style.display = 'block';
    }
  } catch (err) {
    errBox.textContent = '네트워크 오류: ' + err.message;
    errBox.style.display = 'block';
  }
  btn.disabled = false;
  btn.textContent = '로그인';
}

async function doLogout() {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
}

async function syncToGithub() {
  try {
    const res = await fetch('/api/sync-github', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      alert(`✅ 세션 Secret 저장과 Collect SECOM Data 실행 요청이 완료되었습니다.\n수집이 끝나면 GitHub Pages가 자동 갱신됩니다.`);
      loadData(); // 동기화 상태 다시 불러오기
      return;
    }

    const reason = data.error || data.lastError || `HTTP ${res.status}`;
    alert(`❌ 동기화 실패\n\n${reason}\n\n사용 토큰: ${data.tokenSource || '확인 불가'}`);
  } catch (err) {
    alert(`❌ 동기화 요청 실패\n\n${err.message}`);
  }
}

async function fetchAggregate(opts) {
  const res = await fetch('/api/aggregate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts)
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || data.requireAuth) {
    const authError = new Error(data.error || '로그인이 필요합니다');
    authError.requireAuth = true;
    throw authError;
  }
  if (!res.ok) throw new Error(data.error || ('API 오류 ' + res.status));
  return data;
}

function initials(name) { return (name || '?').charAt(0); }

function avatarHtml(m) {
  const prof = m && (m.profileImage || m.profImgPath);
  if (prof) return `<div class="avatar"><img src="${prof}" onerror="this.parentNode.innerHTML='${initials(m.name)}'"></div>`;
  return `<div class="avatar">${initials(m && m.name)}</div>`;
}

async function loadData() {
  if (PUBLIC_MODE) {
    const year = parseInt(document.getElementById('year').value, 10);
    const month = parseInt(document.getElementById('month').value, 10);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      document.getElementById('app').innerHTML = '<div class="empty-state">올바른 연도와 월을 입력해주세요.</div>';
      return;
    }

    currentYear = year;
    currentMonth = month;
    document.getElementById('app').innerHTML = '<div class="loading"><div class="spinner"></div><br>월별 데이터를 불러오는 중...</div>';
    try {
      DATA = await loadPublicData(year, month);
      render();
    } catch (err) {
      DATA = null;
      document.getElementById('app').innerHTML = err.code === 'MONTH_NOT_FOUND'
        ? publicMonthUnavailableHtml(year, month, err.message)
        : publicSessionSetupHtml(err.message);
    }
    return;
  }

  const year = parseInt(document.getElementById('year').value, 10);
  const month = parseInt(document.getElementById('month').value, 10);
  document.getElementById('app').innerHTML = '<div class="loading"><div class="spinner"></div><br>4개 길드 멤버를 통합 조회하는 중...</div>';
  try {
    // 길드 범위와 병합은 서버가 전담한다. 프런트엔드는 기간만 요청한다.
    const payload = { year, month, seasonId: 5, weekNo: 9 };
    DATA = await fetchAggregate(payload);
    currentYear = year; currentMonth = month;
    render();
  } catch (err) {
    if (err.requireAuth) {
      // 서버의 만료 세션을 지운 뒤 새로고침 없이 즉시 로그인 폼으로 전환한다.
      await fetch('/api/logout', { method: 'POST' }).catch(() => {});
      showLoginScreen('세션이 만료되었습니다. 다시 로그인하면 새 세션 쿠키가 GitHub Actions Secret에 자동 저장됩니다.');
      return;
    }
    document.getElementById('app').innerHTML =
      `<div class="empty-state">❌ 불러오기 실패: ${err.message}</div>`;
  }
}

function render() {
  const m = DATA.meta;
  const members = DATA.members;
  const activeMembers = members.filter(x => x.totalSeconds > 0);
  const totalSec = activeMembers.reduce((s, m) => s + m.totalSeconds, 0);
  const totalMissing = activeMembers.reduce((s, m) => s + m.missingSessions, 0);
  const inside = DATA.currentlyInside || [];
  const loadedGuilds = Array.isArray(m.guilds) ? m.guilds : [];
  const guildNames = loadedGuilds.map(g => g.guildName).filter(Boolean).join(', ');
  const scopeLabel = `${loadedGuilds.length || 4}개 길드 통합${guildNames ? ` (${guildNames})` : ''}`;

  const collectedAt = m.collectedAt || DATA.publishedAt;
  const collectedLabel = PUBLIC_MODE
    ? ` · 최종 갱신 ${new Date(collectedAt).toLocaleString('ko-KR')} (30분마다 자동)`
    : ` · ${new Date(collectedAt).toLocaleString('ko-KR')} 기준`;
  document.getElementById('metaInfo').textContent =
    `${scopeLabel} · ${m.year}년 ${m.month}월 · ${m.totalActiveMembers}/${m.totalMembers}명 활동${collectedLabel}`;

  if (!PUBLIC_MODE) {
    // 라이브 모드에서만 GitHub 동기화 배지 + 로그인 사용자 정보 표시
    const gh = (m.githubSync) || {};
    let ghBadge = '';
    if (gh.configured) {
      const lastSyncStr = gh.lastSync ? new Date(gh.lastSync).toLocaleString('ko-KR', {hour12:false}) : '없음';
      if (gh.enabled) {
        ghBadge = `<span class="gh-status ok" title="세션 Secret 저장 및 Collect workflow 실행 요청 완료 (${gh.repository})">
          <span class="live-dot"></span> 수집 요청 완료 · ${lastSyncStr.slice(5)}
          <button class="gh-sync-btn" onclick="syncToGithub()">다시 수집</button>
        </span>`;
      } else {
        ghBadge = `<span class="gh-status err" title="${gh.lastError||'동기화 실패'}">
          ⚠ GitHub 동기화 오류
          <button class="gh-sync-btn" onclick="syncToGithub()">재시도</button>
        </span>`;
      }
    } else {
      ghBadge = `<span class="gh-status off" title="Codespaces Secret GH_PAT_SYNC를 설정하면 로그인 시 GitHub Actions Secret에 세션이 자동 저장됩니다">
        🔗 GitHub 자동동기화 꺼짐
      </span>`;
    }

    document.getElementById('userInfo').innerHTML = `
      ${ghBadge}
      <div class="avatar">${(m.loggedInAs||'?').charAt(0)}</div>
      <span>${m.loggedInAs || ''}</span>
      <button class="logout-btn" onclick="doLogout()" title="로그아웃">✕</button>`;
  }

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="grid">
      <div class="card span-3 record-card">
        <h3>🎖️ 최다 학습 멤버</h3>
        ${activeMembers[0] ? `
          <div class="big">${activeMembers[0].name}</div>
          <div class="label">${activeMembers[0].totalDuration} · ${activeMembers[0].attendedDays}일</div>
        ` : '<div class="label">데이터 없음</div>'}
      </div>
      <div class="card span-3 record-card">
        <h3>📅 최다 출석일</h3>
        ${DATA.records.topDayByAttendance ? `
          <div class="big">${DATA.records.topDayByAttendance.date.slice(5)}</div>
          <div class="label">${DATA.records.topDayByAttendance.attendance}명 · ${DATA.records.topDayByAttendance.totalDuration}</div>
        ` : '<div class="label">데이터 없음</div>'}
      </div>
      <div class="card span-3 record-card">
        <h3>📈 최다 학습일</h3>
        ${DATA.records.topDayByHours ? `
          <div class="big">${DATA.records.topDayByHours.date.slice(5)}</div>
          <div class="label">${DATA.records.topDayByHours.totalDuration} (${DATA.records.topDayByHours.attendance}명)</div>
        ` : '<div class="label">데이터 없음</div>'}
      </div>
      <div class="card span-3 record-card">
        <h3>⏰ 월 피크타임</h3>
        ${DATA.records.peakHour ? `
          <div class="big">${DATA.records.peakHour.label}</div>
          <div class="label">누적 ${DATA.records.peakHour.totalPersonHours.toFixed(1)}명·시</div>
        ` : '<div class="label">데이터 없음</div>'}
      </div>

      <div class="card span-12">
        <h3>
          <span class="live-badge">${PUBLIC_MODE ? '📌' : '<span class="live-dot"></span>'}${PUBLIC_MODE ? '최종 수집 시점 출입자' : '현재 출입 중'}</span>
          <span style="float:right;color:var(--muted);font-weight:400;font-size:13px">총 ${inside.length}명</span>
        </h3>
        <div class="insider-list">
          ${inside.length === 0 ? '<div style="color:var(--muted);font-size:14px">현재 출입 중인 멤버가 없습니다.</div>' :
            inside.map(p => {
              const memberId = JSON.stringify(p[MEMBER_KEY]);
              return `
                <div class="insider" onclick='showMemberDetail(${memberId})'>
                  ${avatarHtml(p)}
                  <span>${p.name}</span>
                </div>`;
            }).join('')}
        </div>
      </div>

      <div class="card span-8">
        <div class="cal-head">
          <div class="cal-title" id="calTitle"></div>
          <div class="cal-nav">
            <button onclick="changeMonth(-1)">‹</button>
            <button onclick="goThisMonth()">오늘</button>
            <button onclick="changeMonth(1)">›</button>
          </div>
        </div>
        <div class="cal-grid" id="calendar"></div>
      </div>

      <div class="card span-4">
        <h3>🏆 이번달 전체 멤버 랭킹 <span style="color:var(--muted);font-weight:400;font-size:12px">(인정시간 · 기록 없음 0h)</span></h3>
        <div class="member-list" id="rankingList"></div>
      </div>

      <div class="card span-6">
        <h3>⏰ 시간대별 체류 분포</h3>
        <div class="chart-wrap"><canvas id="hourChart"></canvas></div>
      </div>
      <div class="card span-3">
        <h3>📊 요일별 총 학습시간</h3>
        <div class="chart-wrap"><canvas id="dowChart"></canvas></div>
      </div>
      <div class="card span-3">
        <h3>📆 주차별 출입 현황</h3>
        <div class="chart-wrap"><canvas id="weekChart"></canvas></div>
      </div>
    </div>`;

  renderCalendar();
  renderRanking();
  renderCharts();
}

function renderCalendar() {
  const year = currentYear, month = currentMonth;
  document.getElementById('calTitle').textContent = `${year}년 ${month}월`;
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const daysInMonth = last.getDate();
  const startDow = first.getDay();
  const dailyMap = new Map();
  let maxSec = 0;
  for (const d of DATA.daily) { dailyMap.set(d.date, d); if (d.totalSeconds > maxSec) maxSec = d.totalSeconds; }
  const kst = new Date(Date.now() + 9*3600*1000);
  const todayStr = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth()+1).padStart(2,'0')}-${String(kst.getUTCDate()).padStart(2,'0')}`;
  const cal = document.getElementById('calendar');
  const dows = ['일','월','화','수','목','금','토'];
  let html = dows.map(d => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < startDow; i++) html += `<div class="cal-day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const data = dailyMap.get(dateStr);
    const isToday = dateStr === todayStr;
    const heatPct = data && maxSec > 0 ? data.totalSeconds / maxSec * 100 : 0;
    html += `
      <div class="cal-day ${isToday?'today':''}" onclick="showDayDetail('${dateStr}')">
        <div class="date">${d}</div>
        ${data ? `<div class="hours">${data.totalHours.toFixed(1)}h</div><div class="stat">${data.attendance}명</div>` : ''}
        <div class="heat" style="height:${heatPct*0.5}%"></div>
      </div>`;
  }
  cal.innerHTML = html;
}

function renderRanking() {
  // 출입 기록이 없는 멤버도 0시간으로 포함한다.
  // 동시간인 경우 이름, 그 다음 내부 식별자로 정렬하므로 동명이인도 각각 유지된다.
  const members = DATA.members.slice().sort((a, b) =>
    ((b.totalSeconds || 0) - (a.totalSeconds || 0)) ||
    String(a.name || '').localeCompare(String(b.name || ''), 'ko') ||
    String(a[MEMBER_KEY] || '').localeCompare(String(b[MEMBER_KEY] || ''))
  );
  const maxSec = Math.max(1, ...members.map(m => m.totalSeconds || 0));
  const list = document.getElementById('rankingList');
  list.innerHTML = members.map((m, i) => {
    const rc = i < 3 ? `r${i+1}` : '';
    const totalSeconds = m.totalSeconds || 0;
    const totalHours = m.totalHours ?? 0;
    const attendedDays = m.attendedDays ?? 0;
    const avgPerDay = m.avgPerDay ?? 0;
    const pct = (totalSeconds / maxSec * 100).toFixed(1);
    const memberId = JSON.stringify(m[MEMBER_KEY]);
    return `
      <div class="member-row" onclick='showMemberDetail(${memberId})'>
        <div class="rank-badge ${rc}">${i+1}</div>
        ${avatarHtml(m)}
        <div class="member-info">
          <div class="member-name">${m.name} <span style="color:var(--muted);font-weight:400;font-size:12px">Lv.${m.level}</span></div>
          <div class="member-meta">${attendedDays}일 · 일평균 ${avgPerDay}h${m.guildNames && m.guildNames.length ? ` · ${m.guildNames.join('/')}` : ''}</div>
          <div class="bar-wrap"><div class="bar" style="width:${pct}%"></div></div>
        </div>
        <div class="member-hours">${totalHours}h</div>
      </div>`;
  }).join('') || '<div class="empty-state">등록된 길드 멤버가 없습니다.</div>';
}

function renderCharts() {
  Object.values(CHARTS).forEach(c => c.destroy());
  const commonOpt = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#8a93a6', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
      y: { ticks: { color: '#8a93a6', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }
    }
  };
  CHARTS.hour = new Chart(document.getElementById('hourChart'), {
    type: 'bar',
    data: {
      labels: DATA.hourly.map(h => h.label),
      datasets: [{
        data: DATA.hourly.map(h => h.totalPersonHours),
        backgroundColor: DATA.hourly.map(h => {
          const max = Math.max(...DATA.hourly.map(x => x.totalPersonHours));
          const ratio = max > 0 ? h.totalPersonHours / max : 0;
          return `rgba(124,92,255,${0.3+ratio*0.7})`;
        }),
        borderRadius: 4,
      }]
    },
    options: { ...commonOpt, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.y.toFixed(1)}명·시간` } } } }
  });
  CHARTS.dow = new Chart(document.getElementById('dowChart'), {
    type: 'bar',
    data: {
      labels: DATA.weekday.map(w => w.dayName),
      datasets: [{
        data: DATA.weekday.map(w => w.totalHours),
        backgroundColor: ['#ff6b6b','#7c5cff','#7c5cff','#7c5cff','#7c5cff','#00d4a4','#ff6b6b'],
        borderRadius: 4,
      }]
    },
    options: commonOpt
  });
  CHARTS.week = new Chart(document.getElementById('weekChart'), {
    type: 'bar',
    data: {
      labels: DATA.weekly.map(w => w.week+'주'),
      datasets: [{
        data: DATA.weekly.map(w => w.totalHours),
        backgroundColor: '#00d4a4', borderRadius: 4,
      }]
    },
    options: { ...commonOpt, plugins: { legend:{display:false}, tooltip: { callbacks: { label: c => ` ${c.parsed.y.toFixed(1)}시간 · 일평균 ${DATA.weekly[c.dataIndex].avgAttendance}명` } } } }
  });
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 12) { currentMonth = 1; currentYear++; }
  if (currentMonth < 1) { currentMonth = 12; currentYear--; }
  document.getElementById('year').value = currentYear;
  document.getElementById('month').value = currentMonth;
  loadData();
}
function goThisMonth() {
  const n = new Date(Date.now() + 9*3600*1000);
  currentYear = n.getUTCFullYear(); currentMonth = n.getUTCMonth()+1;
  document.getElementById('year').value = currentYear;
  document.getElementById('month').value = currentMonth;
  loadData();
}

function showMemberDetail(mbrId) {
  const m = DATA.members.find(x => x[MEMBER_KEY] === mbrId);
  if (!m) return;
  closeModals();
  const days = m.days || [];
  document.getElementById('modal').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeModals()">
      <div class="modal">
        <div class="modal-head">
          ${avatarHtml(m)}
          <div style="flex:1;min-width:0">
            <h2>${m.name}</h2>
            <div style="color:var(--muted);font-size:13px;margin-top:4px">
              Lv.${m.level} · ${m.guildNames.join(', ')} · 길드점수 ${m.personalScore} · 기여율 ${m.contributionRate}%
              ${m.email ? `<br><span style="font-size:12px">${m.email}</span>` : ''}
            </div>
          </div>
          <button class="modal-close" onclick="closeModals()">✕</button>
        </div>
        <div class="stats-row">
          <div class="stat-box"><div class="n">${m.totalDuration}</div><div class="l">누적 시간</div></div>
          <div class="stat-box"><div class="n">${m.totalHours}h</div><div class="l">인정 시간</div></div>
          <div class="stat-box"><div class="n">${m.attendedDays}일</div><div class="l">출석일</div></div>
          <div class="stat-box"><div class="n">${m.avgPerDay}h</div><div class="l">일평균</div></div>
        </div>
        ${m.wasCapped ? '<div style="margin-bottom:12px"><span class="tag-capped">⚠ 12시간 상한 적용된 날 있음</span></div>' : ''}
        ${m.missingSessions > 0 ? `<div style="margin-bottom:12px"><span class="tag-missing">⚠ 퇴실 미기록 ${m.missingSessions}건</span></div>` : ''}
        <h3 style="margin:0 0 10px;font-size:13px;color:var(--muted);text-transform:uppercase">일별 세션 내역</h3>
        <div class="session-list">
          ${days.length === 0 ? '<div class="empty-state">출입 기록이 없습니다.</div>' :
            days.slice().reverse().map(d => `
              <div class="session-day">
                <div class="day-head">
                  <div class="day-date">${d.date} (${d.dayOfWeek})</div>
                  <div class="day-total">${d.totalDuration}</div>
                </div>
                ${d.sessions.map(s => `
                  <div class="session-item">
                    <span class="session-time">${s.entry}</span>
                    <span style="color:var(--muted)">→</span>
                    <span class="session-time">${s.exit || '미기록'}</span>
                    ${s.isMissing ? '<span class="tag-missing">퇴실누락</span>' : ''}
                    <span class="session-dur">${s.duration || '--'}</span>
                  </div>`).join('')}
              </div>`).join('')}
        </div>
      </div>
    </div>`;
  document.getElementById('modal').style.display = 'block';
}

function showDayDetail(dateStr) {
  const d = DATA.daily.find(x => x.date === dateStr);
  closeModals();
  document.getElementById('dayModal').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeModals()">
      <div class="modal day-panel">
        <div class="header">
          <div>
            <h2>📅 ${dateStr}</h2>
            <div style="color:var(--muted);font-size:13px">${d ? d.members.length : 0}명 출입 · 인정시간 순</div>
          </div>
          <button class="modal-close" onclick="closeModals()">✕</button>
        </div>
        ${d ? `
          <div class="day-summary">
            <div class="day-stat"><div class="n">${d.attendance}명</div><div class="l">출석 인원</div></div>
            <div class="day-stat"><div class="n">${d.totalDuration}</div><div class="l">총 인정시간</div></div>
            <div class="day-stat"><div class="n">${d.totalHours.toFixed(1)}h</div><div class="l">총 시간</div></div>
          </div>
          <div class="member-list" style="max-height:400px">
            ${d.members.filter(m => m.seconds > 0).map((m, i) => {
              const full = DATA.members.find(x => x[MEMBER_KEY] === m[MEMBER_KEY]);
              const dayRec = full ? (full.days || []).find(x => x.date === dateStr) : null;
              const memberId = JSON.stringify(m[MEMBER_KEY]);
              return `
                <div class="member-row" onclick='showMemberDetail(${memberId})'>
                  <div class="rank-badge ${i<3?`r${i+1}`:''}">${i+1}</div>
                  ${full ? avatarHtml(full) : `<div class="avatar">${initials(m.name)}</div>`}
                  <div class="member-info">
                    <div class="member-name">${m.name}</div>
                    ${dayRec ? `<div style="font-size:11px;color:var(--muted);margin-top:3px;font-family:monospace">
                      ${dayRec.sessions.map(s => `${s.entry}~${s.exit || '진행중'}`).join(' / ')}
                    </div>` : ''}
                  </div>
                  <div class="member-hours">${m.duration}</div>
                </div>`;
            }).join('')}
            ${d.members.filter(m => m.seconds > 0).length === 0 ? '<div class="empty-state">출입 기록 없음</div>' : ''}
          </div>` : '<div class="empty-state">출입 기록이 없습니다.</div>'}
      </div>
    </div>`;
  document.getElementById('dayModal').style.display = 'block';
}

function closeModals() {
  ['modal','dayModal'].forEach(id => {
    document.getElementById(id).style.display = 'none';
    document.getElementById(id).innerHTML = '';
  });
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });
document.getElementById('loginPw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('loginId').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginPw').focus(); });

async function boot() {
  const sess = await checkSession();

  if (sess.__static) {
    // 정적 모드 (GitHub Pages 등 백엔드 없이 호스팅된 경우)
    PUBLIC_MODE = true;
    MEMBER_KEY = '_publicId';
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainUI').style.display = 'block';

    // 공개 뷰 배지 삽입
    const userInfo = document.getElementById('userInfo');
    userInfo.innerHTML = `<span class="gh-status ok" title="GitHub Pages에서 제공되는 읽기 전용 공개 뷰입니다. 30분마다 자동 갱신">
      🌐 공개 뷰 (읽기 전용)
      <a class="gh-sync-btn" href="${CODESPACE_URL}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">🚀 Codespaces로 라이브 보기</a>
    </span>`;

    // 공개 뷰도 연/월을 선택할 수 있지만 최초 진입은 항상 현재 KST 연월이다.
    const n = new Date(Date.now() + 9*3600*1000);
    currentYear = n.getUTCFullYear();
    currentMonth = n.getUTCMonth() + 1;
    document.getElementById('year').disabled = false;
    document.getElementById('month').disabled = false;
    document.getElementById('year').value = currentYear;
    document.getElementById('month').value = currentMonth;

    document.getElementById('app').innerHTML = '<div class="loading"><div class="spinner"></div><br>공개 데이터 로딩 중...</div>';
    await loadData();
    if (REFRESH_TIMER) clearInterval(REFRESH_TIMER);
    REFRESH_TIMER = setInterval(() => loadData(), 5*60*1000);
    return;
  }

  if (sess.loggedIn) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainUI').style.display = 'block';
    const n = new Date(Date.now() + 9*3600*1000);
    document.getElementById('year').value = n.getUTCFullYear();
    document.getElementById('month').value = n.getUTCMonth()+1;
    currentYear = n.getUTCFullYear(); currentMonth = n.getUTCMonth()+1;
    await loadData();
    if (DATA) {
      if (REFRESH_TIMER) clearInterval(REFRESH_TIMER);
      REFRESH_TIMER = setInterval(() => { if (DATA) loadData(); }, 90000);
    }
  } else {
    showLoginScreen(sess.authMode === 'session-env'
      ? '저장된 세션이 없거나 만료되었습니다. 다시 로그인해주세요.'
      : '');
  }
}

window.addEventListener('DOMContentLoaded', boot);
