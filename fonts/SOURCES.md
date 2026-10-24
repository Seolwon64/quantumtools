# fonts/ 의 출처

여기 있는 woff2 는 모두 IBM 의 공식 배포(github.com/IBM/plex 릴리스)에서 왔다. CDN 은 쓰지 않는다(design-spec "타이포그래피").
`test/fonts.test.mjs` 가 아래 표의 SHA-256 을 파일과 대조한다 — 파일을 바꾸면 표도 함께 고친다. 해시는 `.woff2` 에만 건다(텍스트 파일은
Git for Windows 의 줄바꿈 변환으로 새 clone 에서 해시가 달라진다).

## 릴리스

| 릴리스 태그 | 압축 파일 | 크기(B) | SHA-256 | GitHub 게시 digest |
|---|---|---|---|---|
| `@ibm/plex-sans-variable@0.2.0` (2025-06-25, 글꼴 버전 3.000) | `plex-sans-variable.zip` | 2,922,481 | `f83825d527be6cd39c8971c932b9bf22688a3ad3e5ac6305b6143d02f52b87b6` | 일치 |
| `@ibm/plex-mono-variable@1.0.0` (2026-07-30, 글꼴 버전 1.000) | `plex-mono-variable.zip` | 1,231,040 | `46bbde4aeab959180ebad197f5b841c6bb5c8070146ba02c31240556e1e0b40d` | 일치 |
| `@ibm/plex-math@1.1.0` (2024-11-13, 글꼴 버전 1.000) | `ibm-plex-math.zip` | 2,089,697 | `d85ed404394ced3a79a519af24611acdee9cc0483363c07cd5ac0656c06db42a` | 게시값 없음(크기만 일치) |

내려받은 주소: `https://github.com/IBM/plex/releases/download/<태그(@·/ 는 URL 인코딩)>/<압축 파일>`.

## 파일

IBM 파일은 **바이트를 고치지 않았다** — 압축 파일 안 이름의 공백만 빼서 저장했다. `qt-math.woff2` 만 직접 만든 파일이다.

| 파일 | 크기(B) | SHA-256 | 출처 |
|---|---|---|---|
| `IBMPlexSansVar-Roman-Latin1.woff2` | 68,988 | `a18d94ea83c93f0a465d0976d8bc8ecbb031225dbaf76fd201d4e724a972034f` | plex-sans-variable.zip `fonts/split/woff2/IBM Plex Sans Var-Roman-Latin1.woff2` |
| `IBMPlexSansVar-Roman-Greek.woff2` | 29,800 | `00744cd9c1ed63fe2a37fbc45707ce0b9bfa949315c6dd8cf1436301e0c3817d` | plex-sans-variable.zip `fonts/split/woff2/IBM Plex Sans Var-Roman-Greek.woff2` |
| `IBMPlexSansVar-Roman-Pi.woff2` | 23,900 | `0273a6b0411acbccb52b7d55af2bae2c58b35d68d6795a28c2f4db7ab21accbc` | plex-sans-variable.zip `fonts/split/woff2/IBM Plex Sans Var-Roman-Pi.woff2` |
| `IBMPlexMonoVar-Roman-Latin1.woff2` | 32,576 | `632cb6cee5e90d89bd4354ff362bcffcef1384c19b603ddd2830561716e1f440` | plex-mono-variable.zip `fonts/split/woff2/IBM Plex Mono Var-Roman-Latin1.woff2` |
| `IBMPlexMonoVar-Roman-Pi.woff2` | 22,488 | `0f4106b9f16d23589dde8426b326355e271002dc666ffcdca2b837258bc8662e` | plex-mono-variable.zip `fonts/split/woff2/IBM Plex Mono Var-Roman-Pi.woff2` |
| `qt-math.woff2` | 1,148 | `00b4fc52a4bba07ec5e63b3b86a19d961042ecca9c0a34be656635054b9ca276` | ibm-plex-math.zip `ibm-plex-math/fonts/complete/woff2/IBMPlexMath-Regular.woff2`(401,540 B, SHA-256 `5fc8851cc77b557289aaa90c06044ce113163fea386cd71109e2997c99ea8a8c`)에서 ⟨ ⟩ ⊕ ⋮ 넷을 잘라 이름을 "QT Math" 로 바꿨다. 만드는 법은 design-spec "타이포그래피" 의 재현 기록 |

`LICENSE-IBMPlex.txt` 는 plex-sans-variable.zip 의 `fonts/complete/woff2/license.txt` 다. plex-mono-variable.zip 의 같은 파일과 바이트가 같고,
ibm-plex-math.zip 의 `LICENSE.txt` 와는 줄바꿈만 다르다(저작권 줄과 예약 글꼴 이름 "Plex" 가 같다) — 세 폰트가 이 파일 하나로 덮인다.

넣지 않은 분할 면: Sans 의 Latin2·Latin3·Cyrillic, Mono 의 Latin2·Latin3·Cyrillic. 이유는 design-spec "타이포그래피".
