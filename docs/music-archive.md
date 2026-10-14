# 음악 아카이브 (`/music/`) 운영 가이드

YouTube Music 보관함에 저장한 앨범을 6시간마다 가져와 `https://cxbt.kr/music/` 에 LP 형태로 보여줍니다.
앨범 메타데이터는 자동으로, 개인 코멘터리와 대표 영상은 사람이 직접 관리합니다.

## 1. 구조

| 경로 | 내용 | 누가 수정하나 |
|---|---|---|
| `data/music/albums.json` | 보관함 앨범 메타데이터 | **동기화 스크립트만** (직접 수정 금지) |
| `content/music-notes/<albumId>.md` | 개인 코멘터리 (Markdown) | 사람 |
| `data/music/media.yaml` | 앨범별 대표 트랙 영상 | 사람 |
| `scripts/sync_ytmusic.py` | 동기화 스크립트 | — |
| `content/music/_content.gotmpl` | 앨범마다 `/music/<albumId>/` 페이지 생성 | — |
| `layouts/music/`, `layouts/partials/music/` | 음악 페이지 템플릿 | — |
| `assets/music/` | 음악 페이지 CSS/JS, 홈 음표(`entry.*`) | — |

세 데이터는 `albumId`(YouTube Music browseId, 예: `MPREb_…`) 하나로만 연결됩니다.
동기화 스크립트는 `data/music/albums.json` 외의 파일을 읽거나 쓰지 않으므로 코멘터리와 영상 매핑은 절대 덮어써지지 않습니다.

## 2. 최초 인증 설정 (한 번만)

`ytmusicapi` 는 비공식 라이브러리입니다. 인증 방식은 두 가지이며 **OAuth 를 먼저 시도하고, HTTP 400 오류가 나면 브라우저 방식**을 쓰세요.
(2024년 말부터 일부 계정에서 OAuth 요청이 `HTTP 400 INVALID_ARGUMENT` 로 거부되는 사례가 보고되어 있습니다.)

### A. OAuth (권장: 토큰이 자동 갱신됨)

