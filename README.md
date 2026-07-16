# 🎯 SECOM 출입 대시보드

> 코디시(codyssey.kr) 길드 멤버들의 출입/학습 시간(SECOM)을 시각화하는 웹 대시보드

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?repo=자신의리포주소&devcontainer_path=.devcontainer%2Fdevcontainer.json)

---

## ✨ 핵심: 대시보드에서 로그인만 하면 Actions까지 자동 반영

가장 편한 워크플로입니다:

1. Codespaces(또는 로컬)에서 대시보드 서버를 띄움
2. 브라우저에서 codyssey 아이디/비번으로 로그인
3. ✅ 로그인 성공과 동시에 **서버가 자동으로 JSESSIONID를 GitHub Secret `CODYSSEY_SESSION`에 업로드**
4. GitHub Actions가 매시 자동 실행될 때 이 최신 세션을 사용 (캐시가 있으면 캐시, 없으면 Secret에서 부트스트랩)
5. 세션이 만료되면 대시보드에 다시 로그인만 하면 됨 → 수동으로 쿠키를 복사하거나 Secrets에 들어가 편집할 필요가 **전혀 없음**

---

## 🚀 로컬 실행

```bash
cd dashboard
npm install
# 선택사항: 대시보드에서 로그인 시 자동으로 GitHub Secret에 세션을 동기화하고 싶으면
# GitHub Personal Access Token (classic, repo 스코프) 을 환경변수로 넣어서 기동
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
export GITHUB_REPOSITORY=owner/repo
npm start          # http://localhost:3000
```

GITHUB_TOKEN을 넣지 않아도 대시보드 자체는 사용 가능하지만, Actions와의 자동 연동은 비활성화됩니다.

---

## ☁️ GitHub Codespaces (한 클릭 실행)

1. 저장소를 본인 GitHub 계정으로 Fork
2. Fork한 리포에서 **Settings → Secrets and variables → Codespaces → New secret**
   - Name: `GITHUB_TOKEN_SYNC`
   - Value: GitHub Personal Access Token(classic, `repo` 스코프)
3. **Code → Codespaces → Create codespace on main**
4. 1~2분 후 자동으로 서버가 기동되고 브라우저에 대시보드가 열림 → 로그인하면 자동으로 세션이 Secret에 업로드

---

## ⏰ GitHub Actions 자동 수집

대시보드에서 한 번 로그인하면, 이후로는 매시 KST 05분에 자동 실행되어:

- 세션이 살아있으면 바로 데이터 수집
- 캐시가 없으면 Secret `CODYSSEY_SESSION` 값으로 세션을 초기화
- 세션이 만료되어 실패하면 대시보드에 로그인 한 번 해주면 다음 실행부터 다시 동작

**따로 설정할 Secret:**
- 조회 대상 길드는 서버와 Actions에서 `3,4,5,6`으로 고정되며 하나의 통합 랭킹으로 집계됩니다.
- `GITHUB_TOKEN_SYNC` (Codespaces용 PAT. 로컬에서는 `GITHUB_TOKEN` 환경변수로 사용)
- `CODYSSEY_SESSION`은 **자동으로 생성/갱신됨** (수동으로 넣지 마세요!)

결과는 Actions 실행 페이지에서 `secom-data-<runid>` 아티팩트로 다운로드할 수 있습니다.

### 주의
- 대시보드와 Actions가 같은 리포지토리를 가리켜야 자동 동기화됩니다.
- Actions Cache는 7일간 접근 없으면 만료되므로, 매일 1회 이상 실행돼야 영구 유지됩니다.
- PAT는 반드시 본인만 사용하는 개인 리포에서만 사용하세요. Public/공유 리포에는 사용하지 마세요.

---

## 📁 프로젝트 구조

```
├── .devcontainer/
│   └── devcontainer.json    # Codespaces 자동 설정 + GITHUB_TOKEN_SYNC 시크릿 연동
├── .github/workflows/
│   └── collect.yml          # Actions 수집 (Secret/캐시로 세션 영구 유지)
├── dashboard/
│   ├── server.js            # Express 백엔드 + 로그인 + GitHub Secret 자동동기화
│   ├── package.json
│   └── public/
│       └── index.html       # 대시보드 UI (GitHub 연동 상태 표시)
├── collect_*.js             # CLI 수집 스크립트
├── .gitignore
└── README.md
```

---

## 🔒 보안
- 아이디/비밀번호는 대시보드 서버 → codyssey.kr 직접 전송 (제3자 경유 없음).
- GITHUB_TOKEN/PAT가 있으면 세션(JSESSIONID)만 GitHub API를 통해 리포 Secret `CODYSSEY_SESSION`에 sodium SealedBox 암호화해 업로드합니다. 아이디/비밀번호는 GitHub에 절대 올라가지 않습니다.
- 세션 파일 `.session-cookies.json`은 `.gitignore`에 포함되어 커밋되지 않습니다.
- GitHub Secrets는 AES 암호화 저장, 로그 마스킹, Fork PR 격리가 적용됩니다.
