+++
title = "music notes"
# 개인 코멘터리 저장소. 이 폴더의 파일은 직접 렌더링되지 않고 /music/ 페이지 안에 표시됩니다.
[build]
  render = "never"
  list = "never"
[cascade.build]
  render = "never"
  list = "local"
+++

앨범 하나당 파일 하나: `content/music-notes/<albumId>.md`

```toml
+++
album = "MPREb_xxxxxxxxxxx"   # data/music/albums.json 의 albumId (필수)
date = 2026-10-15             # 작성일
lastmod = 2026-10-20          # 수정일 (선택, 없으면 작성일)
labels = ["야간운전", "드림팝"]  # 감상 태그 (선택)
+++

여기에 Markdown 으로 자유롭게 씁니다. **강조**, *기울임*, [링크](https://example.com), 문단 나누기 모두 됩니다.
```

동기화 스크립트는 이 폴더를 읽지도 쓰지도 않습니다. 보관함에서 앨범을 지워도 이 파일은 그대로 남습니다.
