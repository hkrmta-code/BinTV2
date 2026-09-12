import SwiftUI
import UIKit

// =====================================================================
// ContentView — FULLSCREEN + LONG-PRESS OVERLAY MENU
// [FIX UI 2026-09-12, build 219]
//
// YÊU CẦU ĐÃ THỰC HIỆN:
// 1. LOẠI BỎ UI THỪA: thanh tab phía trên (BrowserTabBar của build 218)
//    bị KHAI TỬ cùng NewTabPageView/grabber; bottom menu bar của
//    UITabBarController vẫn bị ẩn VĨNH VIỄN bởi TabChromeController (cơ
//    chế có sẵn từ các bản trước — giữ nguyên văn).
// 2. FULLSCREEN EDGE-TO-EDGE: NavigationView{TabView} chiếm TRỌN
//    GeometryReader (0 spacing top/bottom) — nội dung tự lấp đầy vùng
//    của strip cũ. Safe area xử lý đúng: chrome overlay tôn trọng inset
//    (icon không lẹm notch/Dynamic Island), webview PHIM/TUBE full-bleed
//    như cũ (ignoresSafeArea ở chính các trang đó — không đổi).
// 3. ĐIỀU HƯỚNG MỚI: nhấn giữ ≥0.35s BẤT KỲ ĐÂU → overlay mờ + 4 icon
//    thuần (GestureOverlayMenuView); chạm icon → chuyển trang NGAY +
//    ẩn overlay; chạm nền → chỉ ẩn. Gesture plumbing GIỮ NGUYÊN VĂN cơ
//    chế UIKit đã kiểm chứng qua nhiều bản build (không xung đột
//    tap/scroll/video controls):
//      • TabChromeController: recognizer global trên view của
//        UITabBarController (delaysTouchesBegan=false → chạm/scroll tức
//        thì; cancelsTouchesInView=true → chỉ long-press thật mới hủy
//        touch) — phủ Live TV + Settings.
//      • Recognizer riêng gắn trực tiếp trên 2 webview TUBE/PHIM
//        (cancelsTouchesInView=false) — không đổi từ trước build 217.
//    Khi overlay HIỆN: nó nằm NGOÀI subtree của UITabBarController →
//    recognizer global không nhận touch trên overlay → không có vòng lặp
//    toggle; đóng bằng tap (icon/nền) — hành vi context-menu chuẩn.
//    Khi overlay ẨN: `if showMenu` → KHÔNG tồn tại trong hierarchy →
//    0% chặn touch nội dung.
// 4. BẢO TỒN: TabView selection Int + tag 0…3 NGUYÊN semantics cũ → 4
//    trang (LiveTVView/MovieListView/PhimView/SettingsView) sống nguyên
//    trong hierarchy, StateObject/singleton không bị tạo lại khi chuyển
//    trang (playback YouTube/Phim không gián đoạn); sheet PlayerView,
//    loadChannels, \.uiProps scaling (build 218) giữ nguyên.
//    ORIENTATION: không một dòng nào đụng 3 lớp khóa landscape.
// =====================================================================

struct ContentView: View {
    @EnvironmentObject var streamService: StreamService
    @EnvironmentObject var networkService: NetworkService

    /// Tag trang đang hiển thị (0…3 — đúng semantics TabView bản gốc).
    @State private var selectedTab = 0
    /// Overlay menu long-press đang hiện? (chỉ tồn tại trong hierarchy
    /// khi true — ẩn = không chặn touch).
    @State private var showMenu = false

    @State private var showingPlayer = false
    @State private var selectedStream: Channel? = nil

