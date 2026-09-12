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

/// AVPlayerViewController qua UIViewRepresentable — để set được
/// `videoGravity` (SwiftUI `VideoPlayer` không expose thuộc tính này).
///
/// AVPlayerViewController CHÍNH LÀ view controller đứng sau SwiftUI
/// VideoPlayer nên behavior native giữ nguyên: tap video = hiện/ẩn
/// controls, nút seek, PiP, fullscreen của WebKit/AVKit.
///
/// AVPlayerViewController là UIViewController (UIViewRepresentable cần
/// UIView) → giữ reference trong Coordinator, trả `coordinator.view`.
private struct GravityVideoPlayer: UIViewRepresentable {
    let player: AVPlayer
    let gravity: AVLayerVideoGravity

    func makeCoordinator() -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.player = player
        vc.videoGravity = gravity
        return vc
    }

    func makeUIView(context: Context) -> UIView {
        let coordinator = context.coordinator
        coordinator.player = player
        coordinator.videoGravity = gravity
        return coordinator.view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        let coordinator = context.coordinator
        if coordinator.player !== player {
            coordinator.player = player
        }
        coordinator.videoGravity = gravity
    }
}
