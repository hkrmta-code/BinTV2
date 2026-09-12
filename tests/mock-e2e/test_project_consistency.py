#!/usr/bin/env python3
# =====================================================================
# test_project_consistency.py (T4) — KIỂM TRA TĨNH tính nhất quán của
# BinTV-Fixed trước khi đẩy lên GitHub Actions build IPA:
#   1. pbxproj ↔ đĩa: mọi .swift (trừ AppDelegate stub) có fileRef + nằm
#      trong Sources phase; AppDelegate KHÔNG bị build; tài nguyên
#      (Assets/Storyboard/Web/Info.plist) đủ; Web là folder reference.
#   2. Info.plist ↔ pbxproj: CFBundleVersion == CURRENT_PROJECT_VERSION;
#      landscape-only cả iPhone lẫn iPad; UIRequiresFullScreen;
#      NSAllowsLocalNetworking (server 127.0.0.1).
#   3. Fix playback tồn tại & ĐÚNG THỨ TỰ: allowsInlineMediaPlayback=true
#      TRƯỚC WKWebView(frame:configuration:); mediaTypes...= [];
#      playerObserverJS được add; isInspectable trong #if DEBUG.
#   4. Fix orientation tồn tại: AppDelegate supportedInterfaceOrientationsFor
#      → .landscape; KVC dùng UIDeviceOrientation; PlayerView/MovieListView
#      không còn request .portrait; mask đủ 2 hướng landscape.
#   5. Mọi file .swift cân bằng brace/paren/bracket (string/comment-aware).
#   6. Mọi JS trong Web/assets + index.html references tồn tại (node --check).
#   7. xcscheme trỏ đúng UUID native target; workflow build-ipa.yml tồn tại.
# =====================================================================
import os, re, sys, json, plistlib, subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PBX = os.path.join(ROOT, "BinTV.xcodeproj", "project.pbxproj")
PLIST = os.path.join(ROOT, "BinTV", "Info.plist")
SCHEME = os.path.join(ROOT, "BinTV.xcodeproj", "xcshareddata", "xcschemes", "BinTV.xcscheme")
WORKFLOW = os.path.join(ROOT, ".github", "workflows", "build-ipa.yml")
WEB = os.path.join(ROOT, "BinTV", "Phim", "Web")

passed = failed = 0
fails = []
def ok(cond, name, detail=""):
    global passed, failed
    if cond: passed += 1; print("  [PASS] " + name)
    else: failed += 1; fails.append(name + (" :: " + detail if detail else "")); print("  [FAIL] " + name + ((" :: " + detail) if detail else ""))
def eq(a, b, name): ok(a == b, name, f"expected={b!r} actual={a!r}")

pbx = open(PBX, encoding="utf-8").read()
plist = plistlib.load(open(PLIST, "rb"))

print("\n=== T4.1 — pbxproj ↔ đĩa ===")
swift_on_disk = []
for dirpath, _, files in os.walk(os.path.join(ROOT, "BinTV")):
    for f in files:
        if f.endswith(".swift"):
            swift_on_disk.append(os.path.relpath(os.path.join(dirpath, f), ROOT))
def _ci_skip(rel):
    """Đúng cơ chế của Preflight trong build-ipa.yml: '// ci-skip:' trong 6 dòng đầu."""
    head6 = open(os.path.join(ROOT, rel), encoding="utf-8", errors="replace").read().splitlines()[:6]
    return any("ci-skip:" in l for l in head6)
# File ci-skip (AppDelegate stub + 3 tombstone khai tử build 219) KHÔNG bắt buộc
# đăng ký pbxproj — chúng bị loại khỏi biên dịch CÓ CHỦ ĐÍCH, log in minh bạch.
built_swift = [p for p in swift_on_disk if not _ci_skip(p)]
skipped_swift = sorted(p for p in swift_on_disk if _ci_skip(p))
ok(all(os.path.basename(p) in ("AppDelegate.swift", "BrowserTabs.swift",
                               "BrowserTabBar.swift", "NewTabPageView.swift")
       for p in skipped_swift),
   "ci-skip chỉ áp dụng cho: AppDelegate stub + 3 tombstone khai tử (whitelist chặt)",
   str(skipped_swift))
