# BinTV iOS — TrollStore Build (FIXED)

## Build by GitHub Actions

1. Upload this repository to GitHub
2. Go to **Actions** → **"Build unsigned IPA (TrollStore)"**
3. Click **Run workflow** (defaults: Xcode mặc định, Release, mode `archive`)
4. Wait for the job to finish
5. Download artifact **`BinTV-trollstore-unsigned`** — bên trong là **`BinTV.ipa`**

Nếu build thất bại:
- Mở trang **Job summary** — 15 dòng `error:` gần nhất được in sẵn ở đó.
- Tải artifact **`BinTV-build-log`** để xem `xcodebuild.log` đầy đủ.
- Buoc **Preflight** chặn sớm các lỗi phổ biến: file Swift thiếu trong
  Compile Sources, UUID rác trong pbxproj, scheme chỉ đến target sai,
  Info.plist/bundle ID không đọc được.

## What was fixed (ban FIXED)

- `BinTV.xcscheme`: `BlueprintIdentifier` trỏ sai UUID target →
  `xcodebuild -scheme BinTV` lỗi ngay bước đầu. Đã trỏ đúng target `BinTV`.
- `project.pbxproj`: kiểm tra lại đầy đủ — 12 file Swift trong Compile
  Sources, không UUID treo, `AppDelegate.swift` cố ý KHÔNG build (trùng
  khai báo với `App.swift`, đánh dấu `ci-skip`).
- `StreamService.swift`: bỏ `@MainActor` (gây lỗi khởi tạo ở một số
  phiên bản Swift), các cập nhật `@Published` chuyển về MainActor bằng
  `MainActor.run` — giữ nguyên hành vi UI.
- `import Combine` bổ sung cho `StreamService`, `NetworkService`,
  `AVPlayerManager` (cần cho `ObservableObject`/`@Published`).
- `Info.plist`: thêm `UILaunchScreen`, bỏ 2 key rác
  (`UITabBarController`, `UIViewControllerBasedStatusBarAppearance`).
- `Assets.xcassets`: thêm `Contents.json` gốc; resize 8 icon AppIcon về
  đúng kích thước chuẩn (40/60/58/87/80/120/120/180) — actool không nhận
  icon 1024 cho tất cả các slot.
