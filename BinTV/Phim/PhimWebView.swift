import SwiftUI
import WebKit
import UIKit
import AVFoundation

// =====================================================================
// [BinTV PHIM 2026-09] PhimWebView — host cho web app Phim (app.js +
// hls.js + css, giữ nguyên 100% từ project Phim Android). Port phần
// WebView của MainActivity.java sang iOS:
//
//  - WKWebView tải http://127.0.0.1:PORT/?android=phone (layout điện
//    thoại cảm ứng của web app — 2 cột, touch, HUD player).
//  - localStorage PERSISTENT (websiteDataStore .default) — cache
//    bootstrap/catalog của app.js (giống setDomStorageEnabled(true)).
//  - Autoplay không cần gesture (mediaTypesRequiringUserActionForPlayback
//    = [] — giống setMediaPlaybackRequiresUserGesture(false)).
//  - JS shim window.AndroidBridge (thay AndroidBridge.java) inject
//    TRƯỚC mọi script: các method trả string chạy đúng trong JS
//    (đồng bộ, kết quả giống buildProxyUrl); setPlayerLandscape/
//    exitApp/clearCookies gửi sang native qua message handler.
//  - setPlayerLandscape("1"/"0") từ phim_player_ui.js (player mở/đóng)
//    → player MỞ: buộc LANDSCAPE (cùng cơ chế requestGeometryUpdate
//      (iOS 16+) / KVC (iOS 15), DUYỆT cả khi đang khóa xoay);
//    → player ĐÓNG: KHÔNG xoay về PORTRAIT (app BinTV = chế độ TV,
//      giữ nguyên hướng landscape — bản cũ xoay về portrait ở đây).
//  - Lỗi tải (mất mạng/server) → overlay "Không thể tải Phim + Thử lại"
//    (port ErrorScreen.java) — không crash, không ảnh hưởng tab khác.
//
// PHIM là một TAB của BinTV nên 2 hành vi standalone-Android bị điều
// chỉnh có chủ đích (ghi rõ trong báo cáo):
//  - exitApp() (dialog "Thoát" của web app) = NO-OP — không đóng cả
//    app BinTV.
//  - clearCookies() = NO-OP — không xóa cookie cả app (phá phiên
//    YouTube của tab TUBE).
// =====================================================================

final class PhimController: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate {

    @Published var loadFailed = false
    @Published var failMessage = ""
    let webView: WKWebView
    private var server: PhimLocalServer?
    private var started = false

    /// Long-press trên webview (≥0.35s) → hiển thị menu tab
    /// (LIVE TV/TUBE/PHIM/SETTINGS) — nhất quán 4 tab. Gắn bởi PhimView.
    var onLongPress: (() -> Void)?

