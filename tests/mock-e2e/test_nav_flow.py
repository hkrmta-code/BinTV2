#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
T5 — MÔ PHỎNG LUỒNG ĐIỀU HƯỚNG (build 221): Menu ẩn + Back cạnh trái + PHIM
     giữ trạng thái.

Mirror 1:1 (từng nhánh) của logic Swift trong `BinTV/Views/ContentView.swift`
và hook lifecycle của `PhimWebView.swift` / `MovieListView.swift`, chạy được
trong sandbox KHÔNG có Xcode/thiết bị iOS — cùng triết lý với
`lib/swift_mirror.js` (port hàm Swift sang ngôn ngữ khác để test).

Chạy:  python3 test_nav_flow.py      (exit 0 = tất cả pass)
"""

import sys

PASSED = 0
FAILED = 0
FAILS = []


def ok(cond, label, extra=""):
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print("  [PASS] " + label)
    else:
        FAILED += 1
        FAILS.append(label + ((" | " + str(extra)) if extra else ""))
        print("  [FAIL] " + label + ((" | " + str(extra)) if extra else ""))


def eq(got, want, label):
    ok(got == want, label, f"got={got!r} want={want!r}")


LIVE, TUBE, PHIM, SETTINGS = 0, 1, 2, 3

# TUBE có allowsBackForwardNavigationGestures = true (MovieListView),
# PHIM = false (mặc định) — quyết định delegate edge-pan.
WEBVIEW_OWNS_SWIPE = {TUBE: True, PHIM: False}


class ContentViewMirror:
    """Mirror từng nhánh của ContentView.swift (build 221)."""

    def __init__(self):
        self.selectedTab = LIVE          # @State private var selectedTab
        self.showMenu = False            # @State private var showMenu = false
        self.showingPlayer = False       # @State private var showingPlayer
        self.mountedTabs = {LIVE}        # @State private var mountedTabs
        self.tabHistory = [LIVE]         # @State private var tabHistory
        # --- mô phỏng lifecycle (không phải Swift) để đo lường tác động ---
        self.mount_count = {t: 0 for t in (LIVE, TUBE, PHIM, SETTINGS)}
        self.mount_count[LIVE] = 1       # khởi tạo: Live TV được mount
        self.webview_reload_count = {TUBE: 0, PHIM: 0}
        self.webview_in_window = {TUBE: False, PHIM: False}
        self.exit_app = False            # CHỈ set nếu logic thực sự thoát app
        # Mô hình WKWebView (mirror PhimController / YouTubeBrowser)
        self.webview_url = {TUBE: None, PHIM: None}     # None = webview trống
        self.is_loading = {TUBE: False, PHIM: False}
        self.restore_attempts = {TUBE: 0, PHIM: 0}
        self.server_port = 4321          # PhimLocalServer.shared.port (> 0)
        self.web_history = {TUBE: 0, PHIM: 0}           # canGoBack

    # ---- PhimView.onAppear → controller.startAndLoadIfNeeded() ----
    def startAndLoadIfNeeded(self, tab):
        """Mirror: idempotent (`started` guard) — chỉ nạp ở lần mount đầu."""
        if tab not in (TUBE, PHIM):
            return
        if self.webview_url[tab] is None and not self.is_loading[tab]:
            self.is_loading[tab] = True
            self.webview_url[tab] = "loaded"       # loadPage() → webView.load(...)
            self.is_loading[tab] = False

    # ---- .onChange(of: isActive) → controller.noteTabDidAppear() ----
    def noteTabDidAppear(self, tab):
        """Mirror PhimController.noteTabDidAppear + restoreIfEmpty."""
        if tab not in (TUBE, PHIM):
            return
        # (1) webView.setNeedsDisplay() — repaint layer, KHÔNG reload.
        # (2) restoreIfEmpty(): guard restoreAttempts < 3; guard !isLoading;
        #     guard url == nil; guard port > 0 → loadPage()
        if self.restore_attempts[tab] >= 3:
            return
        if self.is_loading[tab]:
            return
        if self.webview_url[tab] is not None:
            return                                  # cache còn dùng được → GIỮ
        if self.server_port <= 0:
            return
        self.restore_attempts[tab] += 1
        self.webview_reload_count[tab] += 1
        self.webview_in_window[tab] = True
        self.webview_url[tab] = "loaded"

    # ---- webView(_:didFinish:) → reset bộ đếm khôi phục ----
    def didFinish(self, tab):
        self.restore_attempts[tab] = 0

    # ---- render pass SwiftUI: `if mountedTabs.contains(x)` ----
    def render(self):
        for t in list(self.mountedTabs):
            if self.mount_count[t] == 0:
                self.mount_count[t] = 1
                if t in (TUBE, PHIM):
                    self.webview_in_window[t] = True
                self.startAndLoadIfNeeded(t)         # .onAppear của trang

    # private func selectTab(_ tab: Int)
    def selectTab(self, tab):
        self.showMenu = False
        if tab == self.selectedTab:
            return
        self.selectedTab = tab
        self.mountedTabs.add(tab)          # onChange(of: selectedTab) cũng làm
        if self.tabHistory[-1] != tab:
            self.tabHistory.append(tab)
        self.render()
        # .onChange(of: isActive) { startAndLoadIfNeeded(); noteTabDidAppear() }
        self.startAndLoadIfNeeded(tab)
        self.noteTabDidAppear(tab)

    # private func toggleOverlayMenu()
    def toggleOverlayMenu(self):
        if self.showMenu:                  # guard !showMenu else { return }
            return
        if self.showingPlayer:             # guard !showingPlayer else { return }
            return
        self.showMenu = True

    # private func handleBackGesture()
    def back(self):
        if self.showMenu:
            self.showMenu = False
            return
        if self.showingPlayer:
            self.showingPlayer = False
            return
        if self.registryPerform(self.selectedTab):
            return
        if len(self.tabHistory) > 1:
            self.tabHistory.pop()
            self.selectedTab = self.tabHistory[-1]
            self.render()
            self.startAndLoadIfNeeded(self.selectedTab)
            self.noteTabDidAppear(self.selectedTab)
            return
        # Root: cố tình KHÔNG làm gì (không exit, không dismiss tab).

    # BinTVBackRegistry.shared.perform(tab:)
    def registryPerform(self, tab):
        if self.web_history.get(tab, 0) > 0:
            self.web_history[tab] -= 1
            return True
        return False


# =====================================================================
print("=== T5.1 — Menu Bar: ẩn mặc định + 2 cách gọi lại + ẩn/hiện ổn định ===")
app = ContentViewMirror()
eq(app.showMenu, False, "mở app: menu ẨN (không tự hiện)")
eq(sorted(app.mountedTabs), [LIVE], "mở app: chỉ Live TV được mount (không load thừa)")

app.toggleOverlayMenu()                     # long-press
eq(app.showMenu, True, "giữ màn hình (long-press) → menu hiện")
app.toggleOverlayMenu()                     # long-press lần 2 khi đang mở
eq(app.showMenu, True, "giữ lần 2 khi menu đang mở: idempotent (không chớp ẩn/hiện)")

app.showMenu = False                        # chạm nền đóng menu
app.toggleOverlayMenu()                     # vuốt cạnh phải
eq(app.showMenu, True, "vuốt cạnh phải → menu hiện (cách 2 song song long-press)")

app.showMenu = False
app.showingPlayer = True                    # đang xem player
app.toggleOverlayMenu()
eq(app.showMenu, False, "player đang mở: menu KHÔNG hiện (không menu vô hình dưới sheet)")
app.showingPlayer = False

app.toggleOverlayMenu()
for t in (TUBE, PHIM, SETTINGS, LIVE):
    app.selectTab(t)
eq(app.selectedTab, LIVE, "chọn LIVE TV/TUBE/PHIM/SETTINGS qua menu: chuyển đúng trang")
eq(sorted(app.mountedTabs), [LIVE, TUBE, PHIM, SETTINGS], "đủ 4 trang sau khi chọn hết")
eq(app.showMenu, False, "chọn trang xong → menu tự ẩn")

# =====================================================================
print("\n=== T5.2 — Back bằng vuốt cạnh trái: đúng 1 bước, không thoát app ===")
app = ContentViewMirror()
app.back()
eq(app.selectedTab, LIVE, "root, không còn màn hình trước → KHÔNG làm gì")
eq(app.exit_app, False, "root: KHÔNG thoát app")

app.selectTab(TUBE)
app.selectTab(PHIM)
eq(list(app.tabHistory), [LIVE, TUBE, PHIM], "lịch sử tab đúng thứ tự điều hướng")

app.toggleOverlayMenu()
app.back()
eq(app.showMenu, False, "Back 1: menu đang mở → đóng menu (không đổi trang)")
eq(app.selectedTab, PHIM, "Back 1: trang không đổi")

app.showingPlayer = True
app.back()
eq(app.showingPlayer, False, "Back 2: player đang mở → đóng sheet (không đổi trang)")
eq(app.selectedTab, PHIM, "Back 2: trang không đổi")

app.web_history[PHIM] = 2
app.back()
eq(app.web_history[PHIM], 1, "Back 3: webview còn canGoBack → goBack() đúng 1 bước")
eq(app.selectedTab, PHIM, "Back 3: vẫn ở PHIM (không nhảy tab oan)")
eq(list(app.tabHistory), [LIVE, TUBE, PHIM], "Back 3: lịch sử tab chưa bị đụng")

app.back()
eq(app.web_history[PHIM], 0, "Back 4: lùi tiếp trong webview")
app.back()
eq(app.selectedTab, TUBE, "Back 5: webview hết lịch sử → lùi về TUBE (đúng 1 bước)")
eq(list(app.tabHistory), [LIVE, TUBE], "Back 5: lịch sử tab bỏ đúng 1 phần tử")
app.back()
eq(app.selectedTab, LIVE, "Back 6: lùi về LIVE TV")
app.back()
eq(app.selectedTab, LIVE, "Back 7: về root → NO-OP, không thoát app")
eq(app.exit_app, False, "không có đường nào thoát app ngoài ý muốn")

# =====================================================================
print("\n=== T5.3 — PHIM: chuyển tab nhiều lần không màn hình đen ===")
app = ContentViewMirror()
app.selectTab(PHIM)
eq(app.mount_count[PHIM], 1, "PHIM mount đúng 1 lần khi mở đầu tiên")
eq(app.webview_url[PHIM], "loaded", "PHIM: trang được nạp khi mở đầu tiên")
eq(app.webview_in_window[PHIM], True, "webview PHIM ở trong window")

for i in range(10):                          # PHIM → LIVE TV → TUBE → PHIM ×10
    app.selectTab(LIVE)
    ok(app.webview_in_window[PHIM], f"lượt {i+1}: PHIM → LIVE TV — webview VẪN trong window")
    app.selectTab(TUBE)
    app.selectTab(PHIM)
    eq(app.webview_url[PHIM], "loaded", f"lượt {i+1}: quay lại PHIM — nội dung HIỆN (không đen)")

eq(app.mount_count[PHIM], 1, "quay lại PHIM 10 lần: KHÔNG mount lại (WKWebView/state giữ nguyên)")
eq(app.webview_reload_count[PHIM], 0, "quay lại PHIM 10 lần: KHÔNG reload (cache còn dùng được)")
ok(app.webview_in_window[PHIM], "webview PHIM không bao giờ rời window → không bị kill process")
eq(app.selectedTab, PHIM, "kết thúc: đang ở PHIM và nội dung hiển thị bình thường")

print("\n--- Lớp bổ trợ: khôi phục KHI webview thật sự trống ---")
app.webview_url[PHIM] = None                 # giả lập WebContent process bị kill
app.noteTabDidAppear(PHIM)
eq(app.webview_url[PHIM], "loaded", "webview trống → nạp lại đúng cách khi quay lại tab")
eq(app.webview_reload_count[PHIM], 1, "đúng 1 lần nạp lại (không reload bừa)")
app.didFinish(PHIM)
eq(app.restore_attempts[PHIM], 0, "didFinish: reset bộ đếm khôi phục")

app.webview_url[PHIM] = None
app.server_port = 0
app.noteTabDidAppear(PHIM)
eq(app.webview_url[PHIM], None, "server chưa có port → không nạp (chờ server)")
app.server_port = 4321

app.webview_url[PHIM] = None
for _ in range(6):
    app.noteTabDidAppear(PHIM)
    app.webview_url[PHIM] = None             # nạp xong lại trống (lỗi liên tục)
eq(app.restore_attempts[PHIM], 3, "giới hạn tối đa 3 lần nạp lại — không vòng lặp vô hạn")

app2 = ContentViewMirror()
app2.selectTab(PHIM)
app2.webview_url[PHIM] = None
app2.is_loading[PHIM] = True
app2.noteTabDidAppear(PHIM)
eq(app2.webview_reload_count[PHIM], 0, "webview đang tải → không nạp chồng")

app3 = ContentViewMirror()
app3.selectTab(TUBE)
eq(app3.webview_url[TUBE], "loaded", "TUBE: nạp YouTube khi mở đầu tiên")
for i in range(6):
    app3.selectTab(LIVE)
    app3.selectTab(TUBE)
eq(app3.webview_reload_count[TUBE], 0, "TUBE: chuyển qua lại 6 lần không reload")
eq(app3.mount_count[TUBE], 1, "TUBE: không mount lại (giữ trạng thái đang xem)")

# =====================================================================
print("\n=== T5.4 — Không xung đột gesture (delegate shouldReceive) ===")


def should_receive_long_press(touch_kind, show_menu, showing_player):
    """Mirror nhánh BinTVMenuLongPressRecognizer trong delegate."""
    if not (not show_menu and not showing_player):   # longPressAllowed()
        return False
    if touch_kind in ("webview_phim", "webview_tube"):
        return False                                  # webview có recognizer riêng
    if touch_kind == "uitextfield":                   # UIControl / UITextInput
        return False
    return True


def should_receive_edge_pan(touch_kind, edges):
    """Mirror nhánh BinTVScreenEdgePanRecognizer trong delegate."""
    if touch_kind in ("webview_phim", "webview_tube"):
        owns = WEBVIEW_OWNS_SWIPE[PHIM if touch_kind == "webview_phim" else TUBE]
        if owns:                                      # TUBE tự có swipe back/forward
            return False
    return True


ok(should_receive_long_press("livetv_grid", False, False),
   "long-press trên lưới Live TV → NHẬN (gọi menu)")
ok(should_receive_long_press("settings_bg", False, False),
   "long-press trên nền Settings → NHẬN (gọi menu)")
ok(not should_receive_long_press("webview_phim", False, False),
   "long-press trong webview PHIM → NHƯỜNG (webview có recognizer riêng)")
ok(not should_receive_long_press("webview_tube", False, False),
   "long-press trong webview TUBE → NHƯỜNG (không huỷ thao tác trang web)")
ok(not should_receive_long_press("uitextfield", False, False),
   "long-press trong ô nhập liệu → NHƯỜNG (chọn/paste của hệ thống)")
ok(not should_receive_long_press("livetv_grid", True, False),
   "menu đang mở → long-press KHÔNG nhận (nút menu vẫn bấm được)")
ok(not should_receive_long_press("livetv_grid", False, True),
   "player đang mở → long-press KHÔNG nhận (điều khiển video không bị huỷ)")
ok(not should_receive_edge_pan("webview_tube", "left"),
   "vuốt cạnh trái trong TUBE → nhường swipe back nội bộ (không Back 2 lần)")
ok(should_receive_edge_pan("webview_phim", "left"),
   "vuốt cạnh trái trong PHIM → nhận (PHIM không có swipe nội bộ)")
ok(should_receive_edge_pan("livetv_grid", "left") and should_receive_edge_pan("livetv_grid", "right"),
   "vuốt cạnh trái/phải trên trang thường → nhận đúng yêu cầu")

# =====================================================================
print("\n=== T5.5 — Nhận diện VUỐT MÉP (build 222, thay UIScreenEdgePan) ===")

WIDTH = 932.0          # iPhone 14 Pro Max landscape (màn ngang dài)


def edge_zone_for(width):
    """Mirror `edgeZone(for:)` — dải mép tự co theo màn hình."""
    return min(max(width * 0.09, 30), 70)


class Swipe:
    """Mirror `BinTVEdgeSwipeRecognizer` (UIPanGestureRecognizer)."""

    def __init__(self, edge, width=WIDTH):
        self.edge = edge
        self.edge_zone = edge_zone_for(width)
        self.min_translation = 45
        self.start_x = 0.0
        self.has_fired = False


def feed(sw, state, start_x, tx, ty, width=WIDTH, log=None):
    """Mirror `handleEdgeSwipe(_:)` — trả về hành động đã kích hoạt."""
    if state == "began":
        sw.start_x = start_x
        sw.edge_zone = edge_zone_for(width)
        sw.has_fired = False
        return None
    if state in ("ended", "cancelled", "failed"):
        sw.has_fired = False
        return None
    if state != "changed" or sw.has_fired:
        return None
    if not (abs(tx) >= sw.min_translation and abs(tx) > abs(ty) * 1.5):
        return None
    if sw.edge == "left" and sw.start_x <= sw.edge_zone and tx > 0:
        sw.has_fired = True
        if log is not None:
            log.append("back")
        return "back"
    if sw.edge == "right" and sw.start_x >= width - sw.edge_zone and tx < 0:
        sw.has_fired = True
        if log is not None:
            log.append("menu")
        return "menu"
    return None


eq(round(edge_zone_for(932), 1), 70.0, "dải mép màn lớn bị kẹp ở 70pt (không lấn nội dung)")
eq(round(edge_zone_for(568), 1), 51.1, "dải mép SE landscape ~51pt (tự co theo màn hình)")
eq(round(edge_zone_for(430), 1), 38.7, "dải mép màn nhỏ ~39pt (vẫn dễ vuốt)")

# (1) Vuốt từ cạnh TRÁI sang phải → Back đúng 1 lần
log = []
sw = Swipe("left")
feed(sw, "began", start_x=8, tx=0, ty=0, log=log)
eq(feed(sw, "changed", start_x=8, tx=80, ty=5, log=log), "back", "vuốt cạnh trái → Back")
eq(feed(sw, "changed", start_x=8, tx=200, ty=5, log=log), None, "cùng 1 lần vuốt → KHÔNG Back thêm lần nữa")
eq(len(log), 1, "mỗi lần vuốt = đúng 1 bước Back")

# (2) Kết thúc vuốt → lần vuốt mới lại hoạt động
feed(sw, "ended", start_x=8, tx=200, ty=5, log=log)
feed(sw, "began", start_x=12, tx=0, ty=0, log=log)
eq(feed(sw, "changed", start_x=12, tx=60, ty=0, log=log), "back", "vuốt mới sau .ended → Back tiếp")
eq(len(log), 2, "2 lần vuốt = 2 bước Back")

# (3) Vuốt DỌC ở mép trái → KHÔNG kích hoạt (vẫn là cuộn nội dung)
log2 = []
sw2 = Swipe("left")
feed(sw2, "began", start_x=8, tx=0, ty=0, log=log2)
eq(feed(sw2, "changed", start_x=8, tx=15, ty=160, log=log2), None, "vuốt dọc ở mép → không Back (cuộn bình thường)")

# (4) Vuốt ngang GIỮA màn hình → KHÔNG kích hoạt
sw3 = Swipe("left")
feed(sw3, "began", start_x=400, tx=0, ty=0, log=log2)
eq(feed(sw3, "changed", start_x=400, tx=300, ty=0, log=log2), None, "vuốt ngang giữa màn hình → không Back")

# (5) Vuốt ở mép trái nhưng hướng NGƯỢC lại → KHÔNG kích hoạt
sw4 = Swipe("left")
feed(sw4, "began", start_x=8, tx=0, ty=0, log=log2)
eq(feed(sw4, "changed", start_x=8, tx=-90, ty=0, log=log2), None, "vuốt từ mép trái sang TRÁI → không Back")

# (6) Chưa đủ quãng vuốt → KHÔNG kích hoạt
sw5 = Swipe("left")
feed(sw5, "began", start_x=8, tx=0, ty=0, log=log2)
eq(feed(sw5, "changed", start_x=8, tx=20, ty=0, log=log2), None, "quãng vuốt < 45pt → chưa kích hoạt")

# (7) Vuốt từ cạnh PHẢI vào trong → hiện menu
log3 = []
sw6 = Swipe("right")
feed(sw6, "began", start_x=WIDTH - 6, tx=0, ty=0, log=log3)
eq(feed(sw6, "changed", start_x=WIDTH - 6, tx=-90, ty=0, log=log3), "menu", "vuốt cạnh phải vào → hiện menu")
eq(len(log3), 1, "vuốt phải kích hoạt đúng 1 lần")
eq(feed(sw6, "changed", start_x=WIDTH - 6, tx=-200, ty=0, log=log3), None, "cùng lần vuốt → không hiện menu 2 lần")

# (8) Vuốt phải từ giữa màn hình / sai hướng → KHÔNG kích hoạt
sw7 = Swipe("right")
feed(sw7, "began", start_x=400, tx=0, ty=0, log=log3)
eq(feed(sw7, "changed", start_x=400, tx=-200, ty=0, log=log3), None, "vuốt phải từ giữa màn hình → không hiện menu")
sw8 = Swipe("right")
feed(sw8, "began", start_x=WIDTH - 6, tx=0, ty=0, log=log3)
eq(feed(sw8, "changed", start_x=WIDTH - 6, tx=90, ty=0, log=log3), None, "vuốt từ mép phải ra ngoài → không hiện menu")
eq(len(log3), 1, "tổng cộng chỉ 1 lần hiện menu")

# =====================================================================
print("\n----------------------------------------")
print(f"PASSED: {PASSED}  FAILED: {FAILED}")
if FAILS:
    print("\nFailures:")
    for f in FAILS:
        print("  - " + f)
sys.exit(0 if FAILED == 0 else 1)
