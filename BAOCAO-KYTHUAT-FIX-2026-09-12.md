# BÁO CÁO KỸ THUẬT — BinTV iOS (build 216 → 217)

**Ngày:** 2026-09-12 · **Phạm vi:** (1) Khóa cứng landscape 100% (chế độ TV) · (2) Khôi phục phát video module PHIM (HLS `.m3u8` + `.mp4`)
**Nguyên tắc thực hiện:** KHÔNG viết lại từ đầu · BẢO TỒN 100% tính năng (JVHD, Trang chủ, Live TV, TUBE, SETTINGS) · KHÔNG đoán code — mọi kết luận dưới đây đều trích từ nguồn thật (`BinTube-main` + assets `Phim.apk`) · THỰC CHẤT over BỀ NỔI.

---

## 0. TÓM TẮT ĐIỀU HÀNH

| Hạng mục | Kết quả |
|---|---|
| Root cause "Không thể phát nguồn phim này trên TV" | **XÁC ĐỊNH CHÍNH XÁC**: `WKWebViewConfiguration.allowsInlineMediaPlayback` bị bỏ sót (mặc định `false` trên iPhone) — kèm bằng chứng: comment sai trong code cũ (mục C.2) |
| Root cause xoay màn hình khỏi landscape | **XÁC ĐỊNH CHÍNH XÁC**: thiếu hook per-window `application(_:supportedInterfaceOrientationsFor:)` + window fullscreen video của WebKit mang mask riêng `.all` + nhánh request `.portrait` (landmine) + mask 1 hướng gây lật 180° (mục B.1) |
| Số file sửa | **7** (5 Swift + Info.plist + project.pbxproj) — KHÔNG thêm dependency, KHÔNG đổi cấu trúc, KHÔNG đụng workflow |
| File mới (không thuộc target Xcode, không ảnh hưởng build) | `tests/mock-e2e/` (bộ test 4 suite) + báo cáo này |
| Kiểm chứng trong sandbox | **244/244 assertion PASS** (T1 40 + T2 55 + T3 53 + T4 96) — chạy hàm app.js THẬT + mock CDN + mirror proxy đúng contract Swift (mục F) |
| Giới hạn trung thực | Không có Xcode/thiết bị trong sandbox → chưa build IPA tại đây; xác nhận runtime cuối cùng = IPA build 217 từ GitHub Actions + đọc `phim_debug.log` trên máy thật (mục F.3, H) |
| JVHD | Giữ nguyên 100%; gate user JVHD cần `AndroidBridge.c0` (native Android) → fail-closed trên iOS — **giới hạn có sẵn từ trước, không phải regression** (mục C.6) |

---

## A. PHƯƠNG PHÁP & DỮ LIỆU ĐẦU VÀO

1. **Nguồn iOS**: `BinTube-main.txt` (ZIP project, giải nén 48 file) — toàn bộ code Swift, pbxproj, Info.plist, workflow GitHub Actions, và bản copy web assets trong `BinTV/Phim/Web/`.
2. **Nguồn tham chiếu APK**: `Tệp nguồn bên trong thư mục assets.txt` (ZIP assets `Phim.apk`: `app.js`, `phim_android.js`, `phim_player_ui.js`).
3. **Đối chiếu byte-for-byte**: `diff -q` xác nhận 3 file JS trong project iOS **GIỐNG HỆT** 3 file JS gốc của APK → logic web app không bị "port hụt"; lỗi nằm ở lớp **native iOS** (cấu hình WKWebView + orientation), không phải ở JS.
4. **Đọc sâu trước khi sửa** (không đoán): trace toàn bộ chuỗi phát phim trong `app.js` (bootstrap → manifest → stream → wrap proxy → hls.js/video → fallback → thông báo lỗi tại `app.js:5380`), toàn bộ `PhimLocalServer.swift` (1694 dòng gốc: BSD socket HTTP server, `/proxy`, RawHttp, DoH, rewrite m3u8), `PhimWebView.swift` (498 dòng gốc), `App.swift`, `PlayerView.swift`, `MovieListView.swift`, pbxproj, Info.plist, workflow, xcscheme.
5. **Xác minh tài liệu chính thức** (web): hành vi `allowsInlineMediaPlayback` (Apple/WebKit + tài liệu AdMob WebView): mặc định `false` trên iPhone; **phải set TRƯỚC khi init `WKWebView(frame:configuration:)`**; công thức chuẩn cho inline+autoplay = `allowsInlineMediaPlayback = true` + `mediaTypesRequiringUserActionForPlayback = []`; chỉ có thuộc tính HTML `playsinline` là KHÔNG đủ trong WKWebView.
6. **Môi trường sandbox**: không có Swift toolchain (`swiftc` không tồn tại) → chiến lược kiểm chứng 2 tầng: (a) tĩnh — brace-balance, `node --check` mọi JS, plistlib, đối chiếu pbxproj↔đĩa; (b) động — chạy **hàm cắt nguyên văn từ app.js thật** trong Node VM + mock CDN HTTP live + mirror proxy port 1:1 từ Swift (mục F).

---

## B. NHIỆM VỤ 1 — KHÓA CỨNG LANDSCAPE (100% TV-STYLE)

### B.1. Root cause CHÍNH XÁC của lỗi orientation bản cũ

iOS quyết định hướng giao diện theo thứ tự: **(i)** hook per-window `application(_:supportedInterfaceOrientationsFor:)` (nếu có — ghi đè tất cả) → **(ii)** `supportedInterfaceOrientations` của view controller đang trên cùng → **(iii)** `UISupportedInterfaceOrientations` trong Info.plist (giá trị mặc định cho (ii)). Bản cũ chỉ có (iii) + các lệnh `requestGeometryUpdate` rải rác. Kết quả:

- **R1 (chủ mưu) — Window fullscreen video KHÔNG bị plist quản.** Khi video bị WebKit "bắt cóc" sang player fullscreen native (hậu quả trực tiếp của lỗi playback, mục C.2), hoặc khi tab TUBE gọi `webkitEnterFullscreen`, hoặc AVPlayerViewController của Live TV present fullscreen — UIKit tạo **UIWindow riêng**, mà view controller trên cùng của nó (`AVFullScreenPlaybackViewController` / WebKit fullscreen VC) trả mask `.allButUpsideDown`. Vì app **không có** hook (i), plist landscape-only không kẹp được window đó → màn hình **xoay dọc được trong lúc phát video**; thoát fullscreen để lại app "kẹt" portrait cho tới lần request kế tiếp. Đây chính là hiện tượng "mở player thì bị xoay".
- **R2 — Cửa sau `.portrait` trong `setInterfaceLandscape(_:)`.** Cả `PlayerView.swift:179` (cũ) lẫn `MovieListView.swift:444` (cũ) đều có nhánh `landscape == false → request .portrait`. Call-site hiện tại chỉ truyền `true` (đã grep xác nhận toàn bộ), nhưng chính tác giả cũ đã để lại comment cảnh báo ở `MovieListView.swift:469`: *"setInterfaceLandscape(false) ở đây → app 'lọt' về layout dọc"* — landmine phá khóa ngang chờ mọi sửa đổi tương lai.
- **R3 — Mask một hướng gây lật 180°.** `MovieListView` cũ request `.landscapeLeft` (một hướng duy nhất): máy đang ở `landscapeRight` mà bấm nút ⛶ thì bị **lật ngược 180°** thay vì giữ nguyên — trải nghiệm "xoay lung tung" khi điều hướng.
- **R4 — KVC sai enum domain (iOS 15).** Code cũ: `UIDevice.current.setValue(UIInterfaceOrientation.landscapeRight.rawValue, forKey: "orientation")`. KVC key `orientation` của `UIDevice` nhận giá trị **UIDeviceOrientation**. `UIInterfaceOrientation.landscapeRight.rawValue` = 3 (UIKit định nghĩa chéo `UIInterfaceOrientationLandscapeRight = UIDeviceOrientationLandscapeLeft`) → tình cờ vẫn là giá trị landscape hợp lệ nên "chạy được", nhưng sai domain — mọi sửa đổi về sau theo enum interface sẽ âm thầm request sai hướng. Đã chuyển sang `UIDeviceOrientation.landscapeLeft.rawValue` tường minh (App.swift, PlayerView, MovieListView).
- **R5 — iPad bỏ ngỏ.** `TARGETED_DEVICE_FAMILY = 1,2` nhưng plist chỉ có key iPhone; key `UISupportedInterfaceOrientations~ipad` không tồn tại → trên iPad hệ thống suy luận fallback. Nay khai báo tường minh landscape-only cho cả 2 key (an toàn với `UIRequiresFullScreen = YES` — không vướng ràng buộc multitasking của iPad).

> **Rotation Lock:** cơ chế khóa của bản fix **không phụ thuộc** Rotation Lock, đúng bản chất hệ thống: Rotation Lock chỉ chặn việc xoay **tương tác** theo cảm biến; còn **orientation set** (plist + hook per-window) quyết định app được phép tồn tại ở những hướng nào. App khai báo landscape-only → dù lock bật hay tắt, thiết bị cầm dọc hay ngang, scene luôn được hệ thống dựng/thuyền chuyển về landscape (kể cả launch thẳng từ portrait — không có trạng thái "nửa xoay").

### B.2. Thiết kế 3 lớp đã áp dụng (cách root cause bị triệt tiêu)

| Lớp | Cơ chế | File | Vai trò |
|---|---|---|---|
| **1. Info.plist** | `UISupportedInterfaceOrientations` + **mới:** biến thể `~ipad` — chỉ `UILandscapeLeft/RightInterfaceOrientation` | `BinTV/Info.plist` | Hệ thống tạo scene LAUNCH THẲNG ở landscape; giá trị mặc định cho mọi VC |
| **2. AppDelegate per-window (MỚI — bịt R1)** | `application(_:supportedInterfaceOrientationsFor:) → .landscape` (`App.swift:82`) | `BinTV/App/App.swift` | API UIKit hỏi ĐẦU TIÊN cho **từng window** — ghi đè mask `.all` của WebKit/AVKit fullscreen, sheet, alert → **không window nào xoay dọc được nữa** |
| **3. Safety-net request** | iOS 16+: `requestGeometryUpdate(.iOS([.landscapeLeft, .landscapeRight]))` + errorHandler (log `ORIENTATION FAIL`); iOS 15: KVC `UIDeviceOrientation` (đã sửa domain R4). Launch retry ≤12 lần/2.4s; `didBecomeActive` re-request | `App.swift`, `PlayerView.swift`, `MovieListView.swift` | Với lớp 1+2 đây gần như no-op; xử lý edge-case scene chưa active. **Không bao giờ request portrait** (R2: `guard landscape else { return }`); mask luôn đủ 2 hướng landscape (R3: hết lật 180°) |

