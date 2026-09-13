import SwiftUI
import AVKit
import UIKit

/// Player kênh Live TV (presented như sheet từ ContentView).
///
/// HƯỚNG MÀN HÌNH (chế độ TV LANDSCAPE):
/// - Video NGANG (16:9/4:3): khi phát hiện (từ track của asset stream) →
///   BUỘC app xoay LANDSCAPE (requestGeometryUpdate iOS 16+, KVC iOS 15),
///   video fill cả màn hình, không còn thanh đen — DUYỆT cả khi iPhone đang
///   bật khóa xoay (không cần mở khóa, không cần tự nghiêng máy).
/// - Video DỌC: KHÔNG xoay, hiển thị letterbox (giữ app ở chế độ TV).
/// - Đóng player: GIỮ NGUYÊN hướng landscape (bản cũ xoay về portrait ở đây
///   — làm app "lọt" về layout dọc giữa chừng sử dụng; đã loại bỏ).
struct PlayerView: View {
    let channel: Channel
    @StateObject private var manager = AVPlayerManager()
    @State private var showControls = true
    @State private var deviceOrientation = UIDevice.current.orientation
    // iPhone: portrait → .compact; landscape → .regular (kích hoạt re-render khi xoay).
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var isLandscapeUI: Bool { horizontalSizeClass == .regular }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Color.black
                // GravityVideoPlayer = AVPlayerViewController (view bên
                // trong của SwiftUI VideoPlayer) nhưng để set được
                // videoGravity → nút FIT/FILL. Controls native (tap để
                // hiện/ẩn, seek, PiP) giữ nguyên như VideoPlayer.
                GravityVideoPlayer(player: manager.player,
                                   gravity: manager.videoGravity)

                if case .loading = manager.state {
                    overlay {
                        VStack(spacing: 12) {
                            ProgressView().tint(.white)
                            Text("Đang tải stream…")
                                .font(.footnote)
                                .foregroundColor(.white.opacity(0.8))
                        }
                    }
                } else if case .failed(let message) = manager.state {
                    overlay {
                        VStack(spacing: 10) {
                            Image(systemName: "wifi.exclamationmark")
                                .font(.largeTitle)
                                .foregroundColor(.orange)
                            Text("Không phát được stream")
                                .font(.headline)
                                .foregroundColor(.white)
                            Text(message)
                                .font(.footnote)
                                .foregroundColor(.gray)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 24)
                            Button("Thử lại") {
                                manager.retry()
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    }
                }
            }
            // Dọc (layout mặc định — GIỮ NGUYÊN như trước): box 16:9.
            // Ngang: bỏ ràng buộc box + bỏ safe area → video fill cả màn hình.
            .aspectRatio(isLandscapeUI ? nil : 16 / 9, contentMode: .fit)
            .ignoresSafeArea(isLandscapeUI ? .all : [])

