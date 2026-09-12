/* =====================================================================
 * test_m3u8_rewrite.js (T2) — kiểm chứng BẢN PORT (swift_mirror.js) của
 * rewriteM3u8Urls + các hàm thuần trong PhimLocalServer.swift:
 *   encodeQueryValue (:1158) / originOf (:1146) / baseUrlOf (:1153) /
 *   proxifyM3u8Value (:1167) / rewriteUriAttrs (:1191) /
 *   rewriteM3u8Urls (:1213) / rewriteRedirectLocation (:1031-1046).
 *
 * Đây là test ALGORITHM (port 1:1 sang JS vì sandbox không có Swift
 * toolchain). Tính đúng đắn của bản port so với Swift được đảm bảo bằng
 * đối chiếu từng dòng (comment trong swift_mirror.js trỏ về dòng Swift).
 * Các vector phủ: master/variant playlist, EXT-X-KEY, EXT-X-MAP, relative
 * children, chống double-proxy, __ref propagation, CRLF, encoding edge
 * cases (space, dấu sao, dấu ngã, UTF-8 đa byte, hex uppercase).
 * ===================================================================== */
"use strict";

const A = require("./lib/assert_lite");
const M = require("./lib/swift_mirror");

const BASE = "https://cdn.movie.example/hls/abc123/";
const REFERER = "https://www.movie.example/watch/abc123";
const REF_SUFFIX = "&__ref=" + M.encodeQueryValue(REFERER);

function proxied(target, withRef) {
    return "/proxy?url=" + M.encodeQueryValue(target) + (withRef ? REF_SUFFIX : "");
}

A.suite("T2.1 — encodeQueryValue (mirror Swift :1158, khớp Java URLEncoder biến thể)");
{
    const cases = [
        ["https://a.com/x.m3u8?t=1", "https%3A%2F%2Fa.com%2Fx.m3u8%3Ft%3D1"],
        ["a b", "a%20b"],                    // space → %20 (KHÔNG phải +)
        ["a*b", "a%2Ab"],                    // * → %2A (hex uppercase)
        ["a~b", "a~b"],                      // ~ giữ nguyên
        ["a-b_c.d", "a-b_c.d"],              // - _ . giữ nguyên
        ["Việt", "Vi%E1%BB%87t"],            // UTF-8 đa byte, hex uppercase (V,i ASCII giữ nguyên)
        ["", ""],
    ];
    for (const [input, expected] of cases) {
        A.eq(M.encodeQueryValue(input), expected, "encode(" + JSON.stringify(input) + ")");
    }
    // Invariant: decodeURIComponent(encode(x)) === x với mọi x
    const samples = ["https://x.com/p?q=1&r=2#f", "a b*c~d-_.e", "Việt Nam 🎬", "%2Falready", "key=SECRET&sig=a/b"];
    for (const s of samples) {
        A.ok(decodeURIComponent(M.encodeQueryValue(s)) === s, "round-trip decode OK: " + JSON.stringify(s).slice(0, 40));
    }
}

A.suite("T2.2 — originOf / baseUrlOf (mirror Swift :1146/:1153, giữ port tường minh kiểu Foundation)");
{
    A.eq(M.originOf("https://cdn.movie.example/hls/abc123/master.m3u8"), "https://cdn.movie.example", "originOf https không port");
    A.eq(M.originOf("http://cdn.movie.example:8080/a/b.m3u8"), "http://cdn.movie.example:8080", "originOf giữ port tường minh");
    A.eq(M.originOf("http://cdn.movie.example:80/a"), "http://cdn.movie.example:80", "originOf Foundation giữ :80 tường minh (KHÁC WHATWG)");
    A.eq(M.originOf("not-a-url"), "", "originOf chuỗi không parse → rỗng");
    A.eq(M.baseUrlOf("https://cdn.movie.example/hls/abc123/master.m3u8"), "https://cdn.movie.example/hls/abc123/", "baseUrlOf = đường dẫn thư mục");
    A.eq(M.baseUrlOf("https://cdn.movie.example/hls/abc123/"), "https://cdn.movie.example/hls/abc123/", "baseUrlOf idempotent với trailing slash");
    A.eq(M.baseUrlOf("noslash"), "", "baseUrlOf không có slash → rỗng");
}