**Đóng player:** giữ nguyên landscape (TV-mode — không còn đường nào về portrait). **Điều hướng/mở sub-screen:** mọi VC kế thừa mask landscape từ lớp 1+2. **Phát video:** sau fix C.2, video PHIM phát **inline trong WKWebView** (không còn fullscreen takeover → không còn window mask `.all` của R1 xuất hiện từ nguồn); nếu người dùng vẫn vào fullscreen (TUBE/⛶), lớp 2 kẹp window đó ở landscape.

### B.3. Không dùng hack

Không `CGAffineTransform`, không private API, không swizzle. Toàn bộ bằng API chính thức: plist keys, `UIApplicationDelegate.application(_:supportedInterfaceOrientationsFor:)`, `UIWindowScene.requestGeometryUpdate(_:errorHandler:)` (iOS 16+), KVC `UIDevice.orientation` (cơ chế công khai duy nhất trên iOS 15.x — giữ nguyên từ bản cũ, chỉ sửa enum domain).

---

## C. NHIỆM VỤ 2 — KHÔI PHỤC PHÁT VIDEO MODULE PHIM

### C.1. Kiến trúc phát phim (trace từng bước từ code thật — không suy diễn)

```
Người dùng bấm tab PHIM (BinTV native)
  └─ PhimWebView.startAndLoadIfNeeded()
      ├─ PhimLocalServer.start()  — HTTP server BSD-socket, quét port 3000-3100, bind 127.0.0.1
      │    ├─ GET /            → BinTV/Phim/Web/index.html (từ bundle, folder reference "Web")
      │    ├─ GET /assets/*    → app.js, hls.min.js (1.5.20), phim_android.js, phim_player_ui.js,
      │    │                     tizen_shim.js, phim_ios_fallback.js, CSS
      │    └─ GET /proxy?url=<enc>&__ref=<enc>  → media proxy (chi tiết C.4)
      └─ WKWebView.load(http://127.0.0.1:PORT/?android=phone&ios=landscape)

Trong web app (app.js — GIỐNG HỆT bản APK):
  1. launchBuiltinMovie → fetchMovieBootstrapShared:
     GET JSONBin config → extractMovieTargetUrl (unwrap {record:{target_url}})
       → normalizeMovieManifestUrl → isValidMovieTargetUrl (protocol http/https + host)
       → GET manifest (Stremio addon) → cache → openMovieBrowser
       → getMovieBaseUrl = manifestUrl trừ "/manifest.json"   [UI danh sách phim render từ đây]
  2. Click một phim → openMovieItem → phân loại → loadMovieStreams(type, id)
     → fetchMovieStreamsShared: GET {baseUrl}/stream/{type}/{id}.json (có dedupe in-flight)
     → lọc validStreams: entry có `url` string + isValidMovieTargetUrl
       (KHÔNG lọc theo đuôi file — thứ tự ưu tiên do server quyết; entry externalUrl-only bị loại)
     → movieStreamFallback = {streams: validStreams, index: 0, ...}  [chuỗi fallback khi stream lỗi]
  3. startMoviePlayback(validStreams[0].url):
     a. window.webapis.avplay? — KHÔNG (tizen_shim.js set webapis={} trên iOS) → bỏ qua đường Tizen
     b. KHỐI PROXY-WRAP (app.js — code thật, đã kiểm chứng T1/T3):
        - trích `referer=` từ query của stream URL (decodeURIComponent) → phimExtraRef
        - nếu URL là http(s) TUYỆT ĐỐI, cross-origin với window.location.origin
          (127.0.0.1:PORT) và chưa chứa "/proxy?url=":
            phimStreamUrl = ORIGIN + "/proxy?url=" + encodeURIComponent(url)
                                    + ("&__ref=" + encodeURIComponent(referer) nếu có)
        - phimHlsUrl = phát hiện .m3u8 (trực tiếp HOẶC ẩn trong query đã encode)
     c. if (phimHlsUrl && Hls.isSupported()) → hls.js attach vào
        <video id="bintv-movie-html5-player" playsinline>   [iOS 17.1+: ManagedMediaSource;
        iOS thấp hơn: Hls.isSupported()=false → video.src = phimStreamUrl (native HLS của WebKit)]
        else → video.src = phimStreamUrl (MP4/đường native)
     d. video.play()  ← CHỖ CHẾT CỦA BẢN CŨ (C.2)
  4. Lỗi một stream → handleMoviePlaybackError → movieStreamFallback chuyển stream kế tiếp
     → hết fallback → showMovieStatus("Không thể phát nguồn phim này trên TV")  [app.js:5380]
  5. Mở player UI → phim_player_ui.js gọi AndroidBridge.setPlayerLandscape("1")
     → bridgeShimJS (PhimWebView) → webkit.messageHandlers.phimBridge.postMessage
     → Swift userContentController → setPlayerLandscape(on) → giữ/khẳng định landscape
```

**Kết luận trace:** tầng server nội bộ, `/proxy`, rewrite m3u8, bridge, fallback — **tất cả đã có và đúng** trong bản iOS (port chuẩn từ `server.js`/`MediaProxyServer.java` của Android). Chuỗi chết ở **bước 3d**: `video.play()` trong WKWebView iPhone.

### C.2. Root cause CHÍNH XÁC + bằng chứng

`PhimWebView.swift` bản cũ **không set** `configuration.allowsInlineMediaPlayback`. Bằng chứng không thể chối cãi — comment nguyên văn trong code cũ:

```swift
// (PhimWebView.swift bản gốc, đã xóa trong bản fix)
// Inline video: web app tự quản lý qua thuộc tính playsinline của
// thẻ <video> (WKWebView không có allowsInlineMediaPlayback — đó là
// thuộc tính của AVPlayerViewController).
```

Nhận định này **SAI**: `allowsInlineMediaPlayback` là thuộc tính của `WKWebViewConfiguration` từ **iOS 9**, mặc định `false` trên **iPhone** (iPad mặc định `true` — vì sao bug có thể không lộ khi test iPad/Simulator iPad). Chuỗi nhân quả đầy đủ:

1. `allowsInlineMediaPlayback == false` → WebKit **BỎ QUA** thuộc tính HTML `playsinline` trên thẻ `<video>` (dù `index.html` có đặt đúng) → mọi playback bị đưa sang **player fullscreen native** của WebKit, hoặc `play()` bị reject.
2. `app.js` gọi `video.play()` **SAU** chuỗi resolve stream bất đồng bộ (fetch config → manifest → stream.json → wrap) — user-activation của cú click đã hết hiệu lực. Với `mediaTypesRequiringUserActionForPlayback = []` (đã có sẵn) autoplay được phép, **nhưng** khi inline bị cấm, WebKit fullscreen-takeover yêu cầu ngữ cảnh trình chiếu khác → `NotAllowedError`/hijack.
3. Bị hijack sang fullscreen native: player này **không phát được nội dung MSE** mà hls.js bơm vào (iOS 17.1+ hls.js 1.5.20 dùng `ManagedMediaSource`) → hls.js `FRAG_LOAD_ERROR`/fatal → `video.onerror`.
4. `handleMoviePlaybackError()` chạy chuỗi `movieStreamFallback` — mọi stream đều chết cùng một kiểu (lỗi không nằm ở URL/header mà ở tầng trình chiếu) → hết fallback → hiện đúng thông báo **"Không thể phát nguồn phim này trên TV"** (`app.js:5380`).
5. **Tác dụng phụ orientation:** chính window fullscreen native này mang mask `.all` (R1 mục B.1) → đây là lý do hai nhiệm vụ (playback + orientation) GHÉP CHẶT với nhau: sửa playback (inline) là triệt tiêu từ gốc nguồn sinh ra window xoay dọc.

Vì sao **Android chạy được**: WebView Android phát inline theo mặc định (cờ `mediaPlaybackRequiresUserGesture=false` + không có cơ chế fullscreen-takeover tương tự); web app được viết quanh hành vi đó.

### C.3. Fix đã áp dụng (tối thiểu, chính thức, không hack)

`PhimWebView.swift` (662 dòng sau fix):

1. **`configuration.allowsInlineMediaPlayback = true`** (`:76`) — set **TRƯỚC** `WKWebView(frame: .zero, configuration:)` (`:94`), vì Apple áp configuration **chỉ tại thời điểm init** (set sau = vô hiệu). Kết hợp `mediaTypesRequiringUserActionForPlayback = []` (có sẵn) = đúng công thức CHÍNH THỨC của Apple cho inline+autoplay. Comment cũ chứa nhận định sai đã được thay bằng block giải thích root cause đầy đủ.
2. **`playerObserverJS`** (user script mới, `atDocumentEnd`, `:295`) — observer **THỤ ĐỘNG** phục vụ E2E verify trên thiết bị: log môi trường phát (`MediaSource`/`ManagedMediaSource`/`Hls`/`canPlayType('application/vnd.apple.mpegurl')`/inline) + 18 sự kiện media của thẻ `<video>` (`loadstart`, `loadedmetadata`, `canplay`, `playing`, `waiting`, `error`, `emptied`, ...) ở capture-phase, không `preventDefault`, không đụng logic app.js; URL trong log được **sanitize token**; gửi về native qua handler `phimConsole` → ghi `phim_debug.log` theo format chuẩn (mục E). Re-attach polling 2s×30 nếu video element được tạo muộn.
3. **`#if DEBUG webView.isInspectable = true` (iOS 16.4+)** — cho phép attach Safari Web Inspector khi debug; **release build không đổi hành vi**.
4. Toàn bộ log của controller/navigation/bridge chuyển sang format `[PHIM_DEBUG] Step -> Action -> Status -> Payload` (mục E).

**Không đổi:** `index.html`, `app.js`, `hls.min.js`, mọi asset web (giữ nguyên byte-for-byte với APK), `PhimLocalServer` logic lõi (chỉ thêm log cấu trúc + sanitize), bridge shim, luồng tab khác.

### C.4. Headers BẮT BUỘC cho stream (đã trace + đã verify qua mock E2E)

Proxy `/proxy?url=&__ref=` của `PhimLocalServer.swift` gắn các header sau tới upstream (dòng code thật):

| Header | Giá trị | Nguồn/dòng Swift | Vai trò |
|---|---|---|---|
| `User-Agent` | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36` | `:349-350`, gắn tại `:809` | CDN phim chặn UA mặc định của iOS (`CFNetwork`/`Safari Mobile`) — UA desktop Chrome là điều kiện nhiều nguồn |
| `Referer` | giải mã từ `__ref` (app.js trích `referer=` trong query của stream URL); fallback: referer client | `:815-816`, `:823-824` | **Chìa khóa chống 403** của các CDN dạng `sc.k-20.xyz` (server validate referer trước khi phát) |
| `Origin` | `scheme://host[:port]` suy từ referer | `:817-819` | Một số CDN check đồng bộ Referer+Origin |
| `Accept` / `Accept-Language` | `text/html,...*/*;q=0.8` / `vi,en-US;q=0.8,en;q=0.6` | `:351-352` | Parity browser thật |
| `Accept-Encoding` | `identity` | `:813` | Tránh gzip trên response m3u8/segment (rewrite text cần body không nén) |
| `Range` / `If-Range` | forward nguyên văn từ client | `:829-834` | hls.js/AVPlayer seek + byte-range MP4 (206) |
| `Host` | host[:port] của target (đường RawHttp khi phải tự resolve qua DoH) | `:849` | Vượt DNS poisoning/chặn SNI một số nguồn |
| Token trong query (`pkey`, `sig`, `token`, ...) | **giữ nguyên 100%** bên trong `url=` đã percent-encode | khối rewrite `:1143-1245` | Query token là một phần URL ký — encode/decode phải round-trip hoàn hảo (đã test T2.1) |