1. [Google Cloud Console](https://console.cloud.google.com/) 에서 새 프로젝트를 만듭니다.
2. **API 및 서비스 → 라이브러리** 에서 *YouTube Data API v3* 를 사용 설정합니다.
3. **OAuth 동의 화면**: 사용자 유형 *외부*, 앱 이름 아무거나, 본인 이메일을 테스트 사용자로 추가합니다.
   - **게시 상태를 "프로덕션"으로 전환하세요.** "테스트" 상태에서는 Refresh Token 이 7일 뒤 만료되어 동기화가 멈춥니다.
     (검증 안 된 앱 경고가 뜨지만 본인만 쓰므로 괜찮습니다.)
4. **사용자 인증 정보 → OAuth 클라이언트 ID 만들기**, 유형은 **TV 및 제한된 입력 기기** 를 고릅니다. 클라이언트 ID 와 보안 비밀을 메모합니다.
5. 내 컴퓨터에서 토큰을 만듭니다 (저장소 폴더 **밖**에서 실행하는 것을 권장).
   ```bash
   pip install ytmusicapi==1.12.3
   ytmusicapi oauth --client-id "<클라이언트 ID>" --client-secret "<보안 비밀>" --file oauth.json
   ```
   안내되는 주소에서 YouTube Music 계정으로 로그인해 코드를 승인하면 `oauth.json` 이 만들어집니다.
6. 작동 확인 (아무것도 쓰지 않는 dry-run):
   ```bash
   export YTMUSIC_AUTH="$(cat oauth.json)" YTMUSIC_OAUTH_CLIENT_ID="<ID>" YTMUSIC_OAUTH_CLIENT_SECRET="<비밀>"
   python scripts/sync_ytmusic.py --dry-run
   ```
   `INFO library: N albums fetched …` 가 나오면 성공입니다.

### B. 브라우저 헤더 (OAuth 가 HTTP 400 으로 실패할 때)

1. 브라우저에서 `https://music.youtube.com` 에 로그인한 상태로 개발자 도구(F12) → **Network** 탭을 엽니다.
2. 보관함을 열거나 스크롤해서 `browse` 로 시작하는 **POST** 요청을 찾고, 요청 헤더 전체를 복사합니다.
3. ```bash
   ytmusicapi browser --file browser.json
   ```
   를 실행하고 복사한 헤더를 붙여 넣습니다.
4. 이 방식은 브라우저 로그인 쿠키를 쓰므로 **그 브라우저에서 로그아웃하면 만료**됩니다. 동기화 전용 브라우저 프로필을 쓰고 로그아웃하지 마세요.
5. 확인: `export YTMUSIC_AUTH="$(cat browser.json)"; python scripts/sync_ytmusic.py --dry-run`

### GitHub Secrets 등록

저장소 **Settings → Secrets and variables → Actions → New repository secret**:

| 이름 | 값 | 필요한 경우 |
|---|---|---|
| `YTMUSIC_AUTH` | `oauth.json` 또는 `browser.json` 파일 내용 전체 | 항상 |
| `YTMUSIC_OAUTH_CLIENT_ID` | OAuth 클라이언트 ID | OAuth 일 때 |
| `YTMUSIC_OAUTH_CLIENT_SECRET` | OAuth 보안 비밀 | OAuth 일 때 |

등록한 뒤에는 내 컴퓨터의 `oauth.json` / `browser.json` 을 지우세요. (`.gitignore` 에 들어 있지만 저장소에 두지 않는 편이 안전합니다.)
등록 후 **Actions → Deploy (cxbt.kr) → Run workflow** 로 첫 동기화를 바로 실행할 수 있습니다.

## 3. 자동 동기화

- `.github/workflows/deploy.yml` 이 **6시간마다(UTC 00:07, 06:07, 12:07, 18:07)** 실행됩니다. GitHub 사정으로 늦게 시작될 수 있습니다.
- 흐름: 보관함 조회 → 변경이 있을 때만 `albums.json` 커밋 → 같은 실행 안에서 Hugo 빌드·Pages 배포.
  변경이 없으면 커밋도 배포도 하지 않습니다.
- `main` 에 직접 push 하면(코멘터리 수정 등) 동기화 없이 바로 빌드·배포됩니다.
- 수동 실행: **Actions → Deploy (cxbt.kr) → Run workflow**.

### 안전장치

| 상황 | 동작 |
|---|---|
| 새 앨범 저장 | 추가, `firstSeenAt` 기록 (이 사이트가 처음 본 시각, YouTube Music 저장일과는 다름) |
| 보관함에서 삭제 | 지우지 않고 `inLibrary: false` + `removedAt` 기록. 목록에서 빠지지만 페이지와 코멘터리는 유지 |
| 다시 저장 | `inLibrary: true` 로 복귀, `firstSeenAt` 유지 |
| 같은 앨범 중복 | 하나로 합침 |
| 제목·커버 변경 | 반영 |
| 조회 결과 0개 | **거부** (exit 4), 기존 데이터 유지 |
| 한 번에 20% 넘게(최소 6개) 사라짐 | **거부** (exit 4). 실제 정리였다면 Run workflow 에서 *allow_mass_removal* 체크 후 실행 |
| 응답 형식 변경 | 거부 (exit 3), 기존 데이터 유지 |
| 인증 실패·만료 | 거부 (exit 2), 기존 데이터 유지 |

동기화가 실패하면 배포하지 않으므로 운영 사이트는 마지막 정상 상태를 그대로 보여줍니다. 실패한 실행은 GitHub 이 이메일로 알려줍니다.

## 4. 문제가 생겼을 때

| 증상 (Actions 로그) | 조치 |
|---|---|
| `[config] YTMUSIC_AUTH is not set` / `Music sync skipped` 경고 | Secrets 등록 |
| `[auth] … not signed in` | 쿠키·토큰이 로그아웃 상태. 다시 만들어 `YTMUSIC_AUTH` 덮어쓰기 |
| `… with text/html … instead of JSON` | 응답이 JSON 이 아님. `python scripts/sync_ytmusic.py --inspect-auth` 로 헤더 이름·길이(값은 출력 안 함)를 확인 |
| `[auth] … HTTP 400/401/403` | 토큰·쿠키 만료. 2장 절차로 다시 만들어 `YTMUSIC_AUTH` 덮어쓰기. OAuth 가 계속 400 이면 B 방식으로 전환 |
| `[api-format] …` | YouTube Music 응답이 바뀜. `scripts/requirements.txt` 의 `ytmusicapi` 버전을 최신으로 올려 보기 |
| `[guard] …` | 보관함을 실제로 크게 정리했다면 allow_mass_removal 로 수동 실행, 아니면 다음 실행 대기 |
| 예약 실행이 멈춤 | 저장소에 60일간 활동이 없으면 GitHub 이 예약 워크플로를 끕니다. **Actions → Deploy → Enable workflow** |

**배포 롤백**: 문제가 된 커밋을 `git revert` 해서 `main` 에 push 하면 이전 상태로 다시 배포됩니다.
`albums.json` 만 되돌리려면 `git checkout <이전커밋> -- data/music/albums.json` 후 커밋·push.

## 5. 코멘터리 쓰기

`content/music-notes/<albumId>.md` 파일을 만들거나 GitHub 웹에서 편집해 커밋하면 몇 분 안에 반영됩니다.
`albumId` 는 `data/music/albums.json` 이나 앨범 페이지 주소(`/music/mpreb_…/`, 소문자로 바뀜)에서 확인합니다. 파일 안의 `album` 값은 **원래 대소문자 그대로** 적어야 합니다.

```toml
+++
album = "MPREb_xxxxxxxxxxx"
date = 2026-10-15          # 작성일
lastmod = 2026-10-20       # 수정일 (선택). 화면에는 수정일(없으면 작성일)이 표시됩니다
labels = ["야간운전"]       # 감상 태그 (선택)
+++

본문은 Markdown 입니다. **강조**, *기울임*, [링크](https://…), 빈 줄로 문단 나누기, > 인용, - 목록.
```

코멘터리가 없는 앨범은 제목·아티스트·연도만 표시됩니다.

## 6. 대표 트랙 영상 지정

`data/music/media.yaml` 에 추가합니다.

```yaml
MPREb_xxxxxxxxxxx:
  videoId: AbCdEfGhIjK   # youtube.com/watch?v=<여기>
  track: 곡 제목          # 선택
  start: 35              # 선택: 시작 초
  end: 55                # 선택: 끝 초 (구간 미리듣기)
```

- **공식 아티스트·레이블·음악 유통 채널의 영상**을 고르세요. YouTube 에 공개돼 있다는 것만으로 재이용이 허락된 것은 아닙니다.
- `albumId` 는 영상 ID 가 아닙니다. 지정하지 않은 앨범은 LP 를 눌러도 플레이어가 열리지 않고 YouTube Music 링크가 나옵니다.
- 영상 소유자가 외부 재생을 막은 경우(오류 101/150) 사이트가 우회하지 않고 "YouTube 에서 열기" 링크로 대체합니다.

## 7. 저작권·정책 메모

- 음원은 저장·배포하지 않습니다. 재생은 공식 YouTube IFrame Player(`youtube-nocookie.com`)로만, 자동재생 없이, 플레이어를 가리지 않고 최소 200×200 이상 크기로 표시합니다.
  플레이어를 닫으면 영상을 멈추고 iframe 을 제거합니다. 플레이어 하단에 원본 YouTube 링크가 있습니다.
- 구간 재생(start/end)도 저작권 이용 허락을 대신하지 않습니다. 감상·비평 목적의 개인 사이트라는 점이 면책 근거가 되지는 않습니다.
- 앨범 커버는 YouTube Music 이 제공하는 썸네일 주소(`lh3.googleusercontent.com`)를 그대로 불러옵니다(저장소에 복사하지 않음).
  커버도 저작물이므로, 권리자 요청이 있으면 해당 앨범을 보관함에서 지우거나 `thumbnailUrl` 을 쓰지 않도록 템플릿을 바꾸면 됩니다.
- `ytmusicapi` 는 비공식 API 입니다. YouTube Music 변경으로 언제든 동기화가 멈출 수 있으며, 그때도 사이트는 마지막 데이터로 계속 동작합니다.

## 8. 로컬에서 확인

```bash
pip install -r scripts/requirements.txt
python -m unittest scripts/test_sync_ytmusic.py
hugo server   # Hugo extended 0.126 이상 (CI 는 0.167.0 고정)
```