for p in built_swift:
    name = os.path.basename(p)
    inref = re.search(r"isa = PBXFileReference;[^;]*; path = " + re.escape(name), pbx) or (name + " */" in pbx and "PBXFileReference" in pbx)
    ok(name in pbx and "PBXFileReference" in pbx, f"fileRef tồn tại: {p}")
    ok(re.search(re.escape(name) + r" in Sources", pbx) is not None, f"trong Sources phase: {name}")
ok("AppDelegate.swift" not in pbx, "AppDelegate stub KHÔNG nằm trong pbxproj (không bị build — tránh trùng @main)")
for res, kind in [("Assets.xcassets", "folder.assetcatalog"), ("Main.storyboard", "file.storyboard"), ("Web", "folder"), ("Info.plist", "text.plist.xml")]:
    ok(res in pbx, f"tài nguyên có trong pbxproj: {res}")
ok(re.search(r"path = Web;\s*sourceTree", pbx) is not None or "Web /* Web */" in pbx, "Web được reference")
ok(os.path.isdir(WEB), "thư mục Web tồn tại trên đĩa (folder reference → copy vào bundle)")
ok(re.search(r"isa = PBXResourcesBuildPhase", pbx) is not None, "có Resources build phase")
ok("Web in Resources" in pbx, "Web nằm trong Resources phase")

print("\n=== T4.2 — Info.plist ↔ pbxproj ===")
eq(plist["CFBundleVersion"], "220", "CFBundleVersion = 220 (bản Nav Gestures + PHIM fix)")
cv = re.findall(r"CURRENT_PROJECT_VERSION = (\d+);", pbx)
ok(len(cv) == 2 and all(v == "220" for v in cv), f"CURRENT_PROJECT_VERSION=220 cả 2 config (Debug/Release)", str(cv))
eq(plist["CFBundleShortVersionString"], re.findall(r"MARKETING_VERSION = ([\d.]+);", pbx)[0], "CFBundleShortVersionString khớp MARKETING_VERSION")
eq(sorted(plist["UISupportedInterfaceOrientations"]),
   sorted(["UILandscapeLeftInterfaceOrientation", "UILandscapeRightInterfaceOrientation"]),
   "iPhone: landscape-only (2 hướng)")
eq(sorted(plist["UISupportedInterfaceOrientations~ipad"]),
   sorted(["UILandscapeLeftInterfaceOrientation", "UILandscapeRightInterfaceOrientation"]),
   "iPad: landscape-only (key ~ipad tường minh)")
ok(plist["UIRequiresFullScreen"] is True, "UIRequiresFullScreen = true")
ok(plist["NSAppTransportSecurity"].get("NSAllowsLocalNetworking") is True, "ATS: NSAllowsLocalNetworking (server Phim 127.0.0.1)")

print("\n=== T4.3 — Fix playback (PhimWebView.swift) ===")
pw = open(os.path.join(ROOT, "BinTV", "Phim", "PhimWebView.swift"), encoding="utf-8").read()
i_inline = pw.find("allowsInlineMediaPlayback = true")
i_init = pw.find("WKWebView(frame:")
ok(i_inline >= 0, "có allowsInlineMediaPlayback = true")
ok(i_init >= 0, "có WKWebView(frame:configuration:)")
ok(0 <= i_inline < i_init, "allowsInlineMediaPlayback set TRƯỚC khi init WKWebView (Apple: config chỉ áp lúc init)")
ok("mediaTypesRequiringUserActionForPlayback = []" in pw, "mediaTypesRequiringUserActionForPlayback = [] (autoplay)")
ok("playerObserverJS" in pw and "addUserScript" in pw, "playerObserverJS được đăng ký user script")
i_obs = pw.find("Self.playerObserverJS")
ok(0 <= i_obs < i_init, "playerObserverJS add TRƯỚC init WebView")
ok(re.search(r"#if DEBUG[\s\S]*?isInspectable[\s\S]*?#endif", pw) is not None, "isInspectable nằm trong #if DEBUG (không đổi hành vi release)")
ok("PhimDebugLog.step(\"WEBVIEW\"" in pw, "log WEBVIEW dùng format chuẩn [PHIM_DEBUG]")