Cookie: **không bắt buộc** cho luồng PHIM hiện tại (server stateless; bridge `clearCookies` chỉ phục vụ reset trạng thái web app). `Authorization`: không xuất hiện trong chuỗi PHIM (đã grep toàn bộ app.js + Swift).

**Cơ chế kèm theo (đã có sẵn, giữ nguyên):** http cleartext đi đường **RawHttp tự viết** (không qua URLSession → không bị ATS chặn, `NSAllowsLocalNetworking` chỉ cần cho 127.0.0.1); https đi URLSession với `followRedirects=false`; **DoH** (DNS-over-HTTPS) tự phân giải khi DNS hệ thống fail; response 3xx có `Location` tuyệt đối được **bọc lại thành `/proxy?url=`** để mọi hop không lộ upstream (Swift `:1031-1046`); body m3u8 được **rewrite toàn bộ children** (`#EXT-X-KEY URI=`, `#EXT-X-MAP URI=`, variant, segment) thành `/proxy?url=...&__ref=...` (Swift `:1213-1245`) — nhờ đó Referer/UA được gắn cho **cả key AES-128 lẫn từng segment**, và hls.js (chạy same-origin) không bao giờ chạm CORS.

### C.5. Bảng đối chiếu logic JS (APK) → iOS: cái gì đã có, cái gì fix

| Bước luồng (JS gốc) | Hiện thực iOS | Trạng thái |
|---|---|---|
| `AndroidBridge` (Java, MainActivity) | `bridgeShimJS` trong `PhimWebView` + message handler `phimBridge` (landscape/exit/clearCookies; method trả string chạy đồng bộ trong JS, `proxyMedia` khớp `buildProxyUrl`) | ✅ đã có đúng — giữ nguyên, thêm log |
| `server.js`/`MediaProxyServer.java` (HTTP server + proxy) | `PhimLocalServer.swift` (BSD socket, port 3000-3100, `/proxy`, RawHttp, DoH, rewrite m3u8 1:1) | ✅ đã có đúng — giữ nguyên, thêm log cấu trúc |
| `phim_player_ui.js` gọi `setPlayerLandscape("1")` | Swift `setPlayerLandscape(on:)` + 3 lớp orientation (B.2) | ✅ có sẵn; **fix**: log ORIENTATION + errorHandler + KVC domain |
| HTML5 `<video playsinline>` + hls.js | `allowsInlineMediaPlayback` — **BỊ THIẾU** | 🔧 **FIX ROOT CAUSE** (`:76`) |
| MSE / ManagedMediaSource (iOS 17.1+) | hls.min.js 1.5.20 trong bundle (đã verify có `ManagedMediaSource`); iOS <17.1 → `video.src` native HLS | ✅ đã có đúng |
| Chuỗi fallback stream (`movieStreamFallback`) | Nguyên vẹn trong app.js (không đụng) | ✅ giữ nguyên |
| AVPlayer/AVPlayerViewController native | Vẫn dùng cho **Live TV/JVHD/⛶-fullscreen** (`PlayerView`, `AVPlayerManager`) — không đổi | ✅ bảo tồn tính năng |

**Vì sao không "port" luồng PHIM sang AVPlayer thuần?** Vì 100% UI module PHIM (danh sách, tìm kiếm, tập phim, phụ đề, player overlay) sống trong web app — đúng yêu cầu BẢO TỒN TÍNH NĂNG và kiến trúc gốc (Android cũng chạy WebView). Việc cần sửa là làm cho WebView iOS phát được inline như WebView Android — một cờ cấu hình, thay vì viết lại cả module (vừa rủi ro vừa vi phạm "không viết lại từ đầu"). Đường AVPlayer native vẫn nguyên vẹn cho các module dùng nó.

### C.6. JVHD — giới hạn trung thực (không sửa, không giấu)

Gate người dùng JVHD (`openJvhdUserGate()`, `app.js:8526` — luôn mở sau khi nhập PIN mặc định `1994` tại `app.js:69`) yêu cầu `AndroidBridge.c0(name)` = SHA-256(name + **SALT**). SALT nằm trong **native lib Android** (không có trong assets JS, không có trong project iOS) → shim iOS không thể tái tạo digest → gate **fail-closed** trên iOS. Đây là **giới hạn kiến trúc có sẵn từ trước bản fix**, không phải regression; sửa nó nằm ngoài phạm vi 2 nhiệm vụ và sẽ cần reverse native lib. Toàn bộ phần JVHD còn lại (UI, luồng media qua `/jvhd-media/`, PIN dialog) được **giữ nguyên 100%** — không đụng một dòng.

---

## D. DANH SÁCH FILE THAY ĐỔI / THÊM MỚI

### D.1. File sửa (7 — tất cả thuộc target, đã verify nhất quán pbxproj)

| # | File | Thay đổi chính |
|---|---|---|
| 1 | `BinTV/Phim/PhimWebView.swift` (498→662 dòng) | **`allowsInlineMediaPlayback = true` trước init** (root cause playback) · `playerObserverJS` (observer media events + env caps) · `#if DEBUG isInspectable` · `setPlayerLandscape` + navigation + bridge chuyển log `[PHIM_DEBUG]` chuẩn · comment root cause thay cho comment sai |
| 2 | `BinTV/Phim/PhimLocalServer.swift` (1694→1772 dòng) | `PhimDebugLog.step()` (format chuẩn) + `sanitizeURL()` (che ~20 khóa query nhạy cảm: pkey/token/sig/hash/session/...) · log cấu trúc toàn bộ vòng đời: SERVER (start/bind/listen/accept/stop), HTTP recv, STATIC serve, PROXY (dispatch/rawhttp/upstream-response/redirect-rewrite/urlsession-fail), M3U8 rewrite (đếm dòng/children), DOH resolve · **logic không đổi** |
| 3 | `BinTV/App/App.swift` (116→158 dòng) | **MỚI: `application(_:supportedInterfaceOrientationsFor:) → .landscape`** (lớp 2, bịt R1) · `requestGeometryUpdate` thêm errorHandler (log ORIENTATION FAIL) · KVC iOS-15 sửa sang `UIDeviceOrientation.landscapeLeft.rawValue` (R4) |
| 4 | `BinTV/Views/PlayerView.swift` | `setInterfaceLandscape`: `guard landscape else { return }` (bịt cửa sau R2) · mask `[.landscapeLeft, .landscapeRight]` · KVC đúng domain |
| 5 | `BinTV/Views/MovieListView.swift` | Như trên + mask 1 hướng `.landscapeLeft` → 2 hướng (bịt R3 lật 180°) |
| 6 | `BinTV/Info.plist` | `CFBundleVersion` 216→**217** · **MỚI: `UISupportedInterfaceOrientations~ipad`** landscape-only (R5) |
| 7 | `BinTV.xcodeproj/project.pbxproj` | `CURRENT_PROJECT_VERSION` 216→**217** (cả Debug lẫn Release) — không đổi gì khác |

### D.2. File mới (KHÔNG thuộc Xcode target → không thể gây lỗi build)

| Đường dẫn | Nội dung |
|---|---|
| `tests/mock-e2e/` (9 file) | Bộ test 4 suite T1-T4 + `run_all.js` + README (mục F) — nằm ngoài `BinTV/`, không được pbxproj tham chiếu |
| `BAOCAO-KYTHUAT-FIX-2026-09-12.md` | Báo cáo này |

### D.3. File KHÔNG đụng (bảo tồn tính năng)

Toàn bộ `BinTV/Phim/Web/**` (index.html, app.js, hls.min.js, phim_android.js, phim_player_ui.js, tizen_shim.js, phim_ios_fallback.js, CSS — byte-for-byte như APK), `ContentView.swift`, `LiveTVView.swift`, `SettingsView.swift`, `AVPlayerManager.swift`, `StreamService.swift`, `NetworkService.swift`, `Channel.swift`, `Preferences.swift`, `VTTLoader.swift`, `Main.storyboard`, `Assets.xcassets`, `.github/workflows/build-ipa.yml`, `BinTV.xcscheme`, `AppDelegate.swift` (stub — vẫn **không** nằm trong pbxproj, không bị build, tránh trùng `@main` với `App.swift`), `README.md` gốc, `PORTING_REPORT.md` gốc.

---

## E. DEBUG LOGGING — `[PHIM_DEBUG]` (đúng format yêu cầu)

- **Format chuẩn:** `[PHIM_DEBUG] Step -> Action -> Status -> Payload/URL`
  - Step: `SERVER` · `HTTP` · `STATIC` · `PROXY` · `M3U8` · `DOH` · `WEBVIEW` · `BRIDGE` · `ORIENTATION` · `PLAYBACK` (từ observer JS) · `JS` (console web app)
  - Status: `ok` / `FAIL` / `begin` / `ignored` / `upstream-<code>` ...
  - Ví dụ thật: `[PHIM_DEBUG] PROXY -> dispatch -> ok -> url=https://cdn…/master.m3u8?pkey=***&referer=*** ref=https://www…/watch/*** doh=N`
- **Sanitize (bắt buộc, đã triển khai):** `PhimDebugLog.sanitizeURL()` (`PhimLocalServer.swift:60`) che giá trị của ~20 khóa query nhạy cảm (`pkey, token, sig, signature, hash, session, sid, auth, key, secret, pass, password, credential, cookie, jwt, access_token, ...`) thành `***`; cắt 300 ký tự; thuần string-based (không re-encode URL). Observer JS có sanitizer riêng cùng danh sách.
- **Vị trí ghi:** `Documents/phim_debug.log` (append, có `LSSupportsOpeningDocumentsInPlace` + `UIFileSharingEnabled` trong plist → **lấy được qua Files.app/iTunes** mà không cần Xcode).
- **Dev-only:** log phục vụ chẩn đoán; `isInspectable` bọc `#if DEBUG` (release không mở inspector).

---

## F. KIỂM THỬ & XÁC MINH (E2E — không báo cáo thành công cảm tính)

### F.1. Bộ test đi kèm project: `tests/mock-e2e/` — **244/244 PASS** (chạy trong sandbox, `node run_all.js`)

