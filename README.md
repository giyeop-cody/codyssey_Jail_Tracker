# 🎯 Codyssey Jail Tracker

Codyssey의 **3·4·5·6길드** 멤버 SECOM 출입/학습 기록을 하나로 합쳐 보여주는 대시보드입니다.

- **원본 데모 Pages:** https://giyeop-cody.github.io/codyssey_Jail_Tracker/
- **원본 Codespaces:** [Open in GitHub Codespaces](https://github.com/codespaces/new/giyeop-cody/codyssey_Jail_Tracker?devcontainer_path=.devcontainer%2Fdevcontainer.json)
- **Fork Pages 주소:** `https://<내-GitHub-ID>.github.io/<Fork-저장소명>/`
- **기본 조회 월:** 접속 시점의 KST 현재 연·월
- **공개 월별 기록:** `data/YYYY-MM.json` 형식으로 보관

---

## 목차

1. [주요 기능](#주요-기능)
2. [집계 기준](#집계-기준)
3. [전체 동작 구조](#전체-동작-구조)
4. [Fork해서 사용하는 방법](#fork해서-사용하는-방법)
5. [토큰 발급·권한·등록](#토큰-발급권한등록)
6. [사용 방법](#사용-방법)
7. [과거 월 조회와 백필](#과거-월-조회와-백필)
8. [GitHub Actions](#github-actions)
9. [환경변수](#환경변수)
10. [API](#api)
11. [프로젝트 구조](#프로젝트-구조)
12. [개발 및 테스트](#개발-및-테스트)
13. [문제 해결](#문제-해결)
14. [보안 및 비용](#보안-및-비용)

---

## 주요 기능

### 대시보드

- 3·4·5·6길드 멤버를 하나의 통합 랭킹으로 표시
- 월간 인정 학습시간, 출석일, 일평균 시간 제공
- 월 기록이 없는 멤버도 랭킹 하단에 `0h`로 표시
- 날짜별 출입 인원 및 학습시간 캘린더
- 시간대·요일·주차별 통계 차트
- 현재 출입 중인 멤버 표시
- 멤버별 일일 출입 세션 상세 조회

### 연·월 조회

- Codespace와 GitHub Pages 모두 연도·월 변경 가능
- 첫 화면은 항상 현재 KST 연·월
- 연·월 입력 후 `불러오기` 또는 달력의 `‹`, `›` 버튼으로 이동
- Pages는 저장된 `data/YYYY-MM.json`을 조회
- 없는 월은 오류 대신 “해당 월 기록이 없습니다” 안내

### 세션 자동화

- 세션 없음/만료 시 Codespace에서 로그인 폼 표시
- 로그인 성공 시 새 `JSESSIONID` 확보
- `CODYSSEY_SESSION` Repository Actions Secret 자동 생성/갱신
- Secret 저장 직후 `Collect SECOM Data` workflow 자동 실행
- 수집 성공 후 GitHub Pages 자동 배포
- Secret 저장과 workflow 실행이 부분 실패하면 실제 GitHub API 오류 표시

---

## 집계 기준

### 조회 대상

서버에서 조회 대상을 다음 값으로 고정합니다.

```js
[3, 4, 5, 6]
```

프런트엔드 또는 외부 요청에서 `guildIds`, `allGuilds`를 전달해도 무시합니다. 길드 번호 입력 UI도 제공하지 않습니다.

### 중복 멤버

중복 여부는 이름이 아니라 Codyssey 내부 고유값인 **`mbrId`**로 판단합니다.

- 같은 `mbrId`가 여러 길드 응답에 있으면 한 명으로 병합
- 병합된 멤버의 `guildNames`에 길드명만 추가
- 이름이 같아도 `mbrId`가 다르면 서로 다른 사람으로 유지
- 공개 Pages에서는 병합 완료 후 `mbrId`를 제거하고 해시된 `_publicId`로 교체

### 전체 멤버와 활동 멤버

- **전체 멤버:** 네 길드 응답을 `mbrId` 기준으로 중복 제거한 전체 인원
- **활동 멤버:** 선택한 월의 SECOM 인정시간이 1초 이상인 인원
- **0시간 멤버:** 해당 월 기록은 없지만 전체 랭킹에는 포함되는 인원
- **현재 출입 중:** 오늘 입실 후 퇴실 기록이 없는 세션을 가진 인원

활동 멤버와 현재 출입 중 인원은 서로 다른 지표입니다.

---

## 전체 동작 구조

```mermaid
flowchart TD
    U[사용자] -->|Codespace 접속| APP[Express + app.html]
    APP -->|세션 없음/만료| LOGIN[Codyssey 로그인 폼]
    LOGIN --> AUTH[Codyssey 인증]
    AUTH --> COOKIE[JSESSIONID]
    COOKIE --> LIVE[3·4·5·6길드 통합 조회]
    COOKIE --> SECRET[Repository Secret CODYSSEY_SESSION]
    SECRET --> DISPATCH[Collect SECOM Data workflow_dispatch]
    DISPATCH --> COLLECT[현재 월 또는 백필 월 수집]
    COLLECT --> ARTIFACT[수집 Artifact]
    ARTIFACT --> PAGES[Deploy to GitHub Pages]
    PAGES --> HISTORY[data/YYYY-MM.json]
    HISTORY --> U
```

### Codespace 라이브 모드

- Express 백엔드가 Codyssey API에 직접 요청
- 연·월 변경 시 즉시 다시 집계
- 세션 만료를 감지하면 새로고침 반복 없이 로그인 폼으로 전환
- 로그인 후 Secret 저장 및 Action 실행 결과를 상단 배지로 표시

### GitHub Pages 공개 모드

- 백엔드가 없는 읽기 전용 정적 모드
- 민감정보 제거가 끝난 월별 JSON만 사용
- 기존 Pages 월별 파일과 새 수집 파일을 병합하여 과거 월 유지
- 세션이 없어 데이터가 없으면 Codespace 실행 버튼 표시

---

## Fork해서 사용하는 방법

원본 저장소의 Secret, Actions 실행 이력, Codespace, Pages 데이터는 Fork에 복사되지 않습니다. 아래 설정은 **Fork한 본인 저장소에서 각각 한 번씩** 해야 합니다.

### 1. 저장소 Fork

1. 원본 저장소 `https://github.com/giyeop-cody/codyssey_Jail_Tracker` 접속
2. 우측 상단 **Fork** 클릭
3. **Owner**에서 본인 GitHub 계정 선택
4. 저장소 이름 확인(기본값 `codyssey_Jail_Tracker` 권장)
5. **Create fork** 클릭

이후 모든 Settings, Actions, Codespaces 작업은 다음 형태의 **내 Fork 저장소**에서 진행합니다.

```text
https://github.com/<내-GitHub-ID>/codyssey_Jail_Tracker
```

### 2. Fork의 GitHub Actions 활성화

Fork 저장소에서 **Actions** 탭을 엽니다. 비활성화 안내가 나오면 다음 버튼을 누릅니다.

```text
I understand my workflows, go ahead and enable them
```

확인할 workflow:

- `Collect SECOM Data`
- `Deploy to GitHub Pages`

추가로 **Settings → Actions → General**에서 Actions 사용이 허용되어 있는지 확인합니다. Workflow 파일에는 필요한 권한이 명시되어 있으므로 기본 `GITHUB_TOKEN` 권한을 과도하게 넓힐 필요는 없습니다.

### 3. Fork의 GitHub Pages 활성화

Fork 저장소에서:

```text
Settings
→ Pages
→ Build and deployment
→ Source: GitHub Actions
```

최초 데이터 수집 및 Pages workflow 성공 후 주소는 다음과 같습니다.

```text
https://<내-GitHub-ID>.github.io/<Fork-저장소명>/
```

Pages의 Codespace 버튼과 과거 데이터 복원 주소는 현재 Fork의 owner/repository를 자동으로 사용합니다.

### 4. PAT 발급 및 Codespaces Secret 등록

아래 [토큰 발급·권한·등록](#토큰-발급권한등록) 절차에 따라 PAT를 만든 뒤 **Fork 저장소**에 `GH_PAT_SYNC`를 등록합니다.

### 5. Fork에서 Codespace 생성

원본 저장소가 아니라 **내 Fork 저장소**에서 실행합니다.

```text
Fork 저장소
→ Code
→ Codespaces
→ Create codespace on main
```

`GH_PAT_SYNC` 등록 전에 Codespace를 만들었다면 Secret 반영을 위해 Stop/Start 또는 Rebuild가 필요합니다.

### 6. 최초 로그인 및 배포 확인

1. 자동으로 열린 포트 3000에서 `/app.html` 접속
2. Codyssey 계정으로 로그인
3. 상단 `수집 요청 완료` 확인
4. Fork의 **Settings → Secrets and variables → Actions**에서 `CODYSSEY_SESSION` 생성 확인
5. Fork의 **Actions**에서 `Collect SECOM Data` 성공 확인
6. 이어서 `Deploy to GitHub Pages` 성공 확인
7. 내 Fork Pages 주소 접속

과거 월도 필요하면 `Collect SECOM Data`를 수동 실행하고 `backfill_from`을 입력합니다.

---

## 토큰 발급·권한·등록

### 토큰 용도

`GH_PAT_SYNC`는 Codespace 로그인 서버가 다음 두 작업을 수행할 때만 사용합니다.

1. Codyssey `JSESSIONID`를 Fork 저장소의 Actions Secret `CODYSSEY_SESSION`으로 저장
2. Fork 저장소의 `Collect SECOM Data` workflow 즉시 실행

Codyssey 비밀번호를 GitHub에 저장하는 토큰이 아닙니다.

### 1. Fine-grained PAT 발급

GitHub 개인 설정에서 다음 경로로 이동합니다.

```text
프로필 사진
→ Settings
→ Developer settings
→ Personal access tokens
→ Fine-grained tokens
→ Generate new token
```

권장 입력:

| 항목 | 설정값 |
|---|---|
| Token name | `Jail Tracker Session Sync` |
| Expiration | 가능한 짧은 기간 |
| Resource owner | Fork를 소유한 본인 계정 |
| Repository access | `Only select repositories` |
| Selected repository | **내 Fork 저장소** |

### 2. 필수 토큰 권한

**Repository permissions**에서 다음 권한을 설정합니다.

| 권한 | 수준 | 필요한 이유 |
|---|---|---|
| `Secrets` | **Read and write** | `CODYSSEY_SESSION` 생성/갱신 |
| `Actions` | **Read and write** | `Collect SECOM Data` workflow dispatch |
| `Metadata` | Read-only | GitHub가 자동 부여 |

다음 권한은 대시보드의 Secret 동기화에 필요하지 않습니다.

- Administration
- Codespaces
- Issues
- Pull requests
- Contents write

Fork에서 일반적인 `git pull`/`git push`는 Codespaces가 기본 제공하는 인증을 사용합니다. 같은 PAT를 Git 작업에도 사용할 특별한 이유가 없다면 `Contents: Read and write`는 추가하지 않는 것이 좋습니다.

Classic PAT를 사용해야 한다면 `repo` 스코프가 필요하지만, 권한 최소화를 위해 Fine-grained PAT를 권장합니다.

### 3. 토큰 값 복사

토큰 생성 직후 표시되는 값을 복사합니다. 이 값은 다시 전체 표시되지 않습니다.

```text
github_pat_...
```

토큰을 README, 코드, 커밋, 이슈, 채팅, 터미널 출력에 붙여 넣지 마세요.

### 4. Fork 저장소의 Codespaces Secret에 등록

**내 Fork 저장소**에서:

```text
Settings
→ Secrets and variables
→ Codespaces
→ New repository secret
```

| 항목 | 값 |
|---|---|
| Name | `GH_PAT_SYNC` |
| Secret | 방금 발급한 Fine-grained PAT |

> Secret 이름은 `GITHUB_`로 시작할 수 없으므로 반드시 `GH_PAT_SYNC`를 사용합니다.

`GH_PAT_SYNC`는 **Actions Secret이 아니라 Codespaces Secret**입니다.

### 5. 자동 생성되는 Actions Secret

다음 Secret은 직접 만들지 않습니다.

```text
CODYSSEY_SESSION
```

Codespace에서 Codyssey 로그인에 성공하면 서버가 Fork 저장소의 다음 위치에 자동 생성합니다.

```text
Settings
→ Secrets and variables
→ Actions
→ Repository secrets
```

### 6. Secret 변경 후 Codespace 재시작

Codespaces Secret은 실행 중인 컨테이너에 즉시 반영되지 않습니다.

1. https://github.com/codespaces 접속
2. 해당 Codespace의 `...` 메뉴
3. **Stop codespace**
4. 다시 **Start codespace**
5. 필요하면 `Codespaces: Rebuild Container`

값 자체를 노출하지 않고 주입 여부를 확인합니다.

```bash
if [ -n "${GH_PAT_SYNC:-}" ]; then
  echo "GH_PAT_SYNC=set"
else
  echo "GH_PAT_SYNC=missing"
fi

echo "$GITHUB_REPOSITORY"
# 예상: <내-GitHub-ID>/<Fork-저장소명>
```

### 7. 권한 오류 확인

| 오류 | 확인할 권한/설정 |
|---|---|
| `Repository Secrets 공개키 조회 실패: 403` | PAT의 `Secrets: Read and write` 및 Fork 선택 여부 |
| `CODYSSEY_SESSION 저장 실패: 403` | PAT의 `Secrets: Read and write` |
| `Collect workflow 실행 요청 실패: 403` | PAT의 `Actions: Read and write` |
| `GH_PAT_SYNC가 현재 컨테이너에 주입되지 않았습니다` | Codespaces Secret 이름, Stop/Start, Rebuild |
| Secret은 생성됐지만 Action이 즉시 실행되지 않음 | `Actions` 권한 수정 후 상단 `재시도`; 예약 실행은 30분마다 동작 |

토큰을 새로 발급했다면 Fork의 `GH_PAT_SYNC` 값을 갱신하고 Codespace를 반드시 재시작합니다.

---

## 사용 방법

### GitHub Pages

1. `https://<내-GitHub-ID>.github.io/<Fork-저장소명>/` 접속
2. 기본 현재 연·월 데이터 확인
3. 상단 연도·월 변경 후 `불러오기`
4. 또는 캘린더의 `‹`, `오늘`, `›` 버튼 사용

원본 데모는 https://giyeop-cody.github.io/codyssey_Jail_Tracker/ 에서 확인할 수 있습니다. Pages는 각 저장소에서 공개 저장된 월만 조회합니다.

### Codespace

기존 Codespace를 최신화하려면:

```bash
# Codespace 터미널은 보통 Fork 저장소 루트에서 시작합니다.
cd /workspaces/<Fork-저장소명>
git pull origin main

cd dashboard
npm ci
npm test

pkill -f 'node server.js' || true
npm start
```

접속 주소:

```text
https://<codespace-name>-3000.app.github.dev/app.html
```

### 로컬 실행

```bash
cd dashboard
npm install
npm start
```

브라우저:

```text
http://localhost:3000/app.html
```

로컬 로그인 후 GitHub Secret 자동 동기화까지 사용할 경우:

```bash
export GITHUB_TOKEN=github_pat_xxxxxxxxxxxx
export GITHUB_REPOSITORY=<내-GitHub-ID>/<Fork-저장소명>
npm start
```

Codespaces에서는 `GITHUB_TOKEN` 대신 `GH_PAT_SYNC`만 사용합니다. 권한이 불명확한 기본 Codespaces 토큰으로 자동 대체하지 않습니다.

---

## 과거 월 조회와 백필

### 현재 공개 월

월별 공개 데이터는 다음 구조로 배포됩니다.

```text
data/index.json
data/2026-04.json
data/2026-05.json
data/2026-06.json
data/2026-07.json
```

`data/index.json`은 조회 가능한 월과 최신 월 메타데이터를 제공합니다.

### 과거 데이터 추가

GitHub에서:

```text
Actions
→ Collect SECOM Data
→ Run workflow
```

`backfill_from`에 시작월을 입력합니다.

```text
2026-04
```

그러면 시작월부터 현재 월까지 수집합니다. 한 번에 최대 24개월까지 허용합니다.

- 예약 실행: 현재 월만 갱신
- 로그인 직후 자동 실행: 현재 월만 갱신
- 수동 백필: 입력한 시작월부터 현재 월까지 수집

과거 월을 매번 재수집하지 않으므로 Actions 실행시간과 Codyssey API 요청량을 줄입니다.

---

## GitHub Actions

### Collect SECOM Data

파일: `.github/workflows/collect.yml`

트리거:

- 30분 예약 실행
- Codespace 로그인 직후 API dispatch
- Actions 화면 수동 실행
- 수동 실행 시 `backfill_from` 입력 지원

처리:

1. `CODYSSEY_SESSION` 확인
2. Express 서버 실행
3. 고정 길드 3·4·5·6 조회
4. `mbrId` 기준 멤버 병합
5. 월별 SECOM 집계
6. `artifacts/months/YYYY-MM.json` 생성
7. `secom-data-<run_id>` Artifact 업로드

### Deploy to GitHub Pages

파일: `.github/workflows/pages.yml`

트리거:

- Collect workflow 성공
- 대시보드/스크립트 변경 push
- 수동 실행

처리:

1. 수집 Artifact 다운로드 또는 현재 월 직접 수집
2. 기존 공개 월별 기록 복원
3. 민감 필드 제거
4. 새 월별 데이터 병합
5. `data/index.json`, `data/YYYY-MM.json` 생성
6. GitHub Pages 배포

### Artifact 보관

- 수집 Artifact: 7일
- Pages Artifact: GitHub Pages 기본 보관정책
- 장기 공개 기록: Pages의 월별 JSON으로 유지

---

## 환경변수

| 변수 | 사용 위치 | 필수 여부 | 설명 |
|---|---|---:|---|
| `PORT` | 서버 | 선택 | 기본 `3000` |
| `CODYSSEY_SESSION` | Actions/서버 | Actions 필수 | Codyssey `JSESSIONID` |
| `CODYSSEY_ID` | 서버 | 선택 | 환경변수 자동 로그인 ID |
| `CODYSSEY_PW` | 서버 | 선택 | 환경변수 자동 로그인 비밀번호 |
| `GH_PAT_SYNC` | Codespaces | Secret 동기화 시 필수 | Repository Secrets/Actions 쓰기 PAT |
| `GITHUB_TOKEN` | 로컬 | 선택 | 로컬 Secret 동기화용 PAT |
| `GITHUB_REPOSITORY` | Codespaces/로컬 | 동기화 시 필수 | `owner/repo` |
| `SECOM_COOKIE_FILE` | 서버 | 선택 | 세션 파일 경로 변경 |
| `TZ` | Actions | 선택 | `Asia/Seoul` 사용 |

Secret 값 자체를 로그나 화면에 출력하지 마세요.

---

## API

| Method | Endpoint | 설명 |
|---|---|---|
| `GET` | `/api/session` | 로그인 및 GitHub 동기화 상태 |
| `POST` | `/api/login` | Codyssey 로그인, Secret 저장, workflow 실행 |
| `POST` | `/api/logout` | 메모리/디스크 세션 제거 |
| `POST` | `/api/sync-github` | 현재 세션 재동기화 및 수집 재실행 |
| `GET` | `/api/session/debug` | 쿠키 이름 등 값 없는 진단정보 |
| `POST` | `/api/aggregate` | 고정 네 길드 통합 월별 집계 |
| `GET` | `/api/guilds` | 진단용 길드 목록 조회 |
| `GET` | `/api/guild/:guildId` | 진단용 단일 길드 조회 |
| `GET` | `/api/secom/:mbrId` | 진단용 단일 멤버 SECOM 조회 |

`POST /api/aggregate` 예시:

```json
{
  "year": 2026,
  "month": 7,
  "seasonId": 5,
  "weekNo": 9
}
```

`guildIds`나 `allGuilds`를 전달해도 조회 범위는 변경되지 않습니다.

---

## 프로젝트 구조

```text
├── .devcontainer/
│   └── devcontainer.json
├── .github/workflows/
│   ├── collect.yml                 # 월별 데이터 수집
│   └── pages.yml                   # 월별 기록 병합 및 Pages 배포
├── dashboard/
│   ├── lib/
│   │   ├── github-sync.js          # Secret 암호화/업로드/workflow dispatch
│   │   └── tracked-guilds.js       # 고정 길드 및 mbrId 병합
│   ├── public/
│   │   ├── app.html                # 대시보드 마크업
│   │   ├── app.css                 # 대시보드 스타일
│   │   ├── app.js                  # 라이브/공개 모드 UI 로직
│   │   └── index.html              # 로컬 소개 페이지
│   ├── scripts/
│   │   ├── build-public-history.js # 기존 월 복원 + 신규 월 병합
│   │   └── sanitize-for-public.js  # 공개 데이터 민감정보 제거
│   ├── test/                        # Node 내장 테스트
│   ├── package.json
│   └── server.js                    # Express/Auth/API/Aggregate 조립
├── collect_all.js
├── collect_guild_members.js
├── collect_secom.js
└── README.md
```

### 리팩터링 원칙

- `server.js`: HTTP 라우팅, 세션, Codyssey API 집계 조립
- `lib/github-sync.js`: GitHub 인증/Secret/workflow 책임 분리
- `lib/tracked-guilds.js`: 고정 길드와 멤버 병합 책임 분리
- `app.html`, `app.css`, `app.js`: 마크업·스타일·동작 분리
- `scripts`: CI/Pages 빌드 전용 로직 분리
- 외부 동작은 테스트 가능한 순수 함수 또는 주입 가능한 서비스로 유지

---

## 개발 및 테스트

```bash
cd dashboard
npm ci
npm test
```

테스트 범위:

- 고정 길드 3·4·5·6
- 길드 번호 UI 미노출
- `mbrId` 중복 병합과 동명이인 분리
- 0시간 멤버 랭킹 포함
- 세션 만료 시 로그인 화면 전환
- Secret 저장 후 workflow dispatch
- GitHub API 오류 전달
- 공개 데이터 민감정보 제거
- 월별 기록 사이트 빌드
- 현재 연·월 기본값 및 과거 월 조회

문법 확인:

```bash
node --check server.js
node --check lib/github-sync.js
node --check public/app.js
node --check scripts/build-public-history.js
```

---

## 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| 로그인 폼 대신 세션 만료 반복 | 이전 서버/만료 쿠키 | 최신 코드 pull 후 서버 재시작 |
| `GH_PAT_SYNC=missing` | Codespaces Secret 미주입 | Codespace Stop/Start 또는 Rebuild |
| Secret 저장 403 | PAT `Secrets` 권한 부족 | Secrets `Read and write` |
| Action 실행 403 | PAT `Actions` 권한 부족/이전 토큰 | Actions `Read and write`, Secret 갱신, Codespace 재시작 |
| Secret은 갱신됐지만 Action 없음 | workflow dispatch 실패 | 상단 재시도 또는 다음 30분 예약 실행 대기 |
| 과거 월 없음 | 월별 공개 데이터 미수집 | `backfill_from`으로 수동 백필 |
| Pages에 길드 번호 표시 | 오래된 Pages 배포/캐시 | 최신 Pages Action 확인 후 강력 새로고침 |
| Codespace가 이전 UI 표시 | 이전 checkout/Node 프로세스 | `git pull`, `pkill`, `npm start` |

진단 명령:

```bash
if [ -n "${GH_PAT_SYNC:-}" ]; then echo "GH_PAT_SYNC=set"; else echo "GH_PAT_SYNC=missing"; fi
echo "$GITHUB_REPOSITORY"
git rev-parse --short HEAD
curl -s http://localhost:3000/api/session | python -m json.tool
```

---

## 보안 및 비용

### 보안

- Codyssey 아이디/비밀번호는 Codespace/로컬 서버에서 Codyssey 인증 서버로만 전달
- GitHub에는 비밀번호가 아닌 `JSESSIONID`만 Actions Secret으로 저장
- Secret 업로드 전 libsodium sealed box로 암호화
- Pages 공개 데이터에서 다음 필드 제거:
  - 이메일
  - 내부 `mbrId`
  - 길드 ID
  - 로그인 사용자
  - GitHub 동기화 내부 상태
- `.session-cookies.json`은 `.gitignore` 대상
- PAT는 코드, 커밋, 채팅, 터미널 출력에 남기지 않음

### 비용

- 저장소가 Public이고 표준 `ubuntu-latest`를 사용하므로 Actions 실행시간은 무료
- 30분 수집은 현재 월만 처리
- 과거 월은 필요할 때만 수동 백필
- Codespace는 로그인/세션 갱신 후 Stop 권장
- 사용하지 않는 Codespace는 Delete하여 Storage 사용 방지

---

## 라이선스

현재 `dashboard/package.json` 기준 ISC 라이선스입니다.
