# 🎯 SECOM 출입 대시보드

> 코디시(codyssey.kr) 3·4·5·6길드 멤버들의 출입/학습 시간을 하나로 통합해 보여주는 대시보드

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new/giyeop-cody/codyssey_Jail_Tracker?devcontainer_path=.devcontainer%2Fdevcontainer.json)

---

## 동작 흐름

### Codespace

1. 저장된 Codyssey 세션이 없거나 만료되면 로그인 폼을 표시합니다.
2. Codyssey 계정으로 로그인해 새 `JSESSIONID`를 받습니다.
3. 서버가 `JSESSIONID`를 Repository Actions Secret `CODYSSEY_SESSION`으로 생성/갱신합니다.
4. 3·4·5·6길드를 모두 조회하고 멤버를 하나의 대시보드로 통합합니다.

### GitHub Pages

1. GitHub Actions가 `CODYSSEY_SESSION`으로 최신 데이터를 수집합니다.
2. 성공한 데이터를 정제해 GitHub Pages에 배포합니다.
3. 세션이 없거나 만료되어 데이터가 없으면 Codespace 실행/로그인 버튼을 표시합니다.
4. Codespace에서 다시 로그인한 후 `Collect SECOM Data`를 실행하면 Pages가 자동 갱신됩니다.

---

## 최초 1회 GitHub 설정

### 1. Fine-grained PAT 발급

GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**에서 생성합니다.

- **Repository access**: `Only select repositories`
- 대상 저장소: `giyeop-cody/codyssey_Jail_Tracker`
- **Repository permissions → Secrets**: `Read and write`
- 만료 기간은 가능한 짧게 설정

Classic PAT를 사용한다면 `repo` 스코프가 필요합니다.

### 2. Codespaces Secret 등록

저장소의 **Settings → Secrets and variables → Codespaces → New repository secret**으로 이동합니다.

| 항목 | 값 |
|---|---|
| Name | `GH_PAT_SYNC` |
| Secret | 위에서 발급한 PAT |

> GitHub Secret 이름은 `GITHUB_`로 시작할 수 없으므로 반드시 `GH_PAT_SYNC`를 사용합니다.

`GITHUB_REPOSITORY`는 Codespaces가 `owner/repo` 형식으로 자동 제공하므로 별도 Secret 등록이 필요 없습니다.

Secret을 새로 등록하거나 수정했다면 실행 중인 Codespace를 **Stop한 후 다시 Start**해야 반영됩니다.

### 3. Codespace 실행 및 최초 로그인

1. 저장소에서 **Code → Codespaces → Create codespace on main**
2. 포트 3000의 `/app.html` 열기
3. Codyssey 계정으로 로그인
4. 상단의 `GitHub 연동됨` 확인
5. 저장소 **Settings → Secrets and variables → Actions**에서 `CODYSSEY_SESSION` 생성 확인
6. **Actions → Collect SECOM Data → Run workflow** 실행

`CODYSSEY_SESSION` 값은 직접 등록하지 않습니다. Codespace 로그인 서버가 자동으로 생성하고 세션 만료 때마다 갱신합니다.

---

## Codespace 문제 확인

```bash
# Secret 주입 여부: 값 자체는 출력하지 않음
if [ -n "${GH_PAT_SYNC:-}" ]; then echo "GH_PAT_SYNC=set"; else echo "GH_PAT_SYNC=missing"; fi

echo "$GITHUB_REPOSITORY"
# 예상: giyeop-cody/codyssey_Jail_Tracker
```

최신 코드로 서버를 다시 실행하려면:

```bash
cd /workspaces/codyssey_Jail_Tracker
git pull origin main
cd dashboard
npm ci
npm test
pkill -f 'node server.js' || true
GITHUB_TOKEN="$GH_PAT_SYNC" GITHUB_REPOSITORY="giyeop-cody/codyssey_Jail_Tracker" npm start
```

---

## 로컬 실행

```bash
cd dashboard
npm install

# Secret 자동 동기화를 사용할 때만 설정
export GITHUB_TOKEN=github_pat_xxxxxxxxxxxx
export GITHUB_REPOSITORY=giyeop-cody/codyssey_Jail_Tracker

npm start
```

브라우저에서 http://localhost:3000/app.html 접속

---

## GitHub Actions

`Collect SECOM Data`가 30분마다 실행되어:

- Actions Secret `CODYSSEY_SESSION`으로 인증
- 3·4·5·6길드 멤버를 `mbrId` 기준으로 중복 제거 및 통합
- 수집 결과를 `secom-data-<runid>` 아티팩트로 업로드
- 성공 시 `Deploy to GitHub Pages`가 `app.html`과 정제된 `data.json` 배포

세션이 만료되면 수집 작업은 명확하게 실패하며, GitHub Pages는 Codespace에서 다시 로그인하도록 안내합니다.

---

## 프로젝트 구조

```text
├── .devcontainer/
│   └── devcontainer.json    # Codespaces 설정 + GH_PAT_SYNC 연동
├── .github/workflows/
│   ├── collect.yml          # 30분 주기 통합 수집
│   └── pages.yml            # 정적 대시보드 배포
├── dashboard/
│   ├── lib/                 # 고정 길드 및 통합 로직
│   ├── public/app.html      # 로그인/라이브/정적 대시보드 UI
│   ├── scripts/             # 공개 데이터 정제
│   ├── test/                # 회귀 테스트
│   └── server.js            # 인증, 집계, Secret 자동 갱신
└── README.md
```

## 보안

- Codyssey 아이디/비밀번호는 대시보드 서버에서 Codyssey 인증 서버로만 전달됩니다.
- GitHub에는 비밀번호가 아닌 `JSESSIONID`만 암호화된 Actions Secret으로 저장됩니다.
- `.session-cookies.json`은 `.gitignore` 대상입니다.
- PAT는 저장소 Secret으로만 등록하고 코드, 터미널 로그, 채팅에 붙여 넣지 마세요.