            if !isLandscapeUI {
                if showControls {
                    controlsBar
                }
                Spacer()
            }
        }
        // Ngang: thanh điều khiển đặt overlay dưới đáy video (ngang không có
        // chỗ trống bên dưới), nền tối mờ để đọc được trên video sáng.
        .overlay(alignment: .bottom) {
            if isLandscapeUI && showControls {
                controlsBar
                    .environment(\.colorScheme, .dark)
                    .padding(.horizontal)
                    .background(Color.black.opacity(0.5))
            }
        }
        .background(Color.black.ignoresSafeArea())
        .onAppear {
            manager.load(urlString: channel.currentURL)
            // Trong trường hợp hướng đã được phát hiện sẵn (stream load nhanh)
            // — xoay ngay.
            if manager.videoIsLandscape == true {
                setInterfaceLandscape(true)
            }
        }
        // Hướng video mới phát hiện: NGANG → buộc landscape fullscreen
        // (độc lập với khóa xoay thiết bị — giống tab MOVIE).
        // Dọc/không rõ → không làm gì, giữ hướng hiện tại.
        .onChange(of: manager.videoIsLandscape) { landscape in
            if landscape == true {
                setInterfaceLandscape(true)
            }
        }
        // Trong khi đang phát video NGANG: nếu người dùng tự xoay màn hình
        // về dọc → đưa về landscape lại (giữ chế độ xem ngang — hành vi
        // giống tab MOVIE). Video dọc: được xoay tự do, không ép lại.
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
            deviceOrientation = UIDevice.current.orientation
            if manager.videoIsLandscape == true,
               !deviceOrientation.isLandscape,
               deviceOrientation != .faceUp,
               deviceOrientation != .faceDown {
                setInterfaceLandscape(true)
            }
        }
        .onDisappear {
            manager.stop()
            // App BinTV = chế độ TV LANDSCAPE: đóng player KHÔNG xoay về
            // portrait (giữ layout ngang cho các tab).
        }
    }

    /// Thanh điều khiển — dùng chung 2 hướng: dọc = bên dưới video (giữ
    /// nguyên vị trí cũ), ngang = overlay dưới đáy video.
    private var controlsBar: some View {
        HStack(spacing: 14) {
            Button(action: { manager.togglePlayPause() }) {
                Image(systemName: manager.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.title2)
            }
            .disabled(manager.state == .loading)

            // FIT/FILL (đồng bộ UX player):
            // FIT  = letterbox (giữ nguyên khung hình, có thể có thanh đen).
            // FILL = lấp đầy màn hình (cắt cạnh thừa). Không bao giờ stretch.
            Button(action: { manager.toggleFitFill() }) {
                VStack(spacing: 2) {
                    Image(systemName: manager.videoGravity == .resizeAspect
                          ? "arrow.up.backward.and.arrow.down.forward"
                          : "arrow.down.right.and.arrow.up.left")
                        .font(.title3)
                    Text(manager.videoGravity == .resizeAspect ? "FIT" : "FILL")
                        .font(.caption2)
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(channel.name)
                    .font(.headline)
                Text(channel.currentURL)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer()

            // Ẩn/hiện thanh điều khiển (immersive). VideoPlayer vẫn giữ
            // controls native: seek, fullscreen, PiP khi chạm vào video.
            Button(action: { withAnimation { showControls.toggle() } }) {
                Image(systemName: showControls
                      ? "arrow.down.right.and.arrow.up.left"
                      : "arrow.up.left.and.arrow.down.right")
            }
        }
        .padding()
    }

    // MARK: - Orientation (cùng cơ chế với tab MOVIE)

    /// Buộc hướng giao diện bằng cơ chế chính thức — DUYỆT cả khi người
    /// dùng đang bật khóa xoay (Rotation Lock):
    /// - iOS 16+: `scene.requestGeometryUpdate(.iOS(interfaceOrientations:))`.
    /// - iOS 15:  `UIDevice.orientation` (KVC — giá trị UIDeviceOrientation).
    ///
    /// [FIX 2026-09-12 — KHÓA CỨNG LANDSCAPE]: BinTV là app chế độ TV,
    /// không tồn tại trạng thái portrait. Bản cũ nhận `landscape: Bool`
    /// và khi `false` sẽ request `.portrait` — một "cửa sau" phá khóa
    /// ngang (dù call-site hiện tại chỉ truyền true, đây là landmine cho
    /// mọi sửa đổi sau này). Nay `false` = NO-OP (giữ nguyên landscape),
    /// KHÔNG BAO GIỜ request portrait. Không chạm vào video / player —
    /// stream tiếp tục phát nguyên vẹn.
    private func setInterfaceLandscape(_ landscape: Bool) {
        guard landscape else { return }
        let orientations: UIInterfaceOrientationMask = [.landscapeLeft, .landscapeRight]
        if #available(iOS 16.0, *) {
            let scene = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive }
            scene?.requestGeometryUpdate(.iOS(interfaceOrientations: orientations))
        } else {
            // KVC trên UIDevice phải dùng UIDeviceOrientation (device
            // landscapeLeft ↔ interface landscapeRight — đều là ngang).
            UIDevice.current.setValue(UIDeviceOrientation.landscapeLeft.rawValue, forKey: "orientation")
        }
    }

    private func overlay<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ZStack {
            Color.black.opacity(0.55)
            content()
        }
    }
}