A.suite("T2.3 — rewriteM3u8Urls: MASTER playlist (variant relative + absolute, có referer)");
{
    const master = [
        "#EXTM3U",
        "#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720",
        "720p.m3u8",
        "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080",
        "https://cdn.movie.example/hls/abc123/1080p.m3u8",
        "#EXT-X-STREAM-INF:BANDWIDTH=800000",
        "audio/only.m3u8?lang=vi",
        "",
    ].join("\n");
    const out = M.rewriteM3u8Urls(master, BASE, REFERER);
    const lines = out.split("\n");
    A.eq(lines[0], "#EXTM3U", "#EXTM3U giữ nguyên");
    A.eq(lines[1], "#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720", "dòng #EXT-X-STREAM-INF không URI= giữ nguyên");
    A.eq(lines[2], proxied(BASE + "720p.m3u8", true), "variant RELATIVE → resolve theo baseUrl → wrap /proxy + __ref");
    A.eq(lines[4], proxied("https://cdn.movie.example/hls/abc123/1080p.m3u8", true), "variant ABSOLUTE → wrap /proxy + __ref");
    A.eq(lines[6], proxied(BASE + "audio/only.m3u8?lang=vi", true), "variant relative có query → resolve + wrap, query encode trong url=");
    A.eq(lines[7], "", "dòng rỗng giữ nguyên");
    A.ok(!out.includes("https://cdn.movie.example/hls/abc123/720p.m3u8\n"), "không còn child tuyệt đối TRẦN ngoài /proxy");
    // Mọi child đều đi qua proxy: đếm
    A.eq((out.match(/\/proxy\?url=/g) || []).length, 3, "đúng 3 child được proxy");
    A.eq((out.match(/__ref=/g) || []).length, 3, "__ref gắn cho cả 3 child (Referer chống 403 lan truyền)");
}

A.suite("T2.4 — rewriteM3u8Urls: MEDIA playlist (EXT-X-KEY + EXT-X-MAP + segments)");
{
    const media = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        '#EXT-X-KEY:METHOD=AES-128,URI="https://key.example/k.bin?token=SECRET123",IV=0x00000001',
        '#EXT-X-MAP:URI="init.mp4"',
        "#EXTINF:6.000,",
        "seg1.ts?sig=abc",
        "#EXTINF:6.000,",
        "/abs/path/seg2.ts",
        "#EXT-X-ENDLIST",
    ].join("\n");
    const out = M.rewriteM3u8Urls(media, BASE, REFERER);
    const lines = out.split("\n");
    A.eq(lines[2],
        '#EXT-X-KEY:METHOD=AES-128,URI="' + proxied("https://key.example/k.bin?token=SECRET123", true) + '",IV=0x00000001',
        "EXT-X-KEY URI= được proxy (key AES-128 tải qua proxy, token nằm trong url= đã encode) — IV giữ nguyên");
    A.eq(lines[3], '#EXT-X-MAP:URI="' + proxied(BASE + "init.mp4", true) + '"', "EXT-X-MAP URI= relative được proxy");
    A.eq(lines[5], proxied(BASE + "seg1.ts?sig=abc", true), "segment relative + query được proxy");
    A.eq(lines[7], proxied("https://cdn.movie.example/abs/path/seg2.ts", true), "segment /abs/path resolve theo ORIGIN của baseUrl");
    A.eq(lines[4], "#EXTINF:6.000,", "#EXTINF giữ nguyên");
    A.eq(lines[8], "#EXT-X-ENDLIST", "#EXT-X-ENDLIST giữ nguyên");
}

A.suite("T2.5 — chống double-proxy + __ref bổ sung (parity server.js/MediaProxyServer.java)");
{
    const selfOrigin = "https://proxy.example.com";
    const base = selfOrigin + "/hls/x/";
    const already = selfOrigin + "/proxy?url=" + M.encodeQueryValue("https://up.example/a.m3u8");
    const alreadyWithRef = already + "&__ref=" + M.encodeQueryValue(REFERER);
    const playlist = [
        "#EXTM3U",
        already,            // đã là proxy cùng origin, KHÔNG có __ref → chỉ BÙ __ref
        alreadyWithRef,     // đã có __ref → giữ nguyên tuyệt đối
        "https://up.example/b.m3u8", // khác origin → wrap mới
    ].join("\n");
    const out = M.rewriteM3u8Urls(playlist, base, REFERER);
    const lines = out.split("\n");
    A.eq(lines[1], alreadyWithRef, "child đã-proxied cùng origin: KHÔNG wrap lại, chỉ bù __ref");
    A.eq(lines[2], alreadyWithRef, "child đã-proxied + có __ref: giữ nguyên 100%");
    A.eq(lines[3], proxied("https://up.example/b.m3u8", true).replace("&__ref=", "&__ref="), "child khác origin: wrap /proxy mới");
    // Không có prefix origin trong lines[3] vì wrap là relative /proxy (same-origin server Phim)
    A.ok(!lines[3].startsWith(selfOrigin), "wrap mới là đường dẫn tương đối /proxy (phục vụ từ chính server nội bộ)");
}

