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
built_swift = [p for p in swift_on_disk if not p.endswith("AppDelegate.swift")]
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
eq(plist["CFBundleVersion"], "217", "CFBundleVersion = 217 (build mới, phân biệt IPA đã fix)")
cv = re.findall(r"CURRENT_PROJECT_VERSION = (\d+);", pbx)
ok(len(cv) == 2 and all(v == "217" for v in cv), f"CURRENT_PROJECT_VERSION=217 cả 2 config (Debug/Release)", str(cv))
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

print("\n----------------------------------------")
print(f"PASSED: {passed}  FAILED: {failed}")
if fails:
    print("\nFailures:")
    for f in fails: print("  - " + f)
sys.exit(0 if failed == 0 else 1)