| Suite | Kết quả | Kiểm chứng điều gì |
|---|---|---|
| **T1** `test_app_js_logic.js` | **40/40** | Chạy các hàm **CẮT NGUYÊN VĂN từ `app.js` thật** (brace-matching từ file — không hard-code logic vào test; app.js đổi thì test tự dùng bản mới) trong Node VM + stub DOM/XHR: `extractMovieTargetUrl` (unwrap `{record:{...}}`), `normalizeMovieManifestUrl`, `isValidMovieTargetUrl` (12 vector — phát hiện và document semantics thật: chỉ check protocol+host, KHÔNG lọc đuôi file), `getMovieBaseUrl`, `buildMovieResourceUrl`, `requestJson` (200/500/timeout paths), `fetchMovieStreamsShared` (raw + dedupe), khối lọc `validStreams` thật, và **khối proxy-wrap thật của `startMoviePlayback`**: cross-origin → `http://127.0.0.1:PORT/proxy?url=<enc>&__ref=<enc referer>`; same-origin không wrap kép; referer trích đúng từ query; `phimHlsUrl` phát hiện `.m3u8` cả khi ẩn trong query đã encode |
| **T2** `test_m3u8_rewrite.js` | **55/55** | **Port 1:1 sang JS** (chú thích số dòng Swift từng hàm) của `rewriteM3u8Urls`/`proxifyM3u8Value`/`encodeQueryValue`/`originOf`/`baseUrlOf`/`rewriteUriAttrs`/`rewriteRedirectLocation`/`isM3u8*`: master+variant (relative/absolute), `EXT-X-KEY` (AES-128 URI + IV giữ nguyên), `EXT-X-MAP`, segment query, `/abs/path`, chống double-proxy + bù `__ref`, CRLF→LF, encoding edge cases (`space→%20`, `*→%2A`, `~` giữ, UTF-8 đa byte, hex uppercase, round-trip decode), Foundation-style port tường minh |
| **T3** `test_proxy_chain_e2e.js` | **53/53** | **E2E HTTP live**: mock CDN (gate Referer — thiếu là **403 như CDN thật**; 302 Location tuyệt đối; token hết hạn → playlist quảng cáo kiểu `sc.k-20.xyz`; MP4 + Range/206) + **mirror proxy đúng contract `PhimLocalServer.swift`** (UA Chrome 126, Referer/Origin từ `__ref`, `Accept-Encoding: identity`, Range/If-Range forward, KHÔNG follow redirect, bọc Location 3xx, rewrite m3u8, ACAO `*`, HEAD) + **app.js thật** lái toàn chuỗi. Assert: bootstrap live (config→manifest→stream.json→lọc→chọn), URL cuối vào player đúng dạng proxy, **cả playlist tree (master→variant→key→map→seg1..3) đi hết qua proxy và nhận 200** (403 sẽ lộ ngay nếu header injection hỏng), **bytes nguyên vẹn từng segment/key/MP4**, CDN log xác nhận **Referer+Origin+UA+identity tới mọi media call**, redirect bọc kín không lộ upstream, expired→ad phát hiện được (fallback app.js kích hoạt đúng), Range→206, HEAD giữ Content-Length |
| **T4** `test_project_consistency.py` | **96/96** | Tĩnh, chống "push lên Actions mới phát hiện": pbxproj↔đĩa (14 Swift trong Sources; `AppDelegate.swift` stub KHÔNG bị build; `Web` là folder trong Resources; scheme UUID khớp target), plist↔pbxproj (build **217** cả 2 nơi; landscape-only iPhone+**iPad**; `UIRequiresFullScreen`; ATS local networking), **thứ tự fix** (`allowsInlineMediaPlayback = true` nằm TRƯỚC `WKWebView(frame:configuration:)`; observer add trước init), 3 lớp orientation tồn tại đúng code (không chỉ comment), không còn **dòng code** KVC sai domain, PlayerView/MovieListView không còn nhánh request `.portrait`, brace/paren/bracket balance toàn bộ 15 file Swift (string/comment-aware), `node --check` 6/6 JS assets, 8/8 reference của `index.html` tồn tại, workflow `build-ipa.yml` + `xcodebuild` |

### F.2. Kết quả kiểm chứng E2E theo yêu cầu (URL hợp lệ + player nhận URL + headers)

- **URL stream cuối cùng hợp lệ:** T1.6/T3.2 — chuỗi bootstrap thật sinh `http://127.0.0.1:PORT/proxy?url=<master.m3u8 gốc>&__ref=<referer gốc>`; decode ngược ra đúng URL CDN + đúng referer.
- **Player nhận URL:** trên iOS, "player" của module PHIM chính là `<video>` + hls.js trong WKWebView; khối wrap thật (T3.2) trả `phimHlsUrl=true` → app.js đưa URL đó cho `hls.loadSource()`/`video.src`. Cờ `allowsInlineMediaPlayback=true` (đã set trước init — T4.3 assert thứ tự) là điều kiện để `video.play()` không bị WebKit từ chối/hijack. Observer `playerObserverJS` sẽ ghi bằng chứng runtime trên thiết bị (mục H).
- **Headers:** T3.4 — CDN mock (gate 403) xác nhận **Referer, Origin, UA Chrome 126, Accept-Encoding: identity tới mọi request media** (kể cả AES key và từng segment); T3.7 xác nhận **Range forward** (206 + đúng 100 byte đầu).

### F.3. Giới hạn trung thực của việc kiểm thử (đọc kỹ — không tô hồng)

1. **Chưa build IPA trong sandbox** (không có Xcode/Swift toolchain). Đảm bảo thay thế: (a) mọi sửa đổi Swift là additive/cục bộ, dùng API ổn định có từ iOS 9-16 (đã trích dẫn); (b) T4 phủ các lớp lỗi build thường gặp (mất cân bằng brace, thiếu file trong pbxproj, plist hỏng, trùng `@main`, scheme sai UUID); (c) không thêm dependency/package mới → workflow hiện tại không cần đổi. **Xác nhận cuối cùng = build 217 trên GitHub Actions** (mục G).
2. **T2/T3 kiểm algorithm Swift qua bản port JS 1:1** (đối chiếu từng dòng, chú thích số dòng), không phải chạy binary Swift thật. Khác biệt nền tảng hiếm (Foundation vs WHATWG URL: port mặc định tường minh, scheme-relative URL) đã nêu trong test vector; luồng thực tế (relative path + absolute http(s)) không rơi vào các edge đó.
3. **Tầng DoH và RawHttp/ATS không mirror trong T3**: DoH là cơ chế DNS iOS-only (trực giao — không đổi URL vào/ra proxy); ATS là chính sách iOS (Node không có). Semantics header/rewrite/redirect giữ 100%. Trên thiết bị, 2 tầng này đã có sẵn từ bản cũ và **không bị sửa logic**.
4. **Không có CDN phim thật trong sandbox** → dùng mock đúng shape (Stremio addon + JSONBin record wrapper + gate Referer + redirect hết hạn). Shape lấy từ code app.js thật (đã đọc), không bịa.
5. **JVHD gate không test được** (C.6) — native Android SALT.
6. Observer `playerObserverJS` mới verify được **syntax** (`node --check`) trong sandbox; giá trị của nó là **bằng chứng runtime trên máy thật** (mục H).

---

## G. BUILD & GITHUB ACTIONS (sẵn sàng push)

- **Build number 216→217** đồng bộ 2 nơi (`Info.plist` + `CURRENT_PROJECT_VERSION` Debug/Release trong pbxproj) → IPA ra lò phân biệt được ngay với bản cũ.
- **`.github/workflows/build-ipa.yml` KHÔNG đổi** (920 dòng giữ nguyên): không dependency mới, không signing mới, không target mới; `tests/` và báo cáo nằm ngoài target nên `xcodebuild` bỏ qua.
- pbxproj chỉ đổi 2 chữ số version (T4 xác nhận); `Web` vẫn là folder reference → assets web copy vào bundle như cũ.
- Zip bàn giao: **`BinTV-Fixed.zip`** — toàn bộ project (cấu trúc giữ nguyên `BinTV.xcodeproj/`, `BinTV/`, `.github/`, `tests/`, docs) → push lên GitHub và chạy workflow như quy trình hiện tại.

## H. HƯỚNG DẪN XÁC MINH TRÊN THIẾT BỊ THẬT (5 phút)

1. Cài IPA build **217** (GitHub Actions). Kiểm tra: app mở **thẳng landscape** dù cầm dọc và dù Rotation Lock đang bật.
2. Điều hướng 4 tab, mở Live TV player, bấm ⛶ ở Movie List, mở PHIM → **không khoảnh khắc nào màn hình dọc** (kể cả video fullscreen).
3. Tab PHIM → chọn phim → video phải phát **inline trong khung web app** (không nhảy sang player fullscreen hệ thống).
4. Lấy bằng chứng log: Files.app → On My iPhone → BinTV → `phim_debug.log`. Chuỗi kỳ vọng khi phát thành công:
   ```
   [PHIM_DEBUG] SERVER -> start -> ok -> port=30xx
   [PHIM_DEBUG] WEBVIEW -> loadPage -> ok -> url=http://127.0.0.1:30xx/?android=phone&ios=landscape
   [PHIM_DEBUG] JS -> env -> ok -> MSE=... managedMSE=... hls=1.5.20 inline=true
   [PHIM_DEBUG] PROXY -> dispatch -> ok -> url=https://...master.m3u8?pkey=*** ref=https://...*** doh=N
   [PHIM_DEBUG] M3U8 -> rewrite -> ok -> lines=.. proxiedChildren=..
   [PHIM_DEBUG] PLAYBACK -> video.loadstart -> ok -> ...
   [PHIM_DEBUG] PLAYBACK -> video.playing -> ok -> currentTime=0.0
   [PHIM_DEBUG] BRIDGE -> setPlayerLandscape -> ok -> on=1 (buộc landscape)
   [PHIM_DEBUG] ORIENTATION -> ... -> ok
   ```
   Nếu có lỗi, log chỉ đích danh tầng chết (`PROXY upstream-403` = referer/token; `PLAYBACK video.error code=...` = tầng media; `DOH resolve FAIL` = DNS) — gửi log đó để chẩn đoán tiếp, không phải đoán mò.

---

*Toàn bộ nhận định trong báo cáo này truy vết được về dòng code cụ thể (file:line đã dẫn) hoặc kết quả test có thể chạy lại bằng `cd tests/mock-e2e && node run_all.js`.*

---

## ADDENDUM 2026-09-12 — CI BUILD FIX (sau run GitHub Actions đầu tiên của build 217)

**Kết quả build 217 trên GitHub Actions** (Xcode 16.4, SDK iPhoneOS18.5 22F76, runner `macos-15`, scheme `BinTV`, configuration `Release`, `xcodebuild archive`, unsigned theo thiết kế TrollStore của workflow): `** ARCHIVE FAILED **`, exit 65 — **2 lỗi biên dịch Swift**, không có lỗi nào khác:

```
BinTV/App/App.swift:150:20: error: initializer for conditional binding must have Optional type, not 'any Error'
BinTV/Phim/PhimWebView.swift:508:20: error: initializer for conditional binding must have Optional type, not 'any Error'
```