print("\n=== T4.4 — Fix orientation (3 lớp) ===")
app = open(os.path.join(ROOT, "BinTV", "App", "App.swift"), encoding="utf-8").read()
ok("supportedInterfaceOrientationsFor" in app, "lớp 2: AppDelegate có application(_:supportedInterfaceOrientationsFor:)")
m = re.search(r"supportedInterfaceOrientationsFor[\s\S]{0,200}?return \.landscape\b", app)
ok(m is not None, "lớp 2: mask trả về .landscape (mọi window, kể cả fullscreen video)")
ok("UIDeviceOrientation.landscapeLeft.rawValue" in app, "KVC iOS-15 dùng UIDeviceOrientation (đúng domain)")
ok(re.search(r"setValue\(UIDeviceOrientation\.landscapeLeft\.rawValue", app) is not None, "code KVC thực sự: setValue(UIDeviceOrientation.landscapeLeft.rawValue, ...)")
bad_kvc_code = [ln for ln in app.splitlines()
                if "setValue(UIInterfaceOrientation" in ln and not ln.strip().startswith(("//", "///", "*"))]
ok(len(bad_kvc_code) == 0, "không còn DÒNG CODE KVC sai domain (chỉ được phép nhắc trong comment tài liệu)", str(bad_kvc_code))
for vf in ["Views/PlayerView.swift", "Views/MovieListView.swift"]:
    src = open(os.path.join(ROOT, "BinTV", vf), encoding="utf-8").read()
    fn = re.search(r"func setInterfaceLandscape[\s\S]*?\n    \}", src)
    ok(fn is not None, f"{vf}: còn setInterfaceLandscape")
    body = fn.group(0) if fn else ""
    ok("guard landscape else" in body or ".portrait" not in body, f"{vf}: KHÔNG còn request .portrait (TV-mode luôn landscape)")
    ok(".landscapeLeft, .landscapeRight" in body or "landscapeLeft, .landscapeRight" in body, f"{vf}: mask đủ 2 hướng landscape (chống lật 180° khi đang LandscapeRight)")

print("\n=== T4.4b — Regression guard lỗi biên dịch CI 2026-09-12 (Xcode 16.4) ===")
# Lỗi thật từ log xcodebuild: "initializer for conditional binding must have
# Optional type, not 'any Error'" tại App.swift:150 + PhimWebView.swift:508 —
# errorHandler của requestGeometryUpdate nhận `any Error` KHÔNG Optional.
# QUÉT TRÊN CODE (đã strip các dòng comment bắt đầu bằng //) — comment tài
# liệu trong Swift được phép nhắc lại phrase lỗi để giải thích.
def strip_comment_lines(src):
    return "\n".join(ln for ln in src.splitlines() if not ln.strip().startswith("//"))
app_code = strip_comment_lines(app)
pw_code = strip_comment_lines(pw)
ok("if let error = error" not in app_code, "App.swift (code): không còn `if let error = error` trong errorHandler requestGeometryUpdate")
ok("if let error = error" not in pw_code, "PhimWebView.swift (code): không còn `if let error = error` trong errorHandler requestGeometryUpdate")
for p in swift_on_disk:
    s = strip_comment_lines(open(os.path.join(ROOT, p), encoding="utf-8").read())
    bad = re.search(r"requestGeometryUpdate[^\n]*\{\s*error\s*in[^}]*?if let error", s)
    ok(bad is None, f"{p}: mọi handler requestGeometryUpdate dùng `error` trực tiếp (không optional-binding)")