    override init() {
        PhimDebugLog.step("WEBVIEW", "controllerInit", "begin")
        let configuration = WKWebViewConfiguration()
        // Data store persistent: localStorage của web app (bootstrap/
        // catalog cache) sống qua các lần mở app — giống DOM storage
        // Android.
        configuration.websiteDataStore = .default()
        // Autoplay (web app phát video ngay khi mở phim).
        configuration.mediaTypesRequiringUserActionForPlayback = []
        // =================================================================
        // [FIX 2026-09-12 — ROOT CAUSE "Không thể phát nguồn phim này trên TV"]
        // allowsInlineMediaPlayback: mặc định FALSE trên iPhone (chỉ iPad
        // mặc định true). Khi false, thuộc tính HTML `playsinline` của thẻ
        // <video id="bintv-movie-html5-player"> BỊ WEBKIT BỎ QUA:
        //  - video.play() (app.js gọi SAU chuỗi resolve stream bất đồng bộ —
        //    không còn user-activation) → play() reject NotAllowedError,
        //    hoặc WebKit tự "bắt cóc" video sang player FULLSCREEN native;
        //  - player fullscreen native KHÔNG phát được nội dung MSE của
        //    hls.js (iOS 17.1+, ManagedMediaSource) → hls.js fatal error;
        //  - video.onerror / hls ERROR → handleMoviePlaybackError() → hết
        //    stream fallback → app.js hiện đúng lỗi "Không thể phát nguồn
        //    phim này trên TV" (app.js:5380);
        //  - fullscreen takeover cũng là thủ phạm XOAY MÀN HÌNH khỏi
        //    landscape khi mở player (nhiệm vụ Orientation).
        // PHẢI set TRƯỚC khi khởi tạo WKWebView (Apple docs: configuration
        // chỉ áp dụng lúc init). Đây là công tắc CHÍNH THỨC — không hack.
        // =================================================================
        configuration.allowsInlineMediaPlayback = true
        // Shim AndroidBridge — chạy TRƯỚC hls.min.js/tizen_shim.js/app.js.
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.bridgeShimJS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        // Hook console.* của web app → phim_debug.log (xem consoleCaptureJS).
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.consoleCaptureJS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        // [PHIM_DEBUG] Observer THỤ ĐỘNG (không đụng logic app.js): log môi
        // trường phát (MSE/ManagedMediaSource/hls.js/native HLS/inline) +
        // mọi sự kiện media của thẻ <video> theo format chuẩn
        // `[PHIM_DEBUG] Step -> Action -> Status -> Payload/URL` (token đã
        // che). Chạy SAU DOMContentLoaded nên app.js/hls.js không bị ảnh
        // hưởng; mọi listener đặt ở capture phase và không preventDefault.
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.playerObserverJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        )
        webView = WKWebView(frame: .zero, configuration: configuration)
        #if DEBUG
        // Safari Web Inspector attach được vào webview (dev build).
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif
        webView.backgroundColor = .black
        super.init()
        // Đăng ký SAU super.init() (không dùng self trước super.init —
        // cùng bài học đã áp dụng cho MovieListView). Cùng 1
        // userContentController mà WKWebView đang dùng.
        configuration.userContentController.add(self, name: "phimBridge")
        configuration.userContentController.add(self, name: "phimConsole")
        webView.navigationDelegate = self
        // Long-press (≥0.35s) = HIỆN MENU TAB — nhất quán 4 tab.
        // cancelsTouchesInView = false → tap / swipe / gesture video
        // HOÀN TOÀN không bị ảnh hưởng (cùng kỹ thuật long-press của TUBE).
        let menuGesture = UILongPressGestureRecognizer(
            target: self, action: #selector(handleMenuLongPress(_:))
        )
        menuGesture.minimumPressDuration = 0.35
        menuGesture.cancelsTouchesInView = false
        webView.addGestureRecognizer(menuGesture)
        PhimDebugLog.step("WEBVIEW", "controllerInit", "ok", "inline=true autoplay=all bridge=shimmed")
    }

    /// Long-press đủ 0.35s → hiện menu tab (LIVE TV/TUBE/PHIM/SETTINGS).
    @objc private func handleMenuLongPress(_ gesture: UILongPressGestureRecognizer) {
        guard gesture.state == .began else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        onLongPress?()
    }

    /// Khơi server nội bộ + tải web app.
    /// Server là SINGLETON (sống trọn đời app, giống Android) — tạo/hủy
    /// server lặp lại là nguyên nhân EADDRINUSE + crash khi bấm Reload.
    func startAndLoadIfNeeded() {
        guard !started else { return }
        started = true
        PhimDebugLog.step("WEBVIEW", "startAndLoadIfNeeded", "begin")
        // Audio session .playback cho phim (không phụ thuộc tab TUBE đã
        // được mở trước hay chưa — xem cấu trúc hàm configureAudioSession).
        configureAudioSession()
        let server = PhimLocalServer.shared
        self.server = server
        if server.port > 0 {
            // Server đã sẵn sàng (lần mở tab trước) — tải ngay.
            PhimDebugLog.step("SERVER", "reuse", "ok", "port=\(server.port)")
            loadPage()
            return
        }
        server.onPortReady = { [weak self] port in
            PhimDebugLog.step("SERVER", "portReady", "ok", "port=\(port)")
            self?.loadPage()
        }
        server.onPortFailed = { [weak self] message in
            PhimDebugLog.step("SERVER", "portReady", "FAIL", message)
            self?.failMessage = message
            self?.loadFailed = true
        }
        if server.port > 0 {
            // Server vừa ready giữa chừng — tải luôn (tránh race).
            loadPage()
        } else {
            server.start()
            armServerTimeout()
        }
    }

    /// Server không sẵn sàng sau 4s → hiện lỗi RÕ (thay vì treo/blank).
    private func armServerTimeout() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            guard let self = self, !self.loadFailed, (self.server?.port ?? 0) <= 0 else { return }
            PhimDebugLog.step("SERVER", "startupTimeout", "FAIL", "4s — server chưa sẵn sàng")
            self.failMessage = "Server Phim chưa sẵn sàng sau 4 giây. Thử lại."
            self.loadFailed = true
        }
    }

    func stop() {
        // Server là SINGLETON — KHÔNG hủy khi rời tab. Lần mở sau dùng
        // lại ngay (port còn giữ) — không lo EADDRINUSE, không crash.
        server = nil
        started = false
    }

    deinit {
        stop()
    }

    private func pageURL() -> URL? {
        guard let server = server, server.port > 0 else { return nil }
        // ?android=phone  → phone.css (kích thước chạm — giữ nguyên).
        // &ios=landscape  → index.html nạp THÊM landscape.css (SAU phone.css)
        //   cho bố cục ngang TV: lưới poster 6 cột, header compact, dialog
        //   chọn tập 8 cột/hàng, padding env(safe-area-inset) — app BinTV
        //   chạy chế độ TV landscape (14 Pro Max: viewport ~932×430).
        return URL(string: "http://127.0.0.1:\(server.port)/?android=phone&ios=landscape")
    }

    private func loadPage() {
        guard let url = pageURL() else {
            PhimDebugLog.step("WEBVIEW", "loadPage", "FAIL", "không có port")
            failMessage = "Server Phim chưa có port."
            loadFailed = true
            return
        }
        PhimDebugLog.step("WEBVIEW", "loadPage", "begin", PhimDebugLog.sanitizeURL(url.absoluteString))
        loadFailed = false
        failMessage = ""
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20))
    }

    func retryLoad() {
        PhimDebugLog.step("WEBVIEW", "retryLoad", "begin", "port=\(server?.port ?? 0)")
        loadFailed = false
        failMessage = ""
        let server = server ?? PhimLocalServer.shared
        self.server = server
        if server.port > 0 {
            loadPage()
        } else {
            // Server chưa sẵn sàng → (re)start idempotent + chờ.
            // KHÔNG tạo server mới (singleton) — tránh EADDRINUSE + crash.
            server.onPortReady = { [weak self] port in
                PhimDebugLog.step("SERVER", "portReady", "ok", "retry port=\(port)")
                self?.loadPage()
            }
            server.onPortFailed = { [weak self] message in
                self?.failMessage = message
                self?.loadFailed = true
            }
            server.start()
            armServerTimeout()
        }
    }

    // =====================================================================
    // Console capture — hook console.log/info/warn/error của web app →
    // postMessage("phimConsole") → PhimDebugLog (Documents/phim_debug.log,
    // xem qua Files → On My iPhone → BinTV).
    //
    // Chạy TRƯỚC mọi script (atDocumentStart) nên bắt được cả log của
    // hls.min.js/app.js. Giữ nguyên console gốc (web app không thay đổi
    // behavior); toàn bộ hook nằm trong try/catch (lỗi log không bao giờ
    // ảnh hưởng phát video).
    // =====================================================================

    private static let consoleCaptureJS = """
    (function () {
        try {
            if (window.__binTVConsoleHooked) { return; }
            window.__binTVConsoleHooked = true;
            function forward(level, args) {
                try {
                    var parts = [];
                    for (var i = 0; i < args.length && i < 8; i++) {
                        var a = args[i];
                        if (a === null) { parts.push("null"); }
                        else if (a === undefined) { parts.push("undefined"); }
                        else if (typeof a === "string") { parts.push(a); }
                        else if (a instanceof Error) {
                            parts.push(a.name + ": " + a.message + (a.stack ? " | " + String(a.stack).split("\\n").slice(0, 3).join(" / ") : ""));
                        }
                        else { try { parts.push(JSON.stringify(a)); } catch (e) { parts.push(String(a)); } }
                    }
                    var text = parts.join(" ");
                    if (text.length > 1500) { text = text.substring(0, 1500) + "…[truncated]"; }
                    var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.phimConsole;
                    if (handler) { handler.postMessage({ level: level, msg: text }); }
                } catch (e) {}
            }
            ["log", "info", "warn", "error"].forEach(function (fn) {
                var original = console[fn];
                console[fn] = function () {
                    try { if (typeof original === "function") { original.apply(console, arguments); } } catch (e) {}
                    forward(fn, arguments);
                };
            });
            window.addEventListener("error", function (ev) {
                forward("error", ["WINDOW ERROR: ", ev.message, " @ ", ev.filename, ":", ev.lineno]);
            });
            window.addEventListener("unhandledrejection", function (ev) {
                forward("error", ["UNHANDLED REJECTION: ", ev.reason && (ev.reason.message || String(ev.reason))]);
            });
        } catch (e) {}
    })();
    """

    // =====================================================================
    // [PHIM_DEBUG] Player observer — log CÓ CẤU TRÚC luồng phát video:
    //   [PHIM_DEBUG] Step -> Action -> Status -> Payload/URL
    // THỤ ĐỘNG 100%: chỉ addEventListener (capture) + đọc state; KHÔNG
    // wrap/override hàm nào của app.js/hls.js, KHÔNG preventDefault →
    // không thể làm thay đổi hành vi phát. Log đi qua console.log →
    // consoleCaptureJS (đã có) → phimConsole handler → phim_debug.log.
    // Token nhạy cảm (pkey/token/sig/auth/key/session...) trong query
    // string bị che thành *** TRƯỚC khi log.
    // =====================================================================

    private static let playerObserverJS = """
    (function () {
        "use strict";
        try {
            if (window.__binTVPlayerObserver) { return; }
            window.__binTVPlayerObserver = true;

            var SENSITIVE = /^(pkey|token|tk|sig|signature|auth|authorization|session|sessionid|sid|hash|h|key|apikey|api_key|secret|pass|password|cred|md5|secure|st)$/i;
            function sanitize(value) {
                try {
                    var text = String(value == null ? "" : value);
                    var qIndex = text.indexOf("?");
                    if (qIndex < 0) { return text.length > 260 ? text.substring(0, 260) + "…" : text; }
                    var base = text.substring(0, qIndex);
                    var parts = text.substring(qIndex + 1).split("&").map(function (pair) {
                        var eq = pair.indexOf("=");
                        var name = eq >= 0 ? pair.substring(0, eq) : pair;
                        if (SENSITIVE.test(name)) { return name + "=***"; }
                        return pair;
                    });
                    var out = base + "?" + parts.join("&");
                    return out.length > 260 ? out.substring(0, 260) + "…" : out;
                } catch (e) { return "<sanitize-error>"; }
            }
            function step(st, action, status, payload) {
                try {
                    console.log("[PHIM_DEBUG] " + st + " -> " + action + " -> " + status
                        + (payload === undefined || payload === null || payload === "" ? "" : " -> " + payload));
                } catch (e) {}
            }
            window.__phimDebugStep = step;

            // (1) ENV — năng lực phát của WebKit tại thời điểm chạy: quyết định
            // app.js đi đường hls.js (MSE/ManagedMediaSource) hay <video> native.
            function logEnv() {
                var env = {};
                try { env.origin = window.location.origin; } catch (e) {}
                try { env.mse = !!window.MediaSource; } catch (e) { env.mse = false; }
                try { env.managedMse = !!window.ManagedMediaSource; } catch (e) { env.managedMse = false; }
                try { env.hlsJs = !!(window.Hls && window.Hls.version); env.hlsVer = window.Hls && window.Hls.version; } catch (e) { env.hlsJs = false; }
                try { env.hlsSupported = !!(window.Hls && window.Hls.isSupported && window.Hls.isSupported()); } catch (e) { env.hlsSupported = false; }
                try {
                    var probe = document.createElement("video");
                    env.nativeHls = !!probe.canPlayType("application/vnd.apple.mpegurl");
                    env.nativeMp4 = !!probe.canPlayType("video/mp4");
                } catch (e) {}
                try {
                    var v = document.getElementById("bintv-movie-html5-player");
                    env.playsinlineAttr = !!(v && v.hasAttribute("playsinline"));
                } catch (e) {}
                step("ENV", "capabilities", "ok", JSON.stringify(env));
            }

            // (2) PLAYER — mọi sự kiện media của thẻ <video> (capture, thụ động).
            function attachPlayer() {
                var video = document.getElementById("bintv-movie-html5-player");
                if (!video || video.__binTVObserved) { return; }
                video.__binTVObserved = true;
                function srcInfo() {
                    var s = "";
                    try { s = String(video.currentSrc || video.src || ""); } catch (e) {}
                    return sanitize(s);
                }
                function stateInfo() {
                    var err = null;
                    try { if (video.error) { err = { code: video.error.code, msg: sanitize(video.error.message || "") }; } } catch (e) {}
                    return JSON.stringify({
                        rs: video.readyState, ns: video.networkState,
                        paused: video.paused, t: Math.round((video.currentTime || 0) * 1000) / 1000,
                        dur: isFinite(video.duration) ? Math.round(video.duration * 1000) / 1000 : null,
                        wh: (video.videoWidth || 0) + "x" + (video.videoHeight || 0),
                        err: err
                    });
                }
                var EVENTS = ["loadstart", "loadedmetadata", "loadeddata", "canplay", "canplaythrough",
                              "play", "playing", "pause", "waiting", "stalled", "suspend", "abort",
                              "emptied", "ended", "error", "ratechange", "durationchange"];
                EVENTS.forEach(function (name) {
                    video.addEventListener(name, function () {
                        var status = (name === "error") ? "FAIL" : "ok";
                        step("PLAYER", name, status, srcInfo() + " " + stateInfo());
                    }, true);
                });
                step("PLAYER", "observer-attached", "ok", srcInfo());
            }

            function boot() { logEnv(); attachPlayer(); }
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", boot);
            } else { boot(); }
            // app.js có thể (re)create phần tử player — kiểm tra lại định kỳ
            // 2s trong 60s đầu (thụ động, chi phí không đáng kể).
            var ticks = 0;
            var timer = setInterval(function () {
                ticks++;
                attachPlayer();
                if (ticks >= 30) { clearInterval(timer); }
            }, 2000);
        } catch (e) {}
    })();
    """

    // =====================================================================
    // JS bridge (thay AndroidBridge.java)
    // =====================================================================

    private static let bridgeShimJS = """
    (function () {
        "use strict";
        if (window.AndroidBridge) return;
        function enc(value) {
            try { return encodeURIComponent(String(value == null ? "" : value)); } catch (e) { return ""; }
        }
        function originBase() {
            try {
                var origin = window.location && window.location.origin;
                return origin ? String(origin).replace(/\\/+$/, "") : "";
            } catch (e) { return ""; }
        }
        function send(action, extra) {
            try {
                var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.phimBridge;
                if (!handler) return;
                var payload = { action: action };
                if (extra) { for (var key in extra) { payload[key] = extra[key]; } }
                handler.postMessage(payload);
            } catch (e) {}
        }
        // Cùng interface AndroidBridge.java. Các method trả string chạy
        // đúng trong JS (đồng bộ) — proxyMedia trả cùng kết quả với
        // buildProxyUrl() của MainActivity.
        window.AndroidBridge = {
            getMyAppId: function () { return "com.bintv.ios"; },
            getInstalledApps: function () { return "[]"; },
            launchApp: function (appId) { return "0"; },
            isAndroidTv: function () { return "0"; },
            appVersion: function () { return "1.2.1"; },
            clearCookies: function () { send("clearCookies"); },
            proxyMedia: function (url, referer) {
                var base = originBase();
                if (!url || !base) return "";
                return base + "/proxy?url=" + enc(url) + (referer ? "&__ref=" + enc(referer) : "");
            },
            exitApp: function () { send("exit"); },
            setPlayerLandscape: function (enabled) {
                send("landscape", { enabled: (enabled === "1" || enabled === true) });
            }
        };
    })();
    """

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "phimConsole" {
            // LOG CỦA WEB APP (app.js/hls.js: [STREAM], [HLS], [PLAYER],
            // [PHIM_DEBUG], video.onerror, hls.js fatal error...) →
            // phim_debug.log. WKWebView KHÔNG ghi console JS ra bất kỳ đâu
            // (Android thì có WebChromeClient → logcat) — không có hook này
            // thì toàn bộ log debug phát phim TRÊN MÁY THẬT đều vô hình →
            // không xác định được root-cause.
            if let body = message.body as? [String: Any] {
                let level = (body["level"] as? String) ?? "log"
                let text = (body["msg"] as? String) ?? ""
                PhimDebugLog.log("[JS:\(level)] \(text)")
            }
            return
        }
        guard message.name == "phimBridge" else { return }
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        switch action {
        case "landscape":
            // phim_player_ui.js: player mở → "1" (buộc landscape);
            // player đóng → "0" (GIỮ landscape — chế độ TV, không xoay dọc).
            let on = (body["enabled"] as? Bool) ?? false
            PhimDebugLog.step("BRIDGE", "setPlayerLandscape", "ok", on ? "on=1 (buộc landscape)" : "on=0 (giữ landscape)")
            setPlayerLandscape(on)
        case "exit":
            // PHIM trong BinTV là TAB — không đóng cả app (khác Android
            // standalone). Người dùng chuyển tab bình thường.
            PhimDebugLog.step("BRIDGE", "exitApp", "ignored", "PHIM là tab của BinTV")
            break
        case "clearCookies":
            // Không xóa cookie cả app (phá phiên YouTube của tab TUBE).
            PhimDebugLog.step("BRIDGE", "clearCookies", "ignored", "bảo vệ phiên tab TUBE")
            break
        default:
            PhimDebugLog.step("BRIDGE", action, "ignored", "action không xác định")
            break
        }
    }

    // =====================================================================
    // Orientation (cùng cơ chế với tab TUBE & LIVE TV)
    // =====================================================================

    private func setPlayerLandscape(_ on: Bool) {
        // Giữ màn hình sáng khi đang xem (giống FLAG_KEEP_SCREEN_ON).
        UIApplication.shared.isIdleTimerDisabled = on
        // App BinTV = chế độ TV LANDSCAPE:
        // - Player MỞ  → buộc landscape (phòng trường hợp người dùng tự
        //   xoay máy về dọc giữa chừng xem).
        // - Player ĐÓNG → KHÔNG xoay về portrait (bản cũ làm app "lọt" về
        //   layout dọc giữa chừng sử dụng) — giữ nguyên hướng hiện tại.
        // Lớp khóa cứng toàn app nằm ở AppDelegate
        // (application(_:supportedInterfaceOrientationsFor:) = .landscape)
        // + Info.plist landscape-only — request ở đây chỉ là lớp bổ trợ.
        guard on else { return }
        let orientations: UIInterfaceOrientationMask = [.landscapeLeft, .landscapeRight]
        if #available(iOS 16.0, *) {
            let scene = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive }
            if let scene = scene {
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: orientations)) { error in
                    // [BUILD FIX 2026-09-12] Tham số của errorHandler là
                    // `any Error` KHÔNG Optional (handler chỉ được gọi khi
                    // lỗi) — bản trước dùng `if let error = error` → lỗi
                    // biên dịch Xcode 16.4 "initializer for conditional
                    // binding must have Optional type, not 'any Error'"
                    // (PhimWebView.swift:508, log CI 2026-09-12). Log "ok"
                    // chuyển ra sau lời gọi (ý nghĩa: request đã gửi).
                    PhimDebugLog.step("ORIENTATION", "requestGeometryUpdate", "FAIL", error.localizedDescription)
                }
                PhimDebugLog.step("ORIENTATION", "requestGeometryUpdate", "ok", "landscape (player mở)")
            } else {
                PhimDebugLog.step("ORIENTATION", "requestGeometryUpdate", "FAIL", "no foregroundActive scene")
            }
        } else {
            // iOS 15: KVC trên UIDevice phải dùng giá trị UIDeviceOrientation
            // (device landscapeLeft ↔ interface landscapeRight — cả hai đều
            // là LANDSCAPE, đúng yêu cầu khóa ngang).
            UIDevice.current.setValue(UIDeviceOrientation.landscapeLeft.rawValue, forKey: "orientation")
            PhimDebugLog.step("ORIENTATION", "kvcDeviceOrientation", "ok", "landscape (iOS 15)")
        }
    }

    // =====================================================================
    // Audio session (âm thanh phim — độc lập với tab TUBE)
    //
    // Tab TUBE tự set AVAudioSession .playback khi tab hiện, nhưng nếu
    // người dùng mở app → đi thẳng tab PHIM (chưa qua TUBE), session
    // còn .soloAmbient mặc định → audio phim bị ảnh hưởng bởi silent
    // switch. Set .playback ngay khi tab PHIM khởi server (cùng category
    // / mode với TUBE — không xung đột).
    // =====================================================================
    func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .moviePlayback, options: [])
            try session.setActive(true)
        } catch {
            // Không set được thì app vẫn chạy ở foreground; chỉ mất phát nền.
        }
    }

    // =====================================================================
    // SAFE AREA (top) — inject chiều cao status bar THẬT vào web app
    //
    // Trên LANDSCAPE, status bar iPhone (giờ / pin / sóng / Dynamic
    // Island) KHÔNG phải một phần của safe area (safeArea.top = 0), trong
    // khi PhimView full-bleed (.ignoresSafeArea()) → web content tràn lên
    // đè vào khu vực giờ/pin. Web app (landscape.css) giữ chỗ bằng biến
    // CSS --bintv-status-bar-h; giá trị do SYSTEM trả ở RUNTIME
    // (statusBarManager.statusBarFrame.height — đúng theo thiết bị +
    // orientation, KHÔNG hard-code số).
    // =====================================================================

    private func injectStatusBarInset() {
        // `statusBarManager` là OPTIONAL (UIStatusBarManager?) → phải chain
        // với `?.` (compile error nếu thiếu: "value of optional type
        // 'UIStatusBarManager?' must be unwrapped").
        let height: CGFloat = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first?.statusBarManager?.statusBarFrame.height ?? 0
        let js = "document.documentElement.style.setProperty('--bintv-status-bar-h', '\(Int(height.rounded()))px');"
        webView.evaluateJavaScript(js) { _, _ in }
    }

    /// Wrapper public cho PhimWebViewContainer.updateUIView (re-inject
    /// sau rotation/layout change).
    func injectStatusBarInsetPublic() {
        injectStatusBarInset()
    }

    // =====================================================================
    // Navigation delegate — lỗi main frame → overlay "Thử lại"
    // =====================================================================

    /// Page load xong → inject lại chiều cao status bar (rotation có thể
    /// đổi giá trị giữa các lần load).
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        PhimDebugLog.step("WEBVIEW", "didFinishNavigation", "ok", PhimDebugLog.sanitizeURL(webView.url?.absoluteString ?? ""))
        injectStatusBarInset()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        PhimDebugLog.step("WEBVIEW", "didFailNavigation", "FAIL", error.localizedDescription)
        DispatchQueue.main.async {
            self.failMessage = error.localizedDescription
            self.loadFailed = true
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        PhimDebugLog.step("WEBVIEW", "didFailProvisionalNavigation", "FAIL", error.localizedDescription)
        DispatchQueue.main.async {
            self.failMessage = error.localizedDescription
            self.loadFailed = true
        }
    }
}