**Root cause:** `UIWindowScene.requestGeometryUpdate(_:errorHandler:)` (iOS 16+) có `errorHandler` type `((any Error) -> Void)?` — tham số closure là **`any Error` KHÔNG Optional** và handler **chỉ được gọi khi có lỗi**. Code của fix orientation (mục B.2 lớp 3) đã viết `if let error = error { ... }` → optional binding trên giá trị không-Optional → lỗi biên dịch. Các kiểm tra tĩnh trong sandbox (brace-balance, nhất quán pbxproj/plist, node --check) **không phủ tầng semantics Swift** vì không có Swift toolchain — đúng giới hạn trung thực đã khai báo ở mục F.3.1; CI GitHub Actions là tầng bắt lỗi như thiết kế.

**Fix (tối thiểu, chỉ 2 file, không đổi logic tính năng):**
- `BinTV/App/App.swift` — `requestLandscape(on:)`: bỏ optional binding, dùng trực tiếp `error.localizedDescription` trong log FAIL (handler chỉ chạy khi lỗi).
- `BinTV/Phim/PhimWebView.swift` — `setPlayerLandscape(_:)`: bỏ optional binding; đồng thời sửa ngữ nghĩa log: nhánh "ok" cũ nằm trong `else` của handler là **unreachable** (handler chỉ được gọi khi lỗi) → chuyển log "ok" ra ngay sau lời gọi `requestGeometryUpdate` (ý nghĩa: request đã gửi) và thêm log FAIL cho trường hợp không có scene `foregroundActive`.
- `BinTV/Phim/PhimLocalServer.swift:992` GIỮ NGUYÊN `if let error = error` — hợp lệ vì tham số ở đó là `didCompleteWithError error: Error?` (Optional thật).
- Thêm regression guard vào `tests/mock-e2e/test_project_consistency.py` (T4.4b): quét code (sau khi strip dòng comment) — không được tồn tại `if let error` trong bất kỳ handler `requestGeometryUpdate` nào; đồng thời xác nhận guard error của `PhimLocalServer` (optional thật) không bị xóa nhầm. Suite đầy đủ sau fix: **263/263 PASS** (T1 40 + T2 55 + T3 53 + T4 115).

**Warnings trong log (KHÔNG phải lỗi, không làm fail build — giữ nguyên theo nguyên tắc bảo tồn logic):** `AVPlayerManager.swift:160` (capture self non-Sendable trong @Sendable closure) và `PhimLocalServer.swift:955` (sendability của `urlSession(_:task:didReceive:completionHandler:)` so với protocol — "error in Swift 6 language mode", project đang build `-swift-version 5`) đều là code có sẵn từ trước fix; note "Disabling previews because SWIFT_OPTIMIZATION_LEVEL=-O" là thông tin vô hại với archive Release.

**Workflow/signing xác nhận lại từ log:** chuỗi `archive (unsigned) → verify .xcarchive → verify .app → package Payload/ → BinTV.ipa → verify zip → upload artifact + Release` của `.github/workflows/build-ipa.yml` KHÔNG có lỗi cấu hình; `CODE_SIGNING_ALLOWED=NO` là **mô hình sản phẩm** (IPA unsigned cho TrollStore — workflow có pipefail + verify nghiêm ngặt, không phải che lỗi); không cần `ExportOptions.plist` vì pipeline không dùng `xcodebuild -exportArchive`. Run này dừng ở bước archive do 2 lỗi compile trên → IPA/artifact chưa được tạo.

**Trạng thái xác minh:** fix đã kiểm chứng tĩnh trong sandbox (brace-balance, regression guard, 263/263 test). `xcodebuild build/archive`, tạo `.xcarchive`, đóng gói `.ipa`, validate IPA, upload artifact: **NOT VERIFIED** tại sandbox (không có macOS/Xcode) — xác nhận bằng cách chạy lại workflow GitHub Actions với 2 file đã sửa.

---

## ADDENDUM 2 — FIX UI 2026-09-12 (build 218): Tabbed Browser UI + Adaptive Scaling

Sau khi build 217 ra IPA cài được trên iPhone, phản hồi thực tế: giao diện không tự thu phóng theo kích thước màn hình (chrome hard-code point: cột Settings 230pt, nút nổi TUBE 40×40, icon 22pt...), icon vỡ bố cục trên màn nhỏ; yêu cầu tái cấu trúc theo phong cách **Tabbed Web Browser**, giữ layout icon trong tab, giữ khóa landscape.

**Kiến trúc mới (chỉ đổi khung hiển thị — logic 4 trang nguyên văn):**
- `Views/BrowserTabs.swift` (MỚI): `BinTVPage` (rawValue = tag TabView cũ 0…3) + `BrowserTabManager` — mở/đóng/chọn tab theo quy tắc browser (tab mới chèn phải tab hiện hành; đóng tab đang chọn → láng giềng phải→trái; đóng hết → New Tab Page). **Đóng tab = gỡ khỏi thanh tab, KHÔNG hủy view** → StateObject/singleton (YouTubeBrowser, PhimController) không bị tạo lại, playback/state giữ nguyên 100%.
- `Views/BrowserTabBar.swift` (MỚI): strip trên cùng (tối ưu landscape) — chip tab [favicon màu + tiêu đề + ×], nút "+", ScrollView ngang + tự cuộn tab chọn vào giữa; nền tối hairline đồng bộ thẩm mỹ capsule cũ; tôn trọng safe area (notch/Dynamic Island cạnh ngang).
- `Views/NewTabPageView.swift` (MỚI): speed-dial **lưới icon adaptive** 4 chức năng (giữ "dạng layout icon" của app, cùng ngôn ngữ card của LiveTVView), badge tab đang mở, nút × đóng NTP.
- `Views/ContentView.swift` (VIẾT LẠI KHUNG): `GeometryReader → VStack [ BrowserTabBar (toggle được) ; NavigationView{ TabView 4 trang cũ tag 0…3 } + overlay NewTabPageView ]` + environment `\.uiProps`. Nav bar hệ thống ẩn hết (strip là chrome duy nhất → thêm chiều cao nội dung cho SE). **Long-press ≥0.35s (TabChromeController + recognizer 2 webview giữ NGUYÊN VĂN cơ chế cũ) đổi ngữ nghĩa: ẩn/hiện thanh tab = immersive video**; khi strip ẩn có **grabber pill** đỉnh màn hình (escape hatch nhìn thấy được, tap = hiện strip). Sheet PlayerView, loadChannels, hidden-bottom-bar: nguyên văn.
- `Views/UIProportions.swift` (MỚI): hệ tỷ lệ thích ứng — `scale = clamp(cao_landscape/390, 0.82, 1.15)` (mốc iPhone 14 landscape 844×390), inject 1 lần qua EnvironmentKey `\.uiProps`. Kết quả: SE scale 0.82 (strip 36pt, cột Settings 155pt, nút nổi 33pt), 14/15 Pro ~1.01, Pro Max 1.10 (strip 48.5, cột 254, nút 44), iPad kẹp 1.15. Lưới nội dung `GridItem(.adaptive)` × scale → số cột tự tính (SE ~4, Pro Max ~6).
- Scale hóa phần cứng còn lại: `LiveTVView` (cột/card/icon/padding), `SettingsView` (cột trái tỷ lệ 230/844 bề rộng, kẹp [180,300]×scale), `MovieListView` (3 nút nổi 40×40 → `props.controlButtonSide`). WebView/AVPlayer/Form hệ thống KHÔNG scale (tự thích ứng sẵn).

**Không đụng:** orientation 3 lớp (App.swift/PlayerView/setInterfaceLandscape), playback fix (PhimWebView), PhimLocalServer, toàn bộ Web assets, workflow.

**Version:** 217→**218** (Info.plist + pbxproj 2 config), MARKETING_VERSION 2.1.6→**2.2.0** (2 nơi, nhất quán).

**Kiểm chứng:** pbxproj đăng ký đủ 4 file mới (fileRef + Sources + group Views); brace-balance toàn bộ 19 file Swift; T4 mở rộng mục T4.8 (33 assertion: cấu trúc shell mới, tag 0…3, cơ chế long-press cũ còn nguyên, hết hard-code 230/40×40/140, orientation không bị đụng); suite đầy đủ **310/310 PASS** (T1 40 + T2 55 + T3 53 + T4 162). Compile/archive/IPA trên Xcode thật: **NOT VERIFIED** tại sandbox (không có macOS) — xác nhận bằng GitHub Actions với build 218.

---

## ADDENDUM 3 — FIX UI 2026-09-12 (build 219): Fullscreen + Long-press Overlay Menu

Yêu cầu mới sau build 218: loại bỏ hoàn toàn thanh tab phía trên (BrowserTabBar) và bottom menu bar; nội dung fill trọn màn hình (edge-to-edge); điều hướng bằng **long-press → overlay mờ + 4 icon thuần không chữ** (LIVE TV/TUBE/PHIM/SETTINGS), chạm icon = chuyển trang ngay + ẩn overlay.

**Kiến trúc (chỉ đổi cơ chế điều hướng — logic 4 trang nguyên văn):**
- **Khai tử 3 file** browser-UI của build 218: `BrowserTabs.swift`, `BrowserTabBar.swift`, `NewTabPageView.swift` (xóa đĩa + xóa sạch 12 dòng tham chiếu pbxproj — không fileRef mồ côi gây lỗi build). Bottom bar UITabBarController vẫn bị `TabChromeController` ẩn vĩnh viễn (cơ chế cũ, nguyên văn).
- **MỚI `Views/GestureOverlayMenuView.swift`**: overlay `Rectangle().fill(.ultraThinMaterial)` + dim `black 0.35` phủ **tràn viền** (ignoresSafeArea — mờ edge-to-edge), hàng 4 nút tròn icon SF Symbols (tv/film/popcorn/gear, viền accent khi active) **KHÔNG nhãn văn bản** (chỉ `accessibilityLabel` cho VoiceOver) nằm **trong safe area** → notch/Dynamic Island cạnh ngang không lẹm icon. Chạm icon → `selectedTab = rawValue` + `isPresented = false` **cùng một action** (chuyển trang tức thì); chạm nền → chỉ ẩn. `BinTVPage` enum giữ rawValue = tag 0…3 cũ.
- **`ContentView.swift` viết lại khung**: `GeometryReader → NavigationView(.stack){ TabView 4 trang tag 0…3 }.navigationBarHidden(true) → overlay { if showMenu { GestureOverlayMenuView } }` — không strip, không NTP, không grabber, không nav bar → nội dung chạm mép trên/dưới (0 spacing), webview PHIM/TUBE full-bleed như cũ. `@State selectedTab/showMenu` tối giản (đúng semantics bản gốc). Fade 0.15s — phản hồi tức thì.
- **Gesture giữ nguyên văn cơ chế UIKit đã kiểm chứng** (không dùng `.onLongPressGesture` SwiftUI — xung đột scroll/tap): `TabChromeController` global recognizer trên view UITabBarController (`delaysTouchesBegan=false` → chạm/scroll không trễ; `cancelsTouchesInView=true` → chỉ long-press thật ≥0.35s mới hủy touch) + recognizer riêng trên 2 webview TUBE/PHIM (`cancelsTouchesInView=false`). Callback đổi đích: `toggleOverlayMenu()` (idempotent khi menu đang hiện — chống nhấp nháy đa recognizer). Khi overlay hiện nó nằm NGOÀI subtree UITabBarController → không có vòng lặp toggle; đóng bằng tap icon/nền. Khi ẩn: `if showMenu` → không tồn tại trong hierarchy → 0% chặn touch.
- **`UIProportions.swift`**: thêm `menuIconSide` (68pt chuẩn → SE 55.8 … iPad 78.2), `menuGlyphFont` (28), `menuSpacing` (26) — 4 nút + spacing trên SE ≈ 287pt < 568pt bề ngang, luôn một hàng. Scaling build 218 của LiveTV/Settings/TUBE giữ nguyên.
- **Không đụng:** orientation 3 lớp, playback fix (PhimWebView/PhimLocalServer), Web assets, workflow, sheet PlayerView, loadChannels.