# PhimLocalServer ĐƯỢC PHÉP có `if let error = error` vì nằm trong
# didCompleteWithError(error: Error?) — optional thật; xác nhận đúng ngữ cảnh:
pls = open(os.path.join(ROOT, "BinTV", "Phim", "PhimLocalServer.swift"), encoding="utf-8").read()
pls_code = strip_comment_lines(pls)
n_pls = len(re.findall(r"if let error = error", pls_code))
for m in re.finditer(r"if let error = error", pls_code):
    prefix = pls_code[:m.start()]
    fn = prefix.rfind("func urlSession")
    ok(fn >= 0 and "didCompleteWithError error: Error?" in prefix[fn:],
       "PhimLocalServer.swift: `if let error = error` nằm trong didCompleteWithError (Error? — hợp lệ)")
ok(n_pls >= 1, "PhimLocalServer.swift: guard error urlsession vẫn còn (không bị xóa nhầm)")

print("\n=== T4.5 — Swift brace balance (string/comment-aware) ===")
def balance(path):
    s = open(path, encoding="utf-8").read()
    stack = []; i = 0; n = len(s)
    pairs = {"}": "{", ")": "(", "]": "["}
    while i < n:
        c = s[i]; nxt = s[i+1] if i+1 < n else ""
        if c == "/" and nxt == "/":
            j = s.find("\n", i); i = n if j < 0 else j; continue
        if c == "/" and nxt == "*":
            j = s.find("*/", i+2); i = n if j < 0 else j+2; continue
        if c == '"':
            if s.startswith('"""', i):
                j = s.find('"""', i+3); i = n if j < 0 else j+3; continue
            i += 1
            while i < n:
                if s[i] == "\\": i += 2; continue
                if s[i] == '"': i += 1; break
                i += 1
            continue
        if c in "{([": stack.append(c)
        elif c in "})]":
            if not stack or stack[-1] != pairs[c]: return False, f"mismatch {c} at {i}"
            stack.pop()
        i += 1
    return (not stack), f"còn mở: {stack[-5:]}"
for p in swift_on_disk:
    good, why = balance(os.path.join(ROOT, p))
    ok(good, f"balance OK: {p}", why)

print("\n=== T4.6 — Web assets: JS hợp lệ + index.html references tồn tại ===")
assets_dir = os.path.join(WEB, "assets")
js_files = [f for f in sorted(os.listdir(assets_dir)) if f.endswith(".js")]
for js in js_files:
    r = subprocess.run(["node", "--check", os.path.join(assets_dir, js)], capture_output=True, text=True)
    ok(r.returncode == 0, f"node --check: assets/{js}", r.stderr.splitlines()[-1] if r.stderr else "")
idx = open(os.path.join(WEB, "index.html"), encoding="utf-8").read()
refs = re.findall(r'(?:src|href)="([^"]+)"', idx)
for r0 in refs:
    ref = r0.split("?")[0]
    if ref.startswith(("http://", "https://", "//", "data:")): continue
    ok(os.path.exists(os.path.join(WEB, ref)), f"index.html ref tồn tại: {ref}")

print("\n=== T4.7 — scheme + workflow ===")
sch = open(SCHEME, encoding="utf-8").read()
m = re.search(r'BlueprintIdentifier = "([0-9A-F]+)"', sch)
ok(m is not None and "isa = PBXNativeTarget;" in pbx, "scheme BlueprintIdentifier + native target tồn tại")
ok(m is not None and (m.group(1) in pbx), f"scheme trỏ UUID target có trong pbxproj ({m.group(1) if m else '?'})")
ok(os.path.exists(WORKFLOW), ".github/workflows/build-ipa.yml tồn tại (GitHub Actions build IPA)")
wf = open(WORKFLOW, encoding="utf-8").read() if os.path.exists(WORKFLOW) else ""
ok("xcodebuild" in wf, "workflow dùng xcodebuild")