    var body: some View {
        GeometryReader { geo in
            // Hệ tỷ lệ thích ứng (build 218) — tính một lần, phát xuống
            // toàn cây: overlay menu + lưới Live TV + cột Settings + nút
            // nổi TUBE đều scale theo SE…Pro Max…iPad.
            let props = UIProportions(size: geo.size)

            NavigationView {
                tabContent
                    // FULLSCREEN: không nav bar hệ thống — nội dung chạm
                    // mép trên màn hình (không còn strip, không title bar).
                    .navigationBarHidden(true)
            }
            // iPad/landscape: buộc style stack — layout đơn trị toàn màn,
            // không bao giờ rơi vào split 2 cột của NavigationView.
            .navigationViewStyle(.stack)
            // ----- OVERLAY MENU (long-press) — phủ toàn màn, trên mọi
            // trang; chỉ trong hierarchy khi showMenu == true.
            .overlay {
                if showMenu {
                    GestureOverlayMenuView(selectedTab: $selectedTab,
                                           isPresented: $showMenu)
                        .transition(.opacity)
                }
            }
            .environment(\.uiProps, props)
            // Phản hồi tức thì (Rule 3): fade ngắn 0.15s cho ẩn/hiện.
            .animation(.easeInOut(duration: 0.15), value: showMenu)
        }
        // Player Live TV — sheet + logic GIỮ NGUYÊN 100% từ bản gốc
        // (.id(channel.id): mỗi kênh một AVPlayerManager mới).
        .sheet(isPresented: $showingPlayer) {
            if let stream = selectedStream {
                PlayerView(channel: stream)
                    .id(stream.id)
            }
        }
        // Cơ chế CŨ giữ nguyên văn: (1) ẩn VĨNH VIỄN bottom tab bar của
        // UITabBarController (yêu cầu "xóa menu bar phía dưới"), (2) gắn
        // long-press global ≥0.35s → mở overlay menu.
        .background(
            TabChromeController(onLongPress: { toggleOverlayMenu() })
                .frame(width: 0, height: 0)
        )
        .onAppear {
            Task { await streamService.loadChannels() }
        }
    }

    // =================================================================
    // 4 TRANG — tag 0…3 NGUYÊN VĂN semantics cũ; chỉ đổi đích callback
    // long-press của 2 webview (trước: toggle strip 218 / menu cũ; nay:
    // mở overlay menu). Toàn bộ logic con KHÔNG đổi.
    // =================================================================
    private var tabContent: some View {
        TabView(selection: $selectedTab) {
            LiveTVView(channels: streamService.channels, onSelect: { ch in
                selectedStream = ch
                showingPlayer = true
            })
            .tabItem { Label("Live TV", systemImage: "tv") }
            .tag(BinTVPage.liveTV.rawValue)

            MovieListView(onLongPress: { toggleOverlayMenu() })
                .tabItem { Label("TUBE", systemImage: "film") }
                .tag(BinTVPage.tube.rawValue)

            PhimView(onLongPress: { toggleOverlayMenu() })
                .tabItem { Label("PHIM", systemImage: "popcorn") }
                .tag(BinTVPage.phim.rawValue)

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gear") }
                .tag(BinTVPage.settings.rawValue)
        }
    }