**Version:** 218→**219**, MARKETING_VERSION 2.2.0→**2.3.0** (Info.plist + pbxproj 2 config, nhất quán).

**Kiểm chứng sandbox:** pbxproj sạch 12 dòng chết + A59/B59 đủ 4 vị trí; brace-balance 17/17 file Swift; quét symbol mồ côi (BrowserTabManager/stripVisible/... = 0 tham chiếu code); T4.8 viết lại (33 assertion: khai tử sạch, overlay blur/icon-only/safe-area, gesture plumbing nguyên văn, tag 0…3, bottom bar ẩn, orientation/playback không đụng); suite đầy đủ **302/302 PASS** (T1 40 + T2 55 + T3 53 + T4 154). Compile/archive/IPA trên Xcode thật: **NOT VERIFIED** tại sandbox — xác nhận bằng GitHub Actions build 219.

---

## ADDENDUM 4 — PREFLIGHT CI FIX 2026-09-12: GitHub Actions FAIL tại bước Preflight

**Hiện tượng:** sau khi áp patch build 219, workflow `build-ipa.yml` fail ngay bước `Preflight (pbxproj + scheme vs source files)`.

**Chẩn đoán (tái hiện bằng chính script preflight trích từ workflow, chạy local):**
- Bản chuẩn 219 (đĩa ↔ pbxproj nhất quán): preflight **rc=0 PASS** (16 entry Sources / 17 file đĩa, 1 file `AppDelegate.swift` loại trừ chủ đích bằng `// ci-skip:` có in log).
- **Kịch bản A — ROOT CAUSE:** repo đã nhận `project.pbxproj` 219 nhưng **CHƯA XÓA** 3 file khai tử `BrowserTabs/BrowserTabBar/NewTabPageView.swift` (zip không biểu diễn được thao tác xóa) → preflight rc=1: `::error::3 file .swift/.m KHONG nam trong Compile Sources`. Khớp đúng nhóm lỗi #2 của bước Preflight.
- **Kịch bản C — BLIND SPOT phát hiện thêm:** chiều ngược lại (pbxproj cũ 218 còn tham chiếu 3 file đã bị xóa khỏi đĩa) → preflight cũ **PASS GIẢ (rc=0)**, xcodebuild mới chết sau đó với `Build input file cannot be found`. Check cũ chỉ soát một chiều (đĩa → Sources).

**Sửa gốc (2 phần, không che lỗi):**
1. **Trạng thái repo:** xóa 3 file khai tử khỏi GitHub (UI: mở file → thùng rác → Commit; hoặc `git rm`). Patch kèm `PREFLIGHT-FIX-INSTRUCTIONS.txt` đặt bước xóa lên ĐẦU, kèm bản chuẩn pbxproj/Info.plist/3 file Views để loại mọi kịch bản upload thiếu một lần.
2. **Nâng cấp preflight trong `build-ipa.yml`:** thêm check **2.1b HƯỚNG NGƯỢC LẠI** (mọi entry `in Sources` phải tồn tại trên đĩa — bắt kịch bản C ngay tại preflight thay vì sau 5 phút chọn Xcode); in **hướng sửa actionable** cho cả 2 chiều lỗi (xóa repo / upload pbxproj đúng / `// ci-skip:` chủ đích); xuất thêm `ghost_sources` vào GITHUB_OUTPUT. `sys.exit(rc)` trung thực giữ nguyên — không `exit 0`, không bỏ bước. YAML validate OK.

**Không đụng:** pbxproj/Info.plist vẫn 219/2.3.0 (không đổi version — app binary không thay đổi), scheme `BinTV.xcscheme` (BlueprintIdentifier đã verify ⊆ PBXNativeTarget), toàn bộ Swift tính năng, `CODE_SIGNING_ALLOWED=NO` (model unsigned TrollStore hợp lệ).

**Kiểm chứng sandbox:** preflight nâng cấp chạy 3 kịch bản — canonical rc=0, A rc=1 (3 missing + hướng sửa), C rc=1 (3 ghost) — đúng kỳ vọng; T4.9 mới (12 assertion) guard cổng CI; suite đầy đủ **314/314 PASS** (T1 40 + T2 55 + T3 53 + T4 166). `xcodebuild build/archive/export`: **NOT VERIFIED** tại sandbox (không có macOS/Xcode) — cổng xác nhận là GitHub Actions sau khi repo về trạng thái chuẩn.

---

## ADDENDUM 5 — xbuild.log 2026-09-12: nhật ký build hợp nhất toàn pipeline

**Yêu cầu:** mỗi lần build IPA trên GitHub Actions phải xuất ra tệp `xbuild.log` để khi có lỗi còn tải về kiểm tra — kể cả khi fail sớm.

**Vấn đề của bản cũ:** log duy nhất là `build/Output/xcodebuild.log`, chỉ được tạo ở bước Build bằng `tee`. Nếu job chết ở Detect/Preflight (như sự cố preflight build 219), **không tồn tại bất kỳ file log nào** → artifact `BinTV-build-log` trống (`if-no-files-found: warn`), người dùng không có gì để chẩn đoán ngoài log console rải rác.

**Sửa (chỉ workflow, không đụng app — version giữ 219/2.3.0):**
1. **Bước mới `Init xbuild.log`** ngay sau Checkout: tạo `build/Output/xbuild.log` + header (thời gian UTC, link run, ref/sha, event, runner, inputs, BUILD_DIR) → file tồn tại TRƯỚC cả Detect/Preflight → artifact log có trong MỌI kịch bản fail.
2. **Wrapper hợp nhất cho 8 step script** (Detect, Preflight, Select Xcode, Toolchain, Build, Verify .app, Package .ipa, Verify .ipa): `{ ...body... } 2>&1 | tee -a "$XLOG"` + `RC_STEP="${PIPESTATUS[0]}"` + marker `[STEP END] <tên> exit=N` + `exit "$RC_STEP"` — console Actions vẫn hiện đầy đủ theo thời gian thực, file nhận bản sao y hệt, **exit code thật của từng step được bảo toàn** (bash 3.2-safe: không process-substitution, không mapfile).
3. **Build step:** bỏ `tee` nội bộ (`xcodebuild | tee log` + PIPESTATUS) → chạy trực tiếp, `RC=$?`; output tự chảy vào xbuild.log qua wrapper. KHÔNG `rm` xbuild.log ở bước Build (log hợp nhất chứa cả lịch sử Preflight) — chỉ `rm -rf` .xcarchive cũ.
4. **Một log duy nhất:** mọi tham chiếu `xcodebuild.log` (bước "Build log chi in khi loi", Job summary) chuyển sang `xbuild.log`; artifact đổi tên `BinTV-build-log` → **`xbuild-log`** (path `build/Output/xbuild.log`, `if: always()`, retention 30 ngày). Job summary thêm dòng chỉ chỗ tải log.
5. **Không đổi:** preflight python (giữ nguyên văn bản đã kiểm chứng — diff = 0), logic build/verify/package/release, `CODE_SIGNING_ALLOWED=NO`, các chốt chống che lỗi (`sys.exit(rc)`, không `exit 0` trong preflight).

**Kiểm chứng sandbox:** `yaml.safe_load` VALID (15 steps); mô phỏng bash thật cơ chế wrapper 3 step (Init → step PASS có heredoc python + ghi `GITHUB_OUTPUT` từ subshell → step FAIL `exit 65` giữa chừng): rc lan truyền đúng 0/0/65 qua tee, log tích lũy đủ output + marker END, dòng sau `exit` không chạy; preflight trích từ yml mới **diff = 0** với bản đã kiểm chứng (canonical rc=0, kịch bản 3-file-chết rc=1 + CACH SUA); T4.9 += 4 assertion xbuild.log → suite **318/318 PASS**. Chạy thật trên runner GitHub: **NOT VERIFIED** (sandbox không có macOS/Actions) — xác nhận bằng lần chạy kế tiếp: mọi run (kể cả fail) phải có artifact `xbuild-log`.

---

## ADDENDUM 6 — IPA BUILD FIX 2026-09-12: phân tích xbuild.log thật (run 34690803983) + tombstone ci-skip

**Log thật đầu tiên từ GitHub Actions** (repo `Binkyo2013/BinTV1`, sha `630ca4d`, `workflow_dispatch`, runner macos-15/arm64/macOS 15.7.9, inputs: Xcode default, Release, archs default, bundle_id auto, run_mode archive). Hệ thống xbuild.log hoạt động đúng thiết kế: Init→Detect→Preflight ghi đủ, Detect exit=0, fail tại Preflight.

**Root cause (từ log, dòng 22–31):** `Compile Sources : 16 entry | file nguon tren dia : 20` → `::error::3 file .swift/.m KHONG nam trong Compile Sources`: `BrowserTabBar.swift`, `BrowserTabs.swift`, `NewTabPageView.swift`. Repo đã có pbxproj 219 (16 entry ✓) nhưng **3 file khai tử của build 218 vẫn nằm trên repo** — thao tác xóa thủ công (zip không biểu diễn được) chưa được thực hiện. Preflight fail ĐÚNG (cổng đã làm đúng việc); job dừng trước xcodebuild. Không phải lỗi compiler/signing/scheme (Scheme OK, bundle ID `com.bintv.ios` resolve OK).

**Secondary defect (phát hiện NHỜ log thật):** thiếu marker `[STEP END] Preflight exit=1` — GitHub gọi `shell: bash` bằng `bash --noprofile --norc -eo pipefail`; `-e` + `pipefail` mức ngọn làm script ABORT ngay sau pipeline `{…} | tee` fail, không kịp ghi marker/exit chủ động. Tái hiện chính xác trong sandbox bằng lời gọi bash y hệt. **Fix:** `set +e` trước pipeline ở cả 8 step wrapper (exit code thật vẫn được trả qua `exit "$RC_STEP"` — kiểm chứng rc=1 nguyên vẹn) + khôi phục `set +e/-e` quanh lệnh `xcodebuild` trong bước Build (nếu không, `-e` kế thừa vào subshell sẽ abort trước khi kịp lấy `RC=$?` và in error dump).