print("\n=== T4.8 — Fullscreen + Long-press Overlay Menu (FIX UI build 219) ===")
views_dir = os.path.join(ROOT, "BinTV", "Views")
cvsrc = open(os.path.join(views_dir, "ContentView.swift"), encoding="utf-8").read()
# (a) File khai tử: KHÔNG còn trên đĩa + KHÔNG còn tham chiếu trong pbxproj
#     (fileRef mồ côi → xcodebuild báo lỗi missing file ngay bước đầu)
for dead in ["BrowserTabs.swift", "BrowserTabBar.swift", "NewTabPageView.swift"]:
    dp = os.path.join(views_dir, dead)
    if os.path.exists(dp):
        # Trạng thái TOMBSTONE (fix 2026-09-12 lần 2): file chỉ còn comment +
        # marker '// ci-skip:' trong 6 dòng đầu — cơ chế loại trừ chủ đích của
        # Preflight (CACH SUA 3), in minh bạch ra xbuild.log. Không chứa code
        # nên kể cả bị đăng ký nhầm vào Sources vẫn biên dịch được (file rỗng).
        dsrc = open(dp, encoding="utf-8").read()
        head6 = dsrc.splitlines()[:6]
        is_tomb = (any("ci-skip:" in l for l in head6)
                   and all((not l.strip()) or l.strip().startswith("//") for l in dsrc.splitlines()))
        ok(is_tomb, f"Views/{dead}: tombstone ci-skip hợp lệ (marker ≤6 dòng đầu, toàn file chỉ comment)")
    else:
        ok(True, f"đã khai tử hẳn trên đĩa: Views/{dead}")
    ok(dead not in pbx, f"pbxproj sạch tham chiếu: {dead} (không fileRef mồ côi)")
# (b) File mới tồn tại + đăng ký đủ 4 vị trí pbxproj
gom_path = os.path.join(views_dir, "GestureOverlayMenuView.swift")
ok(os.path.exists(gom_path), "file mới tồn tại: Views/GestureOverlayMenuView.swift")
ok("GestureOverlayMenuView.swift" in pbx and re.search(r"GestureOverlayMenuView\.swift in Sources", pbx) is not None,
   "GestureOverlayMenuView.swift đăng ký pbxproj + Sources phase")
gsrc = open(gom_path, encoding="utf-8").read()
ok(".ultraThinMaterial" in gsrc, "overlay nền blur .ultraThinMaterial (yêu cầu BƯỚC 2)")
ok("Text(" not in gsrc, "KHÔNG có nhãn văn bản hiển thị — icon-only tuyệt đối")
ok("ForEach(BinTVPage.allCases)" in gsrc and "Image(systemName: page.icon)" in gsrc
   and all(sym in gsrc for sym in ['"tv"', '"film"', '"popcorn"', '"gear"']),
   "4 nút icon SF Symbols data-driven (tv/film/popcorn/gear qua ForEach allCases)")
ok("enum BinTVPage" in gsrc and "case liveTV = 0" in gsrc and "case settings = 3" in gsrc,
   "BinTVPage rawValue = tag TabView cũ (0…3) — semantics điều hướng bảo tồn")
ok("accessibilityLabel" in gsrc, "VoiceOver label (a11y, không phải nhãn hiển thị)")
ok("@Binding var selectedTab" in gsrc and "@Binding var isPresented" in gsrc, "overlay điều khiển qua binding (không state riêng)")
ok("ignoresSafeArea" in gsrc, "nền blur phủ tràn viền; hàng icon trong safe area (Rule 1)")
# (c) ContentView: shell fullscreen mới, sạch chrome cũ
cvsrc_code = strip_comment_lines(cvsrc)   # quét CODE — comment tài liệu được phép nhắc tên chrome cũ để giải thích
ok("BrowserTabBar" not in cvsrc_code and "NewTabPageView" not in cvsrc_code
   and "stripGrabber" not in cvsrc_code and "stripVisible" not in cvsrc_code,
   "ContentView (code) sạch chrome cũ (strip/NTP/grabber)")