A.suite("T2.6 — CRLF + không referer + giá trị không proxy được");
{
    const crlf = "#EXTM3U\r\nseg1.ts\r\nseg2.ts\r\n";
    const out = M.rewriteM3u8Urls(crlf, BASE, null);
    A.ok(!out.includes("\r"), "CRLF chuẩn hóa về LF");
    const lines = out.split("\n");
    A.eq(lines[1], "/proxy?url=" + M.encodeQueryValue(BASE + "seg1.ts"), "không referer → không __ref");
    // giá trị rác (không resolve được, baseUrl rỗng) → trả nguyên văn (parity Swift guard)
    A.eq(M.proxifyM3u8Value("seg.ts", "", "", ""), "seg.ts", "baseUrl rỗng + relative → giữ nguyên (guard Swift)");
    A.eq(M.proxifyM3u8Value("", BASE, "", ""), "", "chuỗi rỗng → giữ nguyên");
    A.eq(M.proxifyM3u8Value('"quoted.ts"', BASE, "", ""), "/proxy?url=" + M.encodeQueryValue(BASE + "quoted.ts"), "trim nháy ngoài → resolve");
    A.eq(M.proxifyM3u8Value("  spaced.ts  ", BASE, "", ""), "/proxy?url=" + M.encodeQueryValue(BASE + "spaced.ts"), "trim whitespace → resolve");
    // Parity Swift: nháy nằm TRONG whitespace (" \"q.ts\" ") → Swift trim nháy
    // trước (dừng ở space) rồi trim space → nháy còn lại → resolve %22q.ts%22.
    // Mirror JS theo đúng thứ tự đó.
    A.eq(M.proxifyM3u8Value(' "q.ts" ', BASE, "", ""), "/proxy?url=" + M.encodeQueryValue(BASE + "%22q.ts%22"), "nháy trong space: parity Swift (nháy được percent-encode trong URL resolve)");
}

A.suite("T2.7 — rewriteRedirectLocation (mirror Swift :1031-1046)");
{
    A.eq(M.rewriteRedirectLocation("https://up.example/new/master.m3u8?t=1", REFERER),
        "/proxy?url=" + M.encodeQueryValue("https://up.example/new/master.m3u8?t=1") + REF_SUFFIX,
        "3xx Location tuyệt đối → bọc /proxy + __ref");
    A.eq(M.rewriteRedirectLocation("/relative/path.m3u8", REFERER), "/relative/path.m3u8", "Location tương đối giữ nguyên (parity server.js)");
    A.eq(M.rewriteRedirectLocation("https://up.example/x.m3u8", null),
        "/proxy?url=" + M.encodeQueryValue("https://up.example/x.m3u8"),
        "không referer → không __ref");
}

A.suite("T2.8 — isM3u8ContentType / urlLooksLikeM3u8 (mirror Swift :1112/:1118)");
{
    A.ok(M.isM3u8ContentType("application/vnd.apple.mpegurl"), "CT apple.mpegurl → true");
    A.ok(M.isM3u8ContentType("application/x-mpegURL; charset=utf-8"), "CT x-mpegURL (case-insensitive) → true");
    A.ok(!M.isM3u8ContentType("video/mp4"), "CT video/mp4 → false");
    A.ok(M.urlLooksLikeM3u8("https://x/a.m3u8"), "url .m3u8 → true");
    A.ok(M.urlLooksLikeM3u8("https://x/a.m3u8?t=1"), "url .m3u8?query → true");
    A.ok(!M.urlLooksLikeM3u8("https://x/a.m3u8x"), "url .m3u8x → false");
    A.ok(!M.urlLooksLikeM3u8("https://x/a.mp4"), "url .mp4 → false");
}

const allOk = A.summary();
process.exit(allOk ? 0 : 1);