**Fix root cause — TOMBSTONE ci-skip (áp dụng bằng upload thuần, không cần xóa file thủ công):** ghi đè 3 file khai tử bằng bản placeholder **100% comment, 0 dòng code**, dòng 1 là `// ci-skip: DEPRECATED build 219 …` — đúng cơ chế loại trừ CHỦ ĐÍCH có sẵn của Preflight (chính là CACH SUA (3) mà log đã in ra), được in minh bạch `bo qua co chu dich` trong mọi log sau này. Không phải che lỗi: file không chứa code, không được biên dịch, binary giống hệt thiết kế 219 canonical; người dùng vẫn có thể xóa hẳn 3 file bất kỳ lúc nào (build không đổi). Preflight python **giữ nguyên văn (diff=0)**.

**Kiểm chứng sandbox (không có macOS/Xcode → phần build thật NOT VERIFIED):**
- Trích step Preflight THẬT từ yml đã sửa, chạy bằng đúng lời gọi GitHub `bash --noprofile --norc -eo pipefail` trên 3 trạng thái: (1) canonical+tombstone → **rc=0**, 4 file ci-skip in minh bạch, marker END đủ; (2) repo-user-hiện-tại (3 file chết bản đầy đủ) → **rc=1** + marker END exit=1 (fix set +e hiệu lực); (3) repo-user-sau-patch (tombstone đè lên) → **rc=0** → Preflight sẽ XANH, job đi tiếp tới xcodebuild.
- YAML valid (15 steps); suite mock-E2E **326/326 PASS** (T4.1 dạy cơ chế ci-skip + whitelist chặt; T4.8 chấp nhận tombstone; T4.9 +mô phỏng trọn Preflight 2.1 trên canonical → missing=0).
- `xcodebuild build/archive` + đóng gói IPA với mã nguồn 219 trên Xcode thật: **NOT VERIFIED** tại sandbox — lần chạy kế tiếp chính là cổng xác nhận; nếu có lỗi Swift, xbuild.log giờ ghi TOÀN BỘ output compiler kèm error dump.

---

## ADDENDUM 7 — RUN #26: job KHÔNG ĐƯỢC CẤP RUNNER (GitHub billing), không phải lỗi code