ok("GestureOverlayMenuView(selectedTab:" in cvsrc, "overlay menu gắn trong ContentView")
ok("if showMenu" in cvsrc, "overlay chỉ trong hierarchy khi hiện (ẩn = 0% chặn touch)")
ok("TabChromeController" in cvsrc and "BinTVMenuLongPressRecognizer" in cvsrc,
   "gesture plumbing UIKit CŨ giữ nguyên văn (không xung đột tap/scroll)")
ok("toggleOverlayMenu" in cvsrc, "long-press → mở overlay menu")
ok("minimumPressDuration = 0.35" in cvsrc and "delaysTouchesBegan = false" in cvsrc,
   "recognizer 0.35s + delaysTouchesBegan=false (Rule 3: mượt, không trễ touch)")
ok(".navigationBarHidden(true)" in cvsrc, "nav bar hệ thống ẩn — fullscreen edge-to-edge")
ok(cvsrc.count(".tag(BinTVPage.") == 4, "TabView giữ đúng 4 tag 0…3")
ok("tabBar.isHidden = true" in cvsrc, "bottom menu bar vẫn bị ẩn VĨNH VIỄN (yêu cầu gỡ bar dưới)")
ok(".navigationViewStyle(.stack)" in cvsrc, "NavigationView stack — không split 2 cột iPad")
ok("UIProportions(size: geo.size)" in cvsrc and ".environment(\\.uiProps" in cvsrc, "scaling \u005c.uiProps giữ từ build 218")
# (d) UIProportions có metrics overlay
propsrc = open(os.path.join(views_dir, "UIProportions.swift"), encoding="utf-8").read()
ok("menuIconSide" in propsrc and "menuGlyphFont" in propsrc and "menuSpacing" in propsrc,
   "UIProportions: metrics nút overlay scale theo máy")
# (e) 3 trang nội dung + orientation KHÔNG bị refactor đụng tới
ltsrc = open(os.path.join(views_dir, "LiveTVView.swift"), encoding="utf-8").read()
stsrc = open(os.path.join(views_dir, "SettingsView.swift"), encoding="utf-8").read()
mlsrc = open(os.path.join(views_dir, "MovieListView.swift"), encoding="utf-8").read()
ok("props.gridItemMin" in ltsrc, "LiveTVView scaling giữ nguyên (build 218)")
ok("props.settingsColumnWidth" in stsrc, "SettingsView scaling giữ nguyên (build 218)")
ok("props.controlButtonSide" in mlsrc and "setInterfaceLandscape" in mlsrc, "MovieListView scaling + orientation giữ nguyên")
ok("supportedInterfaceOrientationsFor" in app and "allowsInlineMediaPlayback = true" in pw,
   "orientation 3 lớp + playback fix KHÔNG bị đụng (Rule 2)")

print("\n=== T4.9 — Preflight CI gate (build-ipa.yml, fix 2026-09-12) ===")
yml_path = os.path.join(ROOT, ".github", "workflows", "build-ipa.yml")
ok(os.path.exists(yml_path), "workflow tồn tại: .github/workflows/build-ipa.yml")
yml = open(yml_path, encoding="utf-8").read()
try:
    import yaml as _yaml
    _yaml.safe_load(yml)
    ok(True, "cú pháp YAML hợp lệ (yaml.safe_load parse thành công)")
except ImportError:
    ok(yml.count("<<'PY'") == yml.count("\n          PY\n"),
       "heredoc PY đóng/mở khớp (fallback khi môi trường thiếu pyyaml)")
pre_block = yml.split("- name: Preflight")[1].split("- name: Select Xcode")[0]
ok("%d file .swift/.m KHONG nam trong Compile Sources" in pre_block,
   "check XUÔI (file trên đĩa → Compile Sources) giữ nguyên")
ok("2.1b HUONG NGUOC LAI" in pre_block
   and "ghosts = sorted(n for n in in_sources if n not in disk_names)" in pre_block,
   "check NGƯỢC 2.1b MỚI (Compile Sources → đĩa) — bit blind spot 'Build input file cannot be found'")