- `PlayerView.swift`: keypath `\.self` chuẩn hóa.
- Workflow: `archive` mặc định (tạo `.xcarchive`), `set -o pipefail` +
  `PIPESTATUS` (tee không còn che exit code), kiểm tra `.xcarchive`,
  tìm `.app` thật bằng `find`, tạo `BinTV.ipa`, kiểm tra IPA sâu
  (Payload/*.app, Info.plist, executable +x, Mach-O arm64/arm64e iOS,
  không có file `._`), upload IPA + build log artifact.

## Install with TrollStore

1. Transfer `BinTV.ipa` to your iPhone
2. Open TrollStore
3. Tap `BinTV.ipa`
4. Install → Done
5. Open BinTV from home screen

## Install with TrollStore

1. Transfer `BinTV.ipa` to your iPhone
2. Open TrollStore
3. Tap `BinTV.ipa`
4. Install → Done
5. Open BinTV from home screen

## Project Structure

- `BinTV/App/` — App entry and delegate
- `BinTV/Views/` — SwiftUI screens (Live TV, Player, Settings, Movies)
- `BinTV/Models/` — Channel / Stream data models
- `BinTV/Services/` — Network and stream loading
- `BinTV/Player/` — AVPlayer management
- `BinTV/Subtitle/` — WebVTT subtitle loader
- `BinTV/Storage/` — UserDefaults preferences
- `BinTV/Assets.xcassets/` — App icons from BinTV.png
- `.github/workflows/build-ipa.yml` — CI pipeline

## Note

This port maintains the original BinTV functionality for iOS: live TV streams, multi-server selection, video playback, subtitle support, and no-login access. Exact stream endpoints should be verified from the original APK API responses if needed; default network layer uses configurable base URL.

---

## Fix 2026-09-12 (build 217) — Landscape lock + PHIM playback restored

Two targeted fixes on top of the existing port (no rewrite, no new dependencies,
web assets untouched byte-for-byte):

1. **Playback (root cause):** `WKWebViewConfiguration.allowsInlineMediaPlayback = true`
   was missing (default `false` on iPhone) — WebKit ignored the `playsinline`
   attribute and hijacked `<video>` into a native fullscreen player that cannot
   render hls.js/MSE content, producing "Không thể phát nguồn phim này trên TV".
   Set before `WKWebView(frame:configuration:)` init in `BinTV/Phim/PhimWebView.swift`,
   plus a passive `[PHIM_DEBUG]` media-event observer for on-device verification.
2. **Orientation (3 layers):** Info.plist landscape-only for iPhone **and iPad**,
   new per-window `application(_:supportedInterfaceOrientationsFor:) -> .landscape`
   in `AppDelegate` (clamps WebKit/AVKit fullscreen windows, sheets, alerts), and
   hardened geometry requests (never portrait, both landscape directions, correct
   `UIDeviceOrientation` KVC domain on iOS 15). Independent of Rotation Lock by design.

Also: structured `[PHIM_DEBUG] Step -> Action -> Status -> Payload` logging with
token sanitization across `PhimLocalServer`/`PhimWebView`; build number 216 → 217.

- Full technical report (Vietnamese): `BAOCAO-KYTHUAT-FIX-2026-09-12.md`
- Mock E2E test suite (Node ≥18 / Python ≥3.9, no extra deps): `cd tests/mock-e2e && node run_all.js` — 244/244 assertions pass (T1 real app.js slices, T2 m3u8 rewrite port, T3 live-HTTP proxy chain with Referer-gated mock CDN, T4 project consistency).

## Fix UI 2026-09-12 (build 218) — Tabbed Browser UI + Adaptive Scaling

- Browser-style tab strip on top (open/close/select tabs, "+" → New Tab
  Page speed-dial icon grid); closing a tab only detaches it from the
  strip — the 4 underlying pages stay alive in the same TabView (tags
  0…3), so playback/state is never destroyed.
- Long-press ≥0.35s (unchanged gesture plumbing) now toggles the tab
  strip for immersive video; a small top grabber restores it.
- All app-drawn chrome scales via `UIProportions` (env `\.uiProps`):
  scale = clamp(landscapeHeight/390, 0.82, 1.15) — iPhone SE … Pro Max …
  iPad. Removed hard-coded 230pt Settings column, 40×40 TUBE buttons,
  140pt grid minimum.
- New files: `Views/{UIProportions,BrowserTabs,BrowserTabBar,NewTabPageView}.swift`
  (registered in pbxproj). Orientation lock & playback fix untouched.
- Version 217 → 218, MARKETING_VERSION 2.1.6 → 2.2.0. Test suite now
  310/310 (see `tests/mock-e2e/`).

## Fix UI 2026-09-12 (build 219) — Fullscreen + Long-press Overlay Menu

- Removed the top browser tab strip (build 218) and kept the system bottom
  tab bar permanently hidden: content now fills the screen edge-to-edge
  (no nav bar, 0 spacing top/bottom).
- Navigation: long-press ≥0.35s anywhere → blurred fullscreen overlay
  (`.ultraThinMaterial` + dim) with 4 ICON-ONLY buttons (tv / film /
  popcorn / gear — no text labels, VoiceOver labels only). Tap an icon →
  switches page instantly and dismisses; tap backdrop → dismiss only.
- Gesture plumbing unchanged (proven UIKit recognizers: global on
  UITabBarController + per-webview on TUBE/PHIM; no SwiftUI
  onLongPressGesture → no scroll/tap/video-control conflicts).
- Removed files: `Views/BrowserTabs.swift`, `Views/BrowserTabBar.swift`,
  `Views/NewTabPageView.swift` (also de-registered from pbxproj).
  Added: `Views/GestureOverlayMenuView.swift`.
- Adaptive scaling (build 218) retained; overlay metrics scale SE…iPad.
- Version 218 → 219, MARKETING_VERSION 2.2.0 → 2.3.0. Tests: 302/302.

## Preflight CI fix 2026-09-12 (no app version change — still 219/2.3.0)

- Root cause of the GitHub Actions failure at step `Preflight (pbxproj +
  scheme vs source files)`: repo still contained the three deprecated
  build-218 files (`BrowserTabs/BrowserTabBar/NewTabPageView.swift`)
  while the new pbxproj no longer registers them → preflight error
  "3 file .swift/.m KHONG nam trong Compile Sources". Fix = DELETE those
  three files on GitHub (zip patches cannot express deletions — see
  `PREFLIGHT-FIX-INSTRUCTIONS.txt` inside the preflight patch zip).
- Preflight hardened (workflow): new two-way check 2.1b — every
  Compile Sources entry must exist on disk (catches the mirrored case
  "Build input file cannot be found" BEFORE xcodebuild wastes minutes);
  actionable fix hints printed for both failure directions; still
  `sys.exit(rc)` — no error masking.
- Tests: new T4.9 guards the CI gate itself. Suite now 314/314.

## xbuild.log 2026-09-12 (workflow only — still 219/2.3.0)

- Every run now produces ONE consolidated log: `build/Output/xbuild.log`,
  uploaded as artifact **`xbuild-log`** (`if: always()`) — including runs
  that fail early at Detect/Preflight (the old `xcodebuild.log` was only
  created at the Build step, so early failures had no downloadable log).
- New `Init xbuild.log` step right after checkout writes a header (UTC
  time, run URL, ref/sha, inputs, runner). Each script step is wrapped:
  `{ ... } 2>&1 | tee -a "$XLOG"` + `exit "${PIPESTATUS[0]}"` with a
  `[STEP END] <name> exit=N` marker — real exit codes preserved (bash
  3.2-safe, no error masking).
- Build step runs xcodebuild directly (`RC=$?`); its full output flows
  into xbuild.log through the wrapper. Job summary + failure printer now
  read xbuild.log. Tests: 318/318 (T4.9 guards the logging pipeline).

## IPA build fix 2026-09-12 (from real xbuild.log, run 34690803983)

- Root cause of the failed run: repo still carried the three deprecated
  build-218 files while pbxproj 219 no longer registers them → Preflight
  correctly failed (`3 file ... KHONG nam trong Compile Sources`).
- Fix without manual deletion: the three files are replaced by TOMBSTONES
  (comment-only, zero code) whose first line is `// ci-skip: DEPRECATED
  build 219 ...` — the workflow's own documented intentional-exclusion
  mechanism, printed transparently in every log. Delete them for real
  whenever convenient; the build does not change.
- Workflow wrapper fix found via the real log: GitHub runs `shell: bash`
  as `bash -eo pipefail`, which aborted failing steps BEFORE the
  `[STEP END]` marker; added `set +e` around the tee pipelines (real
  exit codes still returned) and around `xcodebuild` (RC capture).
- Tests: 326/326. xcodebuild/archive/IPA on a real runner: NOT VERIFIED
  from this sandbox — the next Actions run is the gate.

## Nav gestures + PHIM black-screen fix 2026-09-12 (build 220 / 2.4.0)

- Menu stays hidden by default (fullscreen); second reveal gesture added:
  swipe in from the RIGHT screen edge (parallel to long-press). Menu can
  no longer open invisibly under the player sheet.
- Swipe in from the LEFT edge = Back exactly one step, in navigation
  order: overlay menu -> player sheet -> webview history (canGoBack) ->
  no-op at root (never quits the app).
- PHIM black screen after tab switching: root cause = missing
  `webViewWebContentProcessDidTerminate` (terminated WebContent process
  leaves a permanently black WKWebView). Fixed with the official delegate
  (reload ONLY on process death; localStorage cache survives) plus a
  `setNeedsDisplay()` repaint on tab re-appear (no needless reload, state
  preserved). Same lifecycle fix applied to TUBE's webview.
- New gestures use cancelsTouchesInView=false / delaysTouchesBegan=false:
  video controls, scrolling and web taps unaffected. Tests: 338/338.