    // =================================================================
    // Long-press (mọi recognizer) → toggle overlay menu + haptic nhẹ.
    // IDEMPOTENT với trạng thái hiện tại: đang mở thì giữ nguyên (một lần
    // nhấn giữ có thể kích hoạt nhiều recognizer cùng lúc — global +
    // webview riêng — không muốn ẩn/hiện nhấp nháy 2 lần).
    // =================================================================
    private func toggleOverlayMenu() {
        guard !showMenu else { return }
        showMenu = true
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
}

// MARK: - TabChrome: ẩn vĩnh viễn bottom tab bar + long-press global

/// Long-press recognizer đặc trưng — nhận diện để KHÔNG gắn 2 lần.
///
/// - `delaysTouchesBegan = false` (mặc định): touch được giao ngay cho
///   view (list kênh / webview / video) — KHÔNG trễ 0.35s → tap nhanh
///   và scroll hoạt động bình thường, không "chờ" recognizer.
/// - `cancelsTouchesInView = true` (mặc định): chỉ KHI giữ đủ 0.35s
///   (long-press thành công → menu mở) thì touch mới bị huỷ → không
///   có "click oan" lên kênh/video/quảng cáo trong web khi rời ngón.
///   Ngón DI CHUYỂN (scroll) → long-press tự fail trước 0.35s →
///   touch không bị huỷ → scroll không ảnh hưởng.
final class BinTVMenuLongPressRecognizer: UILongPressGestureRecognizer {
    override init(target: Any?, action: Selector?) {
        super.init(target: target, action: action)
        delaysTouchesBegan = false
        minimumPressDuration = 0.35
    }
}

/// 1) Bottom tab bar LUÔN ẩn (fullscreen — overlay menu long-press là
///    cơ chế điều hướng DUY NHẤT, không còn thanh bar nào khác).
/// 2) Gắn MỘT long-press recognizer lên view của UITabBarController →
///    nhận long-press ở BẤT KỲ vị trí nào trong nội dung tab (list
///    kênh, form settings, webview TUBE/PHIM) — recognizer trên view
///    tổ thân nhận touch của MỌI view con; delaysTouchesBegan=false
///    nên tap/swipe/scroll/video-controls diễn ra bình thường, và
///    click chỉ bị huỷ khi long-press thật sự thành công.
///
/// Retry: lần đầu render, VC này có thể chưa được nhúng vào hierarchy
/// (vc.parent = nil) → retry 0.1s × 10 nhịp. Sau khi tìm được
/// UITabBarController: idempotent (isHidden giữ, recognizer gắn 1 lần).
///
/// [NGUYÊN VĂN] Cơ chế này đã ship và chạy ổn định qua các bản 216→218
/// — giữ từng dòng, chỉ đổi ngữ nghĩa callback đích ở ContentView
/// (revealTabMenu → toggle strip → toggleOverlayMenu).
private struct TabChromeController: UIViewControllerRepresentable {
    var onLongPress: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onLongPress: onLongPress)
    }

    func makeUIViewController(context: Context) -> UIViewController {
        UIViewController()
    }

    func updateUIViewController(_ vc: UIViewController, context: Context) {
        context.coordinator.onLongPress = onLongPress
        context.coordinator.apply(to: vc)
    }

    final class Coordinator: NSObject {
        var onLongPress: () -> Void
        private var retries = 0

        init(onLongPress: @escaping () -> Void) {
            self.onLongPress = onLongPress
        }

        func apply(to vc: UIViewController) {
            var responder: UIViewController? = vc
            while let r = responder, !(r is UITabBarController) {
                responder = r.parent
            }
            guard let tbc = responder as? UITabBarController else {
                // Hierarchy chưa sẵn sàng — retry ngắn.
                guard retries < 10 else { return }
                retries += 1
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self, weak vc] in
                    guard let self = self, let vc = vc else { return }
                    self.apply(to: vc)
                }
                return
            }

            // (1) Bottom tab bar luôn ẩn (không animate — tránh animation
            // bị cancel giữa các layout pass; layoutIfNeeded để nội dung
            // mở rộng xuống đáy ngay trong cùng pass).
            if !tbc.tabBar.isHidden {
                tbc.tabBar.isHidden = true
                tbc.view.layoutIfNeeded()
            }

            // (2) Long-press global — gắn 1 lần duy nhất.
            let alreadyAttached = tbc.view.gestureRecognizers?
                .contains { $0 is BinTVMenuLongPressRecognizer } ?? false
            if !alreadyAttached {
                let recognizer = BinTVMenuLongPressRecognizer(
                    target: self, action: #selector(handleLongPress(_:))
                )
                tbc.view.addGestureRecognizer(recognizer)
            }
        }

        @objc private func handleLongPress(_ recognizer: UILongPressGestureRecognizer) {
            guard recognizer.state == .began else { return }
            onLongPress()
        }
    }
}