ok("CACH SUA (chon 1):" in pre_block and "XOA khoi repo" in pre_block,
   "log lỗi kèm hướng sửa actionable (xóa repo / upload pbxproj / ci-skip)")
ok('fh.write("ghost_sources=%d\\n" % len(ghosts))' in pre_block,
   "preflight xuất ghost_sources ra GITHUB_OUTPUT")
ok("ci-skip:" in pre_block, "cơ chế loại trừ chủ đích '// ci-skip:' giữ nguyên (in minh bạch ra log)")
ok("sys.exit(rc)" in pre_block and "exit 0" not in pre_block,
   "block Preflight KHÔNG có 'exit 0' che lỗi — sys.exit(rc) trung thực")
ok("CODE_SIGNING_ALLOWED=NO" in yml, "pipeline unsigned TrollStore (CODE_SIGNING_ALLOWED=NO) không đổi")
scheme_path = os.path.join(ROOT, "BinTV.xcodeproj", "xcshareddata", "xcschemes", "BinTV.xcscheme")
ok(os.path.exists(scheme_path), "shared scheme tồn tại: xcshareddata/xcschemes/BinTV.xcscheme")
sch = open(scheme_path, encoding="utf-8").read()
bp_ids = set(re.findall(r'BlueprintIdentifier = "([^"]+)"', sch))
target_ids = set(re.findall(r"([0-9A-F]{24,40}) /\* .+ \*/ = \{\s*\n\s*isa = PBXNativeTarget", pbx))
ok(len(bp_ids) >= 1 and bp_ids <= target_ids,
   f"BlueprintIdentifier của scheme hợp lệ (⊆ PBXNativeTarget trong pbxproj)", str(sorted(bp_ids)))
src_block = re.search(r"Begin PBXSourcesBuildPhase section \*/(.*?)End PBXSourcesBuildPhase section", pbx, re.S)
in_src = set()
for lst in re.findall(r"files\s*=\s*\((.*?)\);", src_block.group(1), re.S):
    for m in re.finditer(r"/\*\s*(.+?)\s+in Sources\s*\*/", lst):
        in_src.add(os.path.basename(m.group(1).strip()))
disk_names = set()
for dp, dns, fns in os.walk(ROOT):
    dns[:] = [d for d in dns if d not in (".git", "build", "DerivedData", "node_modules", ".build")]
    for f in fns:
        if f.endswith((".swift", ".m", ".mm", ".c", ".cpp")):
            disk_names.add(f)
ghost = sorted(n for n in in_src if n not in disk_names)
ok(not ghost, f"canonical ghost-free: {len(in_src)} entry Compile Sources đều tồn tại trên đĩa", str(ghost))
# Mô phỏng TRỌN check 2.1 của Preflight (y hệt thuật toán trong build-ipa.yml):
# mọi file nguồn trên đĩa phải (nằm trong Sources) HOẶC (có '// ci-skip:' ≤6 dòng đầu)
sim_missing = []
for dp2, dns2, fns2 in os.walk(ROOT):
    dns2[:] = [d for d in dns2 if d not in (".git", "Pods", "build", "DerivedData", "node_modules", ".build", "Scripts")]
    for f2 in fns2:
        if f2.endswith((".swift", ".m", ".mm", ".c", ".cpp")):
            if f2 in in_src:
                continue
            rel2 = os.path.relpath(os.path.join(dp2, f2), ROOT)
            head6 = open(os.path.join(ROOT, rel2), encoding="utf-8", errors="replace").read().splitlines()[:6]
            if not any("ci-skip:" in l for l in head6):
                sim_missing.append(rel2)
ok(not sim_missing, "mô phỏng Preflight 2.1 trên canonical: missing = 0 → Preflight sẽ XANH",
   str(sim_missing))
ok("inputs.runner || 'macos-15'" in yml and "self-hosted" in yml,
   "công tắc runner: mặc định macos-15 giữ nguyên, tùy chọn self-hosted (thoát chặn billing)")