/// AVPlayerViewController qua **UIViewControllerRepresentable** — vừa set
/// được `videoGravity` vừa có containment đúng (SwiftUI tự `addChild`).
///
/// AVPlayerViewController CHÍNH LÀ view controller đứng sau SwiftUI
/// VideoPlayer nên behavior native giữ nguyên: tap video = hiện/ẩn
/// controls, nút seek, PiP, fullscreen của AVKit.
///
/// -------------------------------------------------------------------
/// [FIX 2026-09-12, build 223 — NÚT FULLSCREEN: ĐEN MÀN HÌNH + DỪNG PHÁT]
/// -------------------------------------------------------------------
/// Bản cũ dùng `UIViewRepresentable` và trả `coordinator.view` — tức là lấy
/// VIEW của AVPlayerViewController nhét vào hierarchy SwiftUI mà KHÔNG BAO
/// GIỜ `addChild(_:)`: VC đứng ngoài hệ thống (không parent, không nằm
/// trong responder chain). Nút fullscreen (mũi tên 2 chiều) kích hoạt
/// **full screen presentation** — một thao tác CẤP VIEW CONTROLLER, cần VC
/// cha để present. Thiếu cha → AVKit dựng vùng chứa fullscreen không bao
/// giờ hiển thị ⇒ **màn hình đen**, đồng thời AVKit **PAUSE player** trong
/// lúc chuyển ⇒ **video bị gián đoạn** (đúng 2 triệu chứng người dùng báo).
///
/// CÁCH SỬA (2 phần, đều bằng API công khai):
///   1. Đổi sang `UIViewControllerRepresentable` → SwiftUI tự addChild →
///      containment đúng → fullscreen presentation có VC cha để present.
///   2. Coordinator làm `AVPlayerViewControllerDelegate`: ghi nhận player
///      đang phát trước khi chuyển và gọi lại `play()` SAU khi transition
///      kết thúc (bù đúng hành vi pause của AVKit) — cả khi VÀO lẫn khi
///      THOÁT fullscreen. Riêng PiP: KHÔNG tự đóng player inline (đóng =
///      mất video → đen).
private struct GravityVideoPlayer: UIViewControllerRepresentable {
    let player: AVPlayer
    let gravity: AVLayerVideoGravity

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.videoGravity = gravity
        // Theo dõi fullscreen để GIỮ PHÁT (bù pause của AVKit).
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController,
                                context: Context) {
        // Chỉ gán lại khi THẬT SỰ khác — gán lại vô điều kiện có thể làm
        // gián đoạn phát mỗi lần SwiftUI render lại.
        if controller.player !== player {
            controller.player = player
        }
        // So bằng rawValue (String) — chắc chắn hợp lệ với mọi SDK, không
        // phụ thuộc Equatable của AVLayerVideoGravity.
        if controller.videoGravity.rawValue != gravity.rawValue {
            controller.videoGravity = gravity
        }
        controller.delegate = context.coordinator
    }

    /// Giữ player sống sót qua các lần render/fullscreen: KHÔNG tháo
    /// `player` ở đây (tháo = dừng phát ngay lập tức).
    static func dismantleUIViewController(_ controller: AVPlayerViewController,
                                          coordinator: Coordinator) {
        // Cố tình không gán controller.player = nil.
    }

    /// Đại diện xử lý fullscreen — lý do tồn tại duy nhất: KHÔNG ĐỂ MẤT
    /// PHÁT khi AVKit chuyển đổi chế độ trình bày.
    final class Coordinator: NSObject, AVPlayerViewControllerDelegate {
        /// Đang phát trước khi bắt đầu chuyển? (AVKit sẽ pause trong lúc
        /// chuyển → dùng để khôi phục đúng trạng thái sau transition).
        private var wasPlayingBeforeTransition = false

        /// VÀO fullscreen.
        func playerViewController(
            _ playerViewController: AVPlayerViewController,
            willBeginFullScreenPresentationWithAnimationCoordinator
                coordinator: UIViewControllerTransitionCoordinator) {
            wasPlayingBeforeTransition = (playerViewController.player?.rate ?? 0) > 0
            coordinator.animate(alongsideTransition: nil) { [weak self] context in
                guard let self = self, !context.isCancelled else { return }
                // Transition xong: AVKit đã pause → PHÁT LẠI nếu trước đó
                // đang phát (đây chính là phần "video bị gián đoạn").
                if self.wasPlayingBeforeTransition {
                    playerViewController.player?.play()
                }
            }
        }

        /// THOÁT fullscreen (về lại inline trong sheet).
        func playerViewController(
            _ playerViewController: AVPlayerViewController,
            willEndFullScreenPresentationWithAnimationCoordinator
                coordinator: UIViewControllerTransitionCoordinator) {
            let wasPlaying = (playerViewController.player?.rate ?? 0) > 0
            coordinator.animate(alongsideTransition: nil) { context in
                guard !context.isCancelled else { return }
                if wasPlaying {
                    playerViewController.player?.play()
                }
            }
        }

        /// Bắt đầu PiP: KHÔNG tự đóng player inline — đóng sẽ làm mất video
        /// (màn hình đen) trong khi âm thanh vẫn chạy.
        func playerViewControllerShouldAutomaticallyDismissAtPictureInPictureStart(
            _ playerViewController: AVPlayerViewController) -> Bool {
            return false
        }
    }
}
