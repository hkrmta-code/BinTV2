# Bộ test Mock-E2E — BinTV-Fixed

Bộ kiểm chứng **luồng dữ liệu phát phim** và **tính nhất quán project** cho
bản fix 2026-09-12, chạy được trong sandbox KHÔNG có Swift toolchain /
thiết bị iOS (Node ≥ 18, Python ≥ 3.9 — không cần cài thêm gói nào).

```bash
cd tests/mock-e2e
node run_all.js          # chạy cả 4 suite; exit 0 = tất cả pass
```

## Các suite

| Suite | Nội dung | Điểm mạnh |
|---|---|---|
| **T1** `test_app_js_logic.js` | Chạy các hàm **CẮT NGUYÊN VĂN từ `app.js` thật** (brace-matching, không hard-code logic trong test) trong Node VM + stub DOM/XHR: `extractMovieTargetUrl`, `normalizeMovieManifestUrl`, `isValidMovieTargetUrl`, `getMovieBaseUrl`, `buildMovieResourceUrl`, `requestJson`, `fetchMovieStreamsShared`, khối lọc `validStreams` của `loadMovieStreams`, và **khối proxy-wrap thật** của `startMoviePlayback`. | Nếu `app.js` đổi, slice tự lấy bản mới. Verify đúng chuỗi Click Phim → API → parse → extract stream → wrap `/proxy?url=&__ref=`. |
| **T2** `test_m3u8_rewrite.js` | Test **bản port 1:1 sang JS** (`lib/swift_mirror.js`, mỗi hàm chú thích dòng Swift nguồn) của `rewriteM3u8Urls`/`proxifyM3u8Value`/`encodeQueryValue`/`originOf`/`baseUrlOf`/`rewriteUriAttrs`/`rewriteRedirectLocation`/`isM3u8*`: master+variant, `EXT-X-KEY`, `EXT-X-MAP`, relative/absolute children, chống double-proxy, lan truyền `__ref`, CRLF, encoding edge cases. | Thuật toán rewrite m3u8 (trái tim của proxy HLS) được phủ vector đầy đủ. |
| **T3** `test_proxy_chain_e2e.js` | **E2E HTTP live**: mock CDN (`lib/mock_cdn.js` — gate Referer như CDN thật, thiếu → 403; redirect 302 tuyệt đối; token-hết-hạn → playlist quảng cáo; MP4 + Range/206) + mirror proxy (`lib/mirror_proxy.js` — đúng header contract `PhimLocalServer.swift`: UA Chrome 126, Referer/Origin từ `__ref`, `Accept-Encoding: identity`, Range/If-Range forward, không follow redirect, bọc Location, rewrite m3u8, ACAO `*`, HEAD) + **app.js thật** điều khiển toàn chuỗi. Assert bytes segment/key/MP4 nguyên vẹn và **header tới được CDN** (log phía CDN). | Chứng minh data-flow vào player: URL cuối hợp lệ, playlist tree đi hết qua proxy, Referer chống 403 hoạt động, redirect không lộ upstream. |
| **T5** `test_nav_flow.py` | Mirror state-machine của `ContentView` (menu/Back/mountedTabs/tabHistory) + lifecycle WKWebView + delegate gesture: mở app menu ẩn; long-press & cạnh phải gọi menu; Back 7 nhịp đúng thứ tự; PHIM ↔ LIVE TV ↔ TUBE ×10 lượt không remount/không reload; khôi phục khi webview trống; các quyết định nhường gesture. | Phủ đúng checklist nghiệm thu: menu bar, Back cạnh trái, PHIM đen, không xung đột gesture. |
| **T4** `test_project_consistency.py` | Tĩnh: pbxproj ↔ đĩa (14 Swift trong Sources; `AppDelegate.swift` stub KHÔNG bị build; Web là folder trong Resources), Info.plist ↔ pbxproj (build 217, landscape-only iPhone+iPad, ATS local networking), **thứ tự fix** (`allowsInlineMediaPlayback = true` TRƯỚC `WKWebView(frame:configuration:)`), 3 lớp orientation, brace-balance mọi file Swift, `node --check` mọi JS asset + index.html refs, scheme UUID, workflow `build-ipa.yml`. | Chống lỗi "push lên GitHub Actions mới phát hiện". |