print("\n=== T4.10 — Nav gestures 2026-09-12 (edge-pan menu + Back cạnh trái + PHIM đen) ===")
ok("UIScreenEdgePanGestureRecognizer" in cvsrc and "edges == .right" in cvsrc
   and "edges == .left" in cvsrc, "ContentView: edge-pan phải (menu) + trái (Back) gắn trên WINDOW")
ok(cvsrc.count("cancelsTouchesInView = false") >= 2 and "delaysTouchesBegan = false" in cvsrc,
   "edge-pan không cướp touch webview/video (cancelsTouchesInView/delaysTouchesBegan = false)")
ok("onEdgeRight: { toggleOverlayMenu() }" in cvsrc, "vuốt cạnh phải vào → hiện overlay menu (cách 2 song song long-press)")
ok("handleBackGesture" in cvsrc and "final class BinTVBackRegistry" in cvsrc, "chuỗi Back + registry webview")
back = cvsrc.split("private func handleBackGesture")[1].split("\n    }")[0]
ok("if showMenu" in back and "showingPlayer" in back and "perform(tab: selectedTab)" in back,
   "chuỗi Back đúng thứ tự: ẩn menu → đóng sheet player → webview goBack 1 bước")
ok("guard !showingPlayer" in cvsrc, "menu không mở vô hình dưới sheet player (ẩn/hiện ổn định)")
ok("@State private var showMenu = false" in cvsrc, "menu MẶC ĐỊNH ẩn khi mở app (fullscreen từ đầu)")
pwsrc = open(os.path.join(ROOT, "BinTV", "Phim", "PhimWebView.swift"), encoding="utf-8").read()
ok("webViewWebContentProcessDidTerminate" in pwsrc and "webView.reload()" in pwsrc,
   "PHIM root cause màn đen: delegate CHÍNH THỨC WebContent process terminate → reload phục hồi")
ok("func noteTabDidAppear" in pwsrc and "webView.setNeedsDisplay()" in pwsrc,
   "PHIM: repaint layer khi tab hiện lại — không reload bừa, giữ trạng thái")
ok("BinTVBackRegistry.shared.register(tab: BinTVPage.phim.rawValue)" in pwsrc
   and "wv.canGoBack" in pwsrc, "PHIM: Back chỉ khi webview thật sự canGoBack (không Back hụt)")
ok("webViewWebContentProcessDidTerminate" in mlsrc
   and "BinTVBackRegistry.shared.register(tab: BinTVPage.tube.rawValue)" in mlsrc,
   "TUBE: cùng lớp fix lifecycle webview + đăng ký Back (không đổi logic phát)")
# --- xbuild.log: nhật ký hợp nhất toàn pipeline (fix 2026-09-12 vòng 2) ---
ok("- name: Init xbuild.log" in yml and yml.index("- name: Init xbuild.log") < yml.index("- name: Detect Xcode project"),
   "bước Init xbuild.log chạy TRƯỚC Detect/Preflight — fail sớm vẫn có artifact log")
ok("xcodebuild.log" not in yml, "không còn tham chiếu log cũ xcodebuild.log (một log hợp nhất duy nhất)")
n_tee = yml.count('tee -a "$XLOG"')
ok(n_tee >= 16, f"mọi step chính đều append vào xbuild.log qua tee -a ({n_tee} lần ≥ 16: 8 step × 2 nhánh)", str(n_tee))
logup = yml.split("- name: Upload build log artifact")[1].split("- name: Attach IPA")[0]
ok("name: xbuild-log" in logup and "${{ env.BUILD_DIR }}/xbuild.log" in logup and "if: always()" in yml.split("- name: Upload build log artifact")[0].split("- name: Upload IPA artifact")[1],
   "artifact 'xbuild-log' → build/Output/xbuild.log, upload if: always()")

print("\n----------------------------------------")
print(f"PASSED: {passed}  FAILED: {failed}")
if fails:
    print("\nFailures:")
    for f in fails: print("  - " + f)
sys.exit(0 if failed == 0 else 1)