// =====================================================================
// PhimView — TAB PHIM trong BinTV (web app full-bleed + error overlay)
// =====================================================================

struct PhimView: View {
    @StateObject private var controller = PhimController()
    /// Long-press → hiện menu tab (gắn bởi ContentView, nhất quán 4 tab).
    var onLongPress: () -> Void = {}

    var body: some View {
        ZStack {
            PhimWebViewContainer(controller: controller, onLongPress: onLongPress)
            if controller.loadFailed {
                errorOverlay
            }
        }
        .ignoresSafeArea()
        .onAppear { controller.startAndLoadIfNeeded() }
    }

    // Port ErrorScreen.java — chỉ hiện khi server/webview lỗi.
    private var errorOverlay: some View {
        ZStack {
            Color.black
            VStack(spacing: 16) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.largeTitle)
                    .foregroundColor(.orange)
                Text("Không thể tải Phim")
                    .font(.headline)
                    .foregroundColor(Color(red: 1.0, green: 0.545, blue: 0.545))
                Text(controller.failMessage.isEmpty
                     ? "Kiểm tra kết nối mạng rồi thử lại."
                     : controller.failMessage)
                    .font(.footnote)
                    .foregroundColor(.white.opacity(0.8))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                Button("Thử lại") {
                    controller.retryLoad()
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }
}

private struct PhimWebViewContainer: UIViewRepresentable {
    let controller: PhimController
    let onLongPress: () -> Void

    func makeUIView(context: Context) -> WKWebView {
        controller.webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // Webview do controller sở hữu trọn vẹn (1 instance duy nhất).
        // Cập nhật callback long-press (nội dung có thể thay đổi).
        controller.onLongPress = onLongPress
        // Re-inject chiều cao status bar thật sau mỗi layout pass (xoay
        // màn hình / thay đổi kích thước → giá trị an toàn mới).
        controller.injectStatusBarInsetPublic()
    }
}
