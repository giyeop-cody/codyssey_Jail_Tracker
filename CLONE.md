# 이 레포를 clone/fork해서 쓰는 법

이 트래커는 특정 길드들(기본: 길드 3,4,5,6)의 SECOM(입퇴실) 기록을 모으는 대시보드다.
별도 인프라(로스터 허브·세션 동기화) **없이도** 단독으로 돌아간다.

## 1. fork/clone 후 해야 할 일

### (1) Repository Secret 등록 (필수)

| Secret | 값 |
|---|---|
| `CODYSSEY_SESSION` | `JSESSIONID=xxxx` 형태의 쿠키 문자열. usr.codyssey.kr 로그인 후 개발자도구 → Application → Cookies에서 복사 |

- 세션 만료 시 수집이 안내와 함께 실패한다. 새 값으로 교체할 것 (수동 갱신 모델)
- `HUB_PAT`은 **등록하지 않아도 된다** (비어 있으면 조용히 스킵됨 → 아래 폴 백 경로)

### (2) 대상 길드 변경 (자기 기수에 맞게)

- 길드 목록은 **`dashboard/lib/tracked-guilds.js`의 `TRACKED_GUILD_IDS`** 배열을 직접 수정
  (기본 `[3, 4, 5, 6]`)
- 시즌/주차는 env `GUILD_SEASON` / `GUILD_WEEK`로 지정 가능. 미지정 시 로스터 캐시에서
  유도하며, 기본 시즌/주차 값은 서버 코드의 `resolveSeasonWeek`를 따른다

### (3) GitHub Pages 활성화

Settings → Pages → Source를 **GitHub Actions**로 설정.
`Collect SECOM Data` 워크플로가 성공할 때마다 `Deploy to GitHub Pages`가 자동 실행된다.

## 2. 로스터(명부)는 어떻게 얻나 — 허브 없어도 됨

수집 시 명부는 아래 우선순위로 자동 선택된다:

```
로스터 허브(비공개, HUB_PAT 있을 때만)  →  actions/cache 로스터(8시간 이내)  →  길드 API 직접 조회
```

길드 API 갱신이 실패하면 **오래된 캐시라도 폴 백**해 수집을 이어간다 (서버 로그에
`[roster] ... 폴 백` 기록). 허브 없는 클로너는 추가 설정 없이 캐시→길드 API 경로를 쓴다.

## 3. 외부 워치독 (선택)

GitHub 스케줄러 정전 대비:
[giyeop-cody/codyssey_watchdog](https://github.com/giyeop-cody/codyssey_watchdog) 참고.

- `collect.yml`의 `repository_dispatch(external-collect)` 트리거는 이미 이 레포에 있음
- worker를 fork해 `OWNER`/`TARGETS`를 자기 레포로 바꾸고 `GH_TOKEN`에 자기 PAT 등록

## 4. 안 되는 것 / 주의

- **세션 자동 갱신 없음** — 만료 시 Secret을 직접 갱신해야 한다.
- 공개 빌드에서는 민감 필드(이메일, 내부 mbrId)가 제거되고 `_publicId`가 쓰인다.
- 원작자 레포의 데이터와 무관하게 **완전히 자기 대상만** 수집된다.