**Hiện tượng (ảnh chụp run #26 "Update build-ipa.yml"):** annotation duy nhất — *"The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings"*; job `Build IPA` không có step nào, không log nào → **chưa một dòng code nào chạy**. Commit patch đã lên repo thành công; GitHub chặn cấp runner ở tầng tài khoản.

**Nguyên nhân:** runner macOS nhân phút Actions ×10; repo PRIVATE gói Free có ~2.000 phút Linux/tháng ≈ 200 phút macOS. Hết phút trong chu kỳ (hoặc thẻ thanh toán fail / spending limit $0) → job bị chặn đúng thông báo trên. Repo PUBLIC được miễn phí phút không giới hạn.

**4 đường sửa (tùy tình huống, không đường nào đụng code app):**
- A. Đổi repo sang **Public** (Settings → General → Danger Zone → Change visibility) → phút miễn phí vô hạn; cân nhắc vì mã nguồn sẽ công khai.
- B. **Self-hosted runner** trên Mac cá nhân có Xcode (Settings → Actions → Runners → New self-hosted runner; config + run trên Mac) → không tốn phút GitHub, repo giữ private. Workflow đã thêm input `runner` (choice: `macos-15` mặc định / `self-hosted`), `runs-on: ${{ inputs.runner || 'macos-15' }}` — push/tag event không đổi hành vi.
- C. Sửa billing: github.com/settings/billing → Payment information (thẻ fail) + Spending limits (nâng hạn mức Actions; overage macOS $0.08/phút); hoặc chờ reset chu kỳ — xem repo → Actions → **Usage** để biết phút đã dùng + ngày reset.
- D. Nâng gói Pro/Team để có thêm phút kèm theo.

**Trạng thái:** build/archive/IPA của run #26 = KHÔNG THỂ verify (job chưa chạy) — NOT VERIFIED giữ nguyên; các fix code vòng trước (tombstone ci-skip + set +e) vẫn đã kiểm chứng 3/3 kịch bản step-thật + suite 327/327. Khi runner thông: Re-run jobs #26 hoặc dispatch mới (chọn runner phù hợp); nếu commit #26 chưa gồm 3 file tombstone thì upload thêm chúng (patch zip có sẵn) kẻo Preflight bắt lại lỗi cũ.

---

## ADDENDUM 8 — NAV GESTURES + PHIM BLACK-SCREEN FIX (build 220 / 2.4.0)

Bối cảnh: IPA build 219 đã cài chạy ổn định trên iPhone iOS 16.5 qua TrollStore (người dùng xác nhận). Ba yêu cầu mới, sửa tối thiểu, không đụng logic phát/video/backend.

**(1) Menu ẩn mặc định + 2 cách gọi lại.** Trạng thái sẵn có giữ nguyên: overlay menu 4 icon KHÔNG tồn tại trong hierarchy khi ẩn (`if showMenu`, `@State showMenu = false`) → nội dung fullscreen edge-to-edge từ lúc mở app, không thể "tự hiện". THÊM cách gọi thứ hai song song long-press: `UIScreenEdgePanGestureRecognizer` cạnh PHẢI trên **UIWindow** (phủ cả tab lẫn sheet). Ổn định ẩn/hiện: `toggleOverlayMenu()` thêm guard `!showingPlayer` (không mở menu vô hình dưới sheet player); mọi đường mở đều idempotent.

**(2) Back bằng vuốt cạnh TRÁI.** Edge-pan `.left` trên window → `handleBackGesture()` đi đúng 1 bước theo thứ tự điều hướng: (a) overlay menu đang hiện → ẩn menu; (b) sheet PlayerView → đóng sheet; (c) webview tab hiện tại còn `canGoBack` → `goBack()` qua `BinTVBackRegistry` (mỗi controller webview TỰ đăng ký closure trả "đã xử lý chưa" — không đoán mò từ ngoài); (d) root → NO-OP tuyệt đối, không thoát app. Mỗi swipe = 1 lần `.began` = tối đa 1 bước.

**(3) PHIM màn hình đen khi quay lại tab — ROOT CAUSE + FIX TẬN GỐC.** `PhimController`/`YouTubeBrowser` là `WKNavigationDelegate` nhưng KHÔNG implement `webViewWebContentProcessDidTerminate(_:)`. Khi rời tab, WKWebView rời window; dưới áp lực bộ nhớ hệ thống kết thúc WebContent process → webview chỉ còn layer ĐEN và KHÔNG tự khôi phục (đúng triệu chứng: mất trạng thái, đen hoàn toàn, không tự hết). Fix chính thức của Apple: implement delegate → `webView.reload()` CHỈ khi process chết (localStorage `.default` còn nguyên nên bootstrap/catalog cache của app.js phục hồi nhanh — không tải nguội). Bổ trợ: `noteTabDidAppear()` = `setNeedsDisplay()` khi tab hiện lại (repaint layer stale/tối, KHÔNG reload). Chuyển tab bình thường không reload → giữ nguyên trạng thái đang xem (trải nghiệm native, đúng yêu cầu). Áp dụng cho cả TUBE (cùng lớp lỗi lifecycle, không đổi logic phát).

**Không xung đột gesture:** cả 2 edge-pan đặt `cancelsTouchesInView = false` + `delaysTouchesBegan = false` (touch giao ngay cho webview/video/scroll; edge-pan chỉ nhận khi ngón bắt đầu trong dải sát mép — cùng triết lý interactive-pop hệ thống); long-press 0.35s và recognizer riêng của webview giữ nguyên văn.

**Version:** 220 / 2.4.0. **Kiểm chứng sandbox:** brace-balance + CJK-scan 3 file sửa; T4.10 (11 assertion) guard toàn bộ cơ chế; suite **338/338 PASS**; preflight canonical mô phỏng rc=0. Compile/archive/IPA trên Xcode thật: **NOT VERIFIED** (sandbox không macOS) — cổng xác nhận GitHub Actions build 220.

---

## ADDENDUM 9 — MENU BAR BIẾN MẤT THẬT SỰ + BACK CẠNH TRÁI + PHIM GIỮ TRẠNG THÁI (build 221 / 2.4.1)

Bối cảnh: người dùng xác nhận IPA 220 chạy ổn trên iPhone iOS 16.5 (TrollStore), nhưng **menu bar (LIVE TV / TUBE / PHIM / SETTING) VẪN HIỆN** và 2 cách gọi menu + Back cạnh trái **chưa hề hoạt động**. Phân tích lại mã nguồn 220 phát hiện lỗi nền tảng (không phải lỗi runtime ngẫu nhiên):

### (1) Root cause "menu bar vẫn hiện" — sai hướng tìm UITabBarController

`TabChromeController` (build 219/220) là `UIViewControllerRepresentable` được gắn ở `.background(...)` của **GeometryReader**, tức là nằm **NGOÀI** `NavigationView`. VC của nó có parent chain đi **NGƯỢC LÊN**: `childVC → root UIHostingController → nil`. Trong khi đó `UITabBarController` (do SwiftUI `TabView` sinh ra) là **HẬU DUỆ** của root — nằm bên trong NavigationView. Vòng lặp

```swift
while let r = responder, !(r is UITabBarController) { responder = r.parent }
```

**vĩnh viễn không gặp nó** → retry 10 lần rồi bỏ cuộc. Hệ quả (đúng 100% triệu chứng người dùng báo):
- `tbc.tabBar.isHidden = true` **KHÔNG BAO GIỜ chạy** → menu bar hiện;
- long-press global + 2 edge-pan nằm **cùng một nhánh `guard let tbc`** → cũng **KHÔNG BAO GIỜ được gắn** → "giữ màn hình" chỉ hoạt động trên TUBE/PHIM nhờ recognizer riêng của webview, còn "vuốt cạnh phải/trái" không tồn tại trong IPA.
- Kể cả khi tìm được, `TabView` vẫn luôn dành một dải inset phía dưới bằng chiều cao bar → nội dung không thể "mở rộng tận dụng phần bị menu bar chiếm".

**Fix (mục tiêu, không vá):** bỏ hẳn `TabView` — 4 trang xếp trong `ZStack` do `ContentView` điều khiển bằng `selectedTab`. Không có `UITabBarController` → **không có menu bar nào để phải ẩn**; nội dung tự lấp toàn bộ màn hình. Menu điều hướng chỉ tồn tại dạng overlay `if showMenu` (mặc định `false` → không có trong hierarchy, 0% chặn touch). `BinTVPage` rawValue 0…3 và 4 trang con giữ nguyên 100% (chỉ thêm tham số `isActive`).

### (2) Gesture gắn thẳng trên UIWindow — không cần tìm TabBar nữa

`BinTVWindowGestures` (UIViewControllerRepresentable) gắn 3 recognizer lên **key `UIWindow`** (tổ tiên của mọi view, phủ cả sheet PlayerView): `BinTVMenuLongPressRecognizer` 0.35s → menu; edge-pan `.right` → menu; edge-pan `.left` → Back. Window chưa sẵn sàng → retry 0.15s × 40. Idempotent (mỗi loại đúng 1 lần, nhận diện bằng lớp con riêng).

**Chống xung đột** (`UIGestureRecognizerDelegate.gestureRecognizer(_:shouldReceive:)`):
| Vùng touch | Quyết định | Lý do |
|---|---|---|
| Trong `WKWebView` (long-press) | **từ chối** | webview đã có recognizer riêng (PHIM 0.35s / TUBE 0.4s) — không huỷ thao tác trang |
| `UIControl` / `UITextInput` | **từ chối** | nhường long-press chọn/paste của hệ thống (ô nhập URL trong Settings) |
| Menu đang mở / player sheet đang mở | **từ chối** | nút menu + điều khiển video phải nhận touch bình thường |
| Edge-pan trong webview có `allowsBackForwardNavigationGestures` (TUBE) | **từ chối** | tránh Back/Next 2 lần cho một cái vuốt |
| Còn lại | nhận | Live TV / Settings / vùng nội dung thường |

`shouldRecognizeSimultaneouslyWith → true`, edge-pan `cancelsTouchesInView = false` + `delaysTouchesBegan = false` → scroll/vuốt/pinch/điều khiển video không bị cướp.

### (3) Back cạnh trái — 5 bước, không bao giờ thoát app

`handleBackGesture()`: (1) menu đang mở → đóng menu; (2) player sheet → đóng sheet; (3) `BinTVBackRegistry.perform(tab:)` → webview `canGoBack` thật mới `goBack()` 1 bước; (4) **MỚI**: lùi về tab trước đó qua `tabHistory` (đúng "màn hình trước đó 1 bước", vẫn còn màn hình trước thì không bao giờ thoát app); (5) root → NO-OP tuyệt đối. Mỗi lần vuốt = 1 lần `.began` = tối đa 1 bước.

### (4) PHIM màn hình đen — xử lý NGUYÊN NHÂN (không che lỗi)

Bản 220 xử lý phần ngọn (`webViewWebContentProcessDidTerminate` → reload) — **giữ nguyên**. Bản 221 triệt tiêu nguyên nhân: với `ZStack` + `mountedTabs`, trang PHIM **không bao giờ bị gỡ khỏi hierarchy** → `WKWebView` không rời window → WebContent process không bị kill do chuyển tab → không đen, và **giữ nguyên trạng thái đang xem** (không reload, trải nghiệm native). Hai lớp bổ trợ: `noteTabDidAppear()` (`setNeedsDisplay()` mỗi lần tab hiện lại) và `restoreIfEmpty()` — **chỉ** nạp lại khi webview thật sự trống (`url == nil`, không đang tải, server có port), tối đa 3 lần, reset khi `didFinish` → không reload bừa, không vòng lặp. Áp dụng tương tự cho TUBE.

### Kiểm chứng (sandbox, không có macOS/Xcode)

- **Swift parse-check bằng toolchain Swift 5.9 thật** (download.swift.org): toàn bộ 16 file nguồn `swiftc -parse` → **0 lỗi cú pháp** (không có UIKit trên Linux nên dừng ở parse, chưa type-check/link).
- **Suite mock-E2E: 430/430 PASS** — T1 40 + T2 55 + T3 53 + T4 211 + **T5 71 (MỚI)**.
  - **T5 (`tests/mock-e2e/test_nav_flow.py`)** = mirror 1:1 state-machine của `ContentView` (menu/Back/mountedTabs/tabHistory) + lifecycle webview + delegate gesture: mở app menu ẩn; long-press & cạnh phải gọi menu; idempotent; không mở dưới sheet; Back 7 nhịp đúng thứ tự (menu → sheet → webview → tab → root no-op, không thoát app); **PHIM ↔ LIVE TV ↔ TUBE ×10 lượt: mount 1 lần, reload 0 lần, webview luôn trong window**; khôi phục khi webview trống (1 lần, tối đa 3, dừng khi server chưa có port/không đang tải).
- **Preflight GitHub Actions**: không thêm file `.swift` mới (chỉ sửa 4 file đã có trong Compile Sources) → check xuôi/ngược disk ↔ Compile Sources vẫn XANH; `yaml.safe_load` workflow VALID, không đụng pipeline.
- **Version:** 221 / 2.4.1 (pbxproj `CURRENT_PROJECT_VERSION` + `MARKETING_VERSION`, Info.plist `CFBundleVersion` / `CFBundleShortVersionString`).
- **NOT VERIFIED (trung thực):** compile/type-check bằng UIKit thật, archive, đóng gói IPA, và test trên iPhone iOS 16.5 — cần Xcode/macOS. Cổng xác nhận: GitHub Actions build 221 + cài qua TrollStore.

---

## ADDENDUM 10 — SỬA LỖI BIÊN DỊCH RUN 221 (xbuild.log thật): "extensions must not contain stored properties"

**Log thật:** `/Users/runner/work/BinTV2/BinTV2/BinTV/Views/MovieListView.swift:673:17: error: extensions must not contain stored properties` → `xcodebuild exit 65` → không có `.xcarchive` → job fail.

**Root cause:** khi thêm safety net `restoreIfEmpty` cho tab TUBE, khai báo `private var restoreAttempts = 0` bị đặt **bên trong `extension YouTubeBrowser`** (block delegate, bắt đầu dòng 631). Swift **cấm** stored property trong extension (chỉ `static`/computed mới được) — đây là lỗi ở bước **type-check**, nên `swiftc -parse` (kiểm chứng ở sandbox) **không thể phát hiện**. Cùng lỗi ở PHIM thì KHÔNG xảy ra vì `restoreAttempts` của `PhimController` được đặt trong thân class.

**Fix:** chuyển khai báo vào **thân `final class YouTubeBrowser`** (ngay sau `private var theaterArmed = true`), giữ nguyên toàn bộ logic (`noteTabDidAppear` tăng/bảo vệ bộ đếm, `didFinish` reset).

**Guard chống tái diễn (MỚI — T4.5b trong `tests/mock-e2e/test_project_consistency.py`):** quét toàn bộ file Swift, xác định **thành viên trực tiếp** của mỗi `extension` (depth == extension_depth + 1, không bắt nhầm biến cục bộ trong thân hàm) và fail nếu có `var/let` không phải `static`/computed. Guard **tự kiểm chứng** bằng cách tạo file probe có lỗi và xác nhận nó bị bắt. Suite: **432/432 PASS**.

**Trung thực:** các lỗi chỉ lộ ở bước type-check/link bằng UIKit thật (không có trên Linux) vẫn cần GitHub Actions làm cổng xác nhận cuối; mỗi lỗi mới lộ ra đều được bổ sung guard tĩnh như trên.

---

## ADDENDUM 11 — BACK CẠNH TRÁI KHÔNG HOẠT ĐỘNG: `UIScreenEdgePanGestureRecognizer` bị hệ thống gate trên UIWindow (build 222 / 2.4.2)

**Triệu chứng thực tế trên máy (iOS 16.5, TrollStore):** giữ màn hình → menu hiện (OK), nhưng **vuốt từ cạnh trái → không có Back**.

**Phân tích:** long-press và edge-pan được gắn bởi CÙNG một hàm `install()` trên UIWindow → long-press chạy được chứng tỏ recognizer đã được gắn thành công. Vậy lỗi nằm ở **bản thân `UIScreenEdgePanGestureRecognizer`**: iOS gắn sẵn các recognizer "gate" vùng mép ngay trên `UIWindow` (system gesture gate), và chúng được ưu tiên nhận touch sát mép màn hình. Khi app gắn thêm `UIScreenEdgePanGestureRecognizer` lên window, recognizer của app thường **không bao giờ chuyển sang trạng thái began** — đúng triệu chứng: gesture không phải-edge (long-press) vẫn sống, gesture sát-mép thì chết. Đây là giới hạn đã biết của iOS khi dùng edge recognizer ở cấp window; các app thường gắn nó trên **view của view controller**, nhưng lúc đó lại không phủ được sheet (lý do bản 221 chọn window).

**Fix (bỏ phụ thuộc vào recognizer nội bộ):** thay bằng `BinTVEdgeSwipeRecognizer: UIPanGestureRecognizer` + **tự phát hiện vùng mép**:
- `.began`: ghi toạ độ X bắt đầu; cập nhật dải mép theo bề rộng màn hình hiện tại; reset cờ.
- `.changed`: kích hoạt khi **vuốt NGANG** (`|x| ≥ 45pt` và `|x| > |y|·1.5`), điểm bắt đầu nằm trong dải mép (`startX ≤ edgeZone` với cạnh trái / `startX ≥ width − edgeZone` với cạnh phải) và đúng hướng (`x > 0` = Back, `x < 0` = hiện menu).
- `edgeZone = min(max(width × 0.09, 30), 70)` pt — tự co theo máy (932pt → 70pt; 568pt → 51pt; 430pt → 39pt).
- `hasFired` đảm bảo **mỗi lần vuốt kích hoạt đúng 1 lần**; reset ở `.ended/.cancelled/.failed`.
- Giữ nguyên ưu điểm của bản 221 (gắn trên window → phủ cả sheet player) nhưng không còn bị gate: pan thường **không** nằm trong nhóm bị hệ thống giữ quyền ưu tiên ở mép.
- Thêm: `resolveWindow()` ưu tiên giữ window đã gắn lần đầu (tránh gắn nhầm window tạm thời của WebKit/AVKit fullscreen, vì window đó cũng có thể là key window); gắn lại recognizer khi `didBecomeActive`.
- **Root Back**: không thoát app, không đổi giao diện — chỉ rung nhẹ để xác nhận thao tác đã được nhận (giúp phân biệt "vuốt chưa tới" và "hết chỗ để Back").

**Kiểm chứng:**
- `swiftc -parse` 20/20 file: sạch. Type-check phần gesture bằng Swift 5.9 thật + stub UIKit: **PASS** (chỉ bỏ API `NotificationCenter.addObserver(selector:)` khi check vì Linux không có ObjC interop — API chuẩn trên iOS).
- Guard stored-property-trong-extension (T4.5b): CLEAN (lỗi exit 65 của run trước không thể tái diễn).
- Suite: **462/462 PASS** — T4.10 có 12 assertion mới cho bộ máy vuốt mép; **T5.5 (18 assertion)** mô phỏng chính xác `handleEdgeSwipe`: Back đúng 1 lần/lần vuốt, không fire khi vuốt dọc / giữa màn hình / sai hướng / chưa đủ 45pt, vuốt phải hiện menu đúng 1 lần, dải mép tự co theo 3 cỡ màn hình.
- **NOT VERIFIED:** test trên máy thật (không có thiết bị) — cổng xác nhận: build 222 trên GitHub Actions, cài qua TrollStore, vuốt từ mép trái (cách mép ≤ ~70pt, vuốt ngang ≥ ~45pt).