## Giới hạn trung thực (phải đọc)

1. **Không thay thế build thật**: sandbox không có Xcode/Swift. Các file
   Swift được kiểm tra TĨNH (balance, thứ tự API, nhất quán pbxproj/plist);
   hành vi runtime WKWebView/AVKit phải xác nhận trên thiết bị qua IPA từ
   GitHub Actions (build 217).
2. **T2/T3 dùng bản port JS của hàm Swift**: đối chiếu 1:1 từng dòng (chú
   thích số dòng trong `lib/swift_mirror.js`), nhưng khác biệt nền tảng
   hiếm (Foundation vs WHATWG URL: port mặc định tường minh `:80`, URL
   scheme-relative) đã được document trong test vector T2.2.
3. **Tầng DoH và RawHttp/ATS không mirror**: DoH là cơ chế phân giải DNS
   iOS-only (trực giao với luồng URL — URL vào/ra proxy không đổi); ATS là
   chính sách iOS (Node không có). Header/rewrite/redirect semantics giữ
   nguyên 100% trong mirror.
4. **JVHD không test được**: gate user JVHD cần `AndroidBridge.c0`
   (SHA-256(name+SALT)) chỉ có trong native lib Android → fail-closed trên
   iOS (xem BÁO CÁO, mục Giới hạn). Không phải regression của bản fix.
5. `playerObserverJS` (log media events trên thiết bị) được kiểm syntax
   bằng `node --check` (T4) — giá trị thật của nó là log `[PHIM_DEBUG]` khi
   chạy trên máy thật để đối chiếu chuỗi sự kiện `loadstart→canplay→playing`.

## Kết quả lần chạy cuối (sandbox, 2026-09-12 — sau Fix UI build 219)

- T1: **40/40 PASS** — chuỗi bootstrap→stream→wrap bằng hàm app.js thật.
- T2: **55/55 PASS** — thuật toán rewrite m3u8 (port Swift).
- T3: **53/53 PASS** — E2E live HTTP, header gate 403/Referer vượt qua,
  bytes nguyên vẹn, redirect bọc kín, Range/206, HEAD.
- T4: **190/190 PASS** — nhất quán project + T4.4b (regression guard lỗi
  CI `if let error = error`) + T4.8 viết lại cho build 219 (Fullscreen +
  Long-press Overlay Menu: khai tử sạch BrowserTabBar/NTP/BrowserTabs
  khỏi đĩa lẫn pbxproj, overlay blur icon-only, gesture plumbing nguyên
  văn, orientation/playback không bị đụng) + **T4.9 (Preflight CI gate:
  check xuôi/ngược disk↔Compile Sources, hướng sửa actionable, cấm
  `exit 0` che lỗi, scheme↔target khớp, canonical ghost-free) + 4
  assertion xbuild.log (Init trước Preflight, một log hợp nhất duy nhất,
  mọi step tee -a, artifact `xbuild-log` if: always()) + tombstone ci-skip
  cho 3 file khai tử (whitelist chặt T4.1 + mô phỏng trọn Preflight 2.1:
  missing = 0 trên canonical)**.
- T5: **71/71 PASS** — mirror state-machine luồng điều hướng build 221:
  menu ẩn mặc định/2 cách gọi/idempotent; Back 7 nhịp đúng thứ tự
  (menu → sheet → webview → tab trước đó → root NO-OP, không thoát
  app); **PHIM ↔ LIVE TV ↔ TUBE ×10 lượt: mount 1 lần, reload 0 lần**, webview luôn trong window; khôi phục khi webview trống (1 lần, tối đa
  3, dừng nếu server chưa có port/đang tải); delegate gesture nhường
  đúng vùng (webview/UIControl/menu/player).
- Tổng: **430/430 PASS** (T4.9 guard runner self-hosted; T4.10 guard menu
  ẩn + gesture build 221 + PHIM giữ trạng thái).
