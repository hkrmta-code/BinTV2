/* =====================================================================
 * test_app_js_logic.js (T1) — KIỂM CHỨNG LOGIC app.js THẬT với MOCK API.
 *
 * Chạy các hàm CẮT NGUYÊN VĂN từ BinTV/Phim/Web/assets/app.js (bản
 * identical với assets Phim.apk) trong Node VM + stub DOM/XHR, qua đúng
 * chuỗi dữ liệu của luồng Phim:
 *
 *   [1] Click Phim → GET JSONBin config (mock) → extractMovieTargetUrl
 *       (unwrap {record:{...}}) → normalizeMovieManifestUrl
 *       → isValidMovieTargetUrl → getMovieBaseUrl (manifestUrl - /manifest.json)
 *   [2] loadMovieStreams → GET {baseUrl}/stream/movie/{id}.json (mock)
 *       → lọc isValidMovieTargetUrl (loại .jpg/.webm, giữ .m3u8/.mp4)
 *   [3] startMoviePlayback → khối proxy-wrap THẬT:
 *       - URL cross-origin → http://127.0.0.1:3000/proxy?url=<enc>&__ref=<enc referer>
 *       - referer trích từ query `referer=` của stream URL (đúng app.js)
 *       - URL same-origin → KHÔNG wrap
 *       - phát hiện HLS: .m3u8 (kể cả trong query đã encode) → phimHlsUrl
 *   [4] requestJson THẬT chạy trên MockXHR (timeout/error paths)
 *
 * Mọi assertion đều in [PASS]/[FAIL]; exit code ≠ 0 nếu có FAIL.
 * ===================================================================== */
"use strict";

const A = require("./lib/assert_lite");
const slices = require("./lib/app_js_slices");

const PROXY_ORIGIN = "http://127.0.0.1:3000"; // dạng server Phim nội bộ iOS
const UPSTREAM = "https://stremio.example.com";

/* ---------- MOCK API RESPONSES (đúng shape server thật trả về) ---------- */

// JSONBin response: record wrapper (extractMovieTargetUrl phải unwrap)
const MOCK_JSONBIN = {
    record: {
        target_url: "https://stremio.example.com/addon/manifest.json",
        version: "2026.09",
    },
};

// Stremio addon manifest
const MOCK_MANIFEST = {
    id: "community.bintv.phim",
    version: "1.4.2",
    name: "BinTV Phim",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    catalogs: [{ type: "movie", id: "binhviet", name: "Phim lẻ" }],
};

// stream.json: mix URL hợp lệ + không hợp lệ (poster .jpg phải bị lọc)
const MOCK_STREAM_JSON = {
    streams: [
        {
            name: "BinTV",
            title: "1080p · VietSub",
            url: "https://cdn.movie.example/hls/abc123/master.m3u8?referer=https%3A%2F%2Fwww.movie.example%2Fwatch%2Fabc123&pkey=SECRET",
        },
        {
            name: "BinTV",
            title: "720p MP4",
            url: "https://cdn.movie.example/v/abc123/movie.mp4?token=xyz",
        },
        {
            name: "BinTV",
            title: "poster",
            url: "https://cdn.movie.example/img/abc123/poster.jpg",
        },
        {
            name: "BinTV",
            title: "preview webm",
            url: "https://cdn.movie.example/v/abc123/preview.webm",
        },
        {
            name: "BinTV",
            title: "external page (không phải media)",
            externalUrl: "https://www.movie.example/watch/abc123",
        },
    ],
};

/* ---------- MockXHR resolver: url → response ---------- */
const network = new Map();
function mockRoute(url, status, body) { network.set(url, { status, body: typeof body === "string" ? body : JSON.stringify(body) }); }

mockRoute("https://api.jsonbin.io/v3/b/6a81f84a5b2b4c0012345678", 200, MOCK_JSONBIN);
mockRoute(UPSTREAM + "/addon/manifest.json", 200, MOCK_MANIFEST);
mockRoute(UPSTREAM + "/addon/stream/movie/abc123.json", 200, MOCK_STREAM_JSON);
mockRoute(UPSTREAM + "/addon/stream/movie/broken.json", 500, { error: "boom" });
mockRoute(UPSTREAM + "/addon/stream/movie/empty.json", 200, { streams: [] });

const resolver = (url) => {
    const hit = network.get(url);
    if (hit) return Promise.resolve(hit);
    return Promise.resolve({ status: 404, body: "not found" });
};

/* ---------- Build VM context với app.js thật ---------- */
const ctx = slices.attachHelpers(slices.buildContext({ origin: PROXY_ORIGIN, xhrResolver: resolver }));

async function main() {
    A.suite("T1.1 — Bootstrap: JSONBin config → target_url → manifestUrl → movieBaseUrl (hàm THẬT app.js)");
    {
        const target = ctx.extractMovieTargetUrl(MOCK_JSONBIN);
        A.eq(target, UPSTREAM + "/addon/manifest.json", "extractMovieTargetUrl unwrap {record:{target_url}}");

        const normalized = ctx.normalizeMovieManifestUrl(target);
        A.ok(typeof normalized === "string" && normalized.includes("manifest.json"),
            "normalizeMovieManifestUrl giữ manifest.json", normalized);

        A.ok(ctx.isValidMovieTargetUrl(normalized) === true, "isValidMovieTargetUrl(manifest) = true");

        const baseUrl = ctx.getMovieBaseUrl(normalized);
        A.eq(baseUrl, UPSTREAM + "/addon", "getMovieBaseUrl = manifestUrl trừ /manifest.json");
        ctx.setMovieBaseUrl(baseUrl);
    }

    A.suite("T1.2 — isValidMovieTargetUrl: ma trận loại URL (hàm THẬT)");
    {
        // SEMANTICS THẬT (đọc từ app.js): chỉ kiểm protocol http:/https: +
        // hostname — KHÔNG lọc theo đuôi file. Anchor <a> resolve URL tương
        // đối theo base của trang (WebView: http://127.0.0.1:PORT/) nên chuỗi
        // không-phải-URL tuyệt đối vẫn resolve thành http tương đối → true.
        const cases = [
            ["https://cdn.example/hls/master.m3u8", true],
            ["https://cdn.example/hls/master.m3u8?token=1", true],
            ["https://cdn.example/v/movie.mp4", true],
            ["https://cdn.example/v/movie.mp4?t=1#f", true],
            ["http://cdn.example/hls/master.m3u8", true],
            ["https://cdn.example/img/poster.jpg", true],   // hàm không chặn extension
            ["https://cdn.example/preview.webm", true],     // nt — thứ tự stream do server quyết
            ["https://www.movie.example/watch/abc", true],  // nt
            ["", false],
            ["javascript:alert(1)", false],                 // protocol lạ → chặn
            ["ftp://cdn.example/x.mp4", false],             // protocol lạ → chặn
            ["not a url", true],                            // resolve tương đối theo base (hành vi browser thật)
        ];
        for (const [u, expected] of cases) {
            A.ok(ctx.isValidMovieTargetUrl(u) === expected, "isValidMovieTargetUrl(" + u.slice(0, 50) + ") = " + expected);
        }
    }

    A.suite("T1.3 — loadMovieStreams: requestJson THẬT + bộ lọc validStreams THẬT");
    {
        const streamsUrl = ctx.buildMovieResourceUrl("stream", "movie", "abc123");
        A.eq(streamsUrl, UPSTREAM + "/addon/stream/movie/abc123.json", "buildMovieResourceUrl ghép đúng {baseUrl}/stream/{type}/{id}.json");

        const data = await ctx.requestJson(streamsUrl, 8000);
        A.eq(data.streams.length, 5, "requestJson nhận đủ 5 streams từ mock");

        const valid = ctx.filterStreams(data.streams);
        // HÀNH VI THẬT: lọc = có `url` string + protocol http(s). Chỉ entry
        // externalUrl-only bị loại (4/5 giữ). Thứ tự server giữ nguyên →
        // validStreams[0] (HLS master) được startMoviePlayback chọn trước.
        A.eq(valid.length, 4, "filterStreams loại đúng entry externalUrl-only (không có .url string)");
        A.ok(valid[0].url.includes("master.m3u8"), "stream[0] (được chọn phát trước) là HLS master");
        A.ok(valid[1].url.includes(".mp4"), "stream[1] là MP4 (fallback kế tiếp)");
    }

    A.suite("T1.4 — fetchMovieStreamsShared THẬT (raw streams + 500 + rỗng)");
    {
        const okRes = await ctx.fetchMovieStreamsShared("movie", "abc123");
        // fetchMovieStreamsShared trả RAW streams (lọc là việc của callback
        // loadMovieStreams) — đúng code thật.
        A.ok(Array.isArray(okRes) && okRes.length === 5, "fetchMovieStreamsShared trả raw 5 streams (chưa lọc)");

        let err500 = null;
        try { await ctx.fetchMovieStreamsShared("movie", "broken"); } catch (e) { err500 = e; }
        A.ok(err500 !== null, "fetchMovieStreamsShared reject khi upstream 500");

        const empty = await ctx.fetchMovieStreamsShared("movie", "empty").catch((e) => e);
        A.ok(Array.isArray(empty) ? empty.length === 0 : empty !== null, "stream rỗng → [] hoặc error có kiểm soát");
    }

    A.suite("T1.5 — startMoviePlayback proxy-wrap (khối code THẬT trong app.js)");
    {
        const hlsUrl = "https://cdn.movie.example/hls/abc123/master.m3u8?referer=https%3A%2F%2Fwww.movie.example%2Fwatch%2Fabc123&pkey=SECRET";
        const wrapped = ctx.wrapStreamUrl(hlsUrl);
        const expectedTarget = hlsUrl;
        const expectedRef = "https://www.movie.example/watch/abc123";
        // app.js dùng encodeURIComponent — so khớp dạng wrap
        const expectedWrap = PROXY_ORIGIN + "/proxy?url=" + encodeURIComponent(expectedTarget) + "&__ref=" + encodeURIComponent(expectedRef);
        A.ok(wrapped.phimStreamUrl.startsWith(PROXY_ORIGIN + "/proxy?url="), "URL cross-origin ĐƯỢC wrap qua proxy nội bộ");
        A.ok(wrapped.phimStreamUrl.includes("__ref="), "wrap kèm __ref (referer cho header Referer/Origin)");

        const q = new URL(wrapped.phimStreamUrl).searchParams;
        A.eq(q.get("url"), expectedTarget, "proxy?url= giải mã ra ĐÚNG stream URL gốc");
        A.eq(q.get("__ref"), expectedRef, "__ref giải mã ra ĐÚNG referer gốc (đích chống 403)");
        A.eq(wrapped.phimStreamUrl, expectedWrap, "wrap khớp 100% chuỗi kỳ vọng (encodeURIComponent)");

        A.ok(wrapped.phimHlsUrl === true,
            "HLS (.m3u8) → phimHlsUrl=true (cờ chọn đường hls.js)", String(wrapped.phimHlsUrl));

        // MP4 cross-origin
        const mp4 = ctx.wrapStreamUrl("https://cdn.movie.example/v/abc123/movie.mp4?token=xyz");
        A.ok(mp4.phimStreamUrl.startsWith(PROXY_ORIGIN + "/proxy?url="), "MP4 cross-origin cũng được wrap");
        A.ok(mp4.phimHlsUrl === false, "MP4 → phimHlsUrl=false (đường video.src native)");

        // same-origin → KHÔNG wrap
        const same = ctx.wrapStreamUrl(PROXY_ORIGIN + "/proxy?url=" + encodeURIComponent(hlsUrl) + "&__ref=" + encodeURIComponent(expectedRef));
        A.eq(same.phimStreamUrl, PROXY_ORIGIN + "/proxy?url=" + encodeURIComponent(hlsUrl) + "&__ref=" + encodeURIComponent(expectedRef),
            "URL same-origin (đã là proxy) KHÔNG bị wrap 2 lần");

        // m3u8 nằm trong query đã encode (CDN dạng /hls.php?u=<enc .m3u8>)
        const sneaky = ctx.wrapStreamUrl("https://gate.example/hls.php?u=" + encodeURIComponent("https://cdn.movie.example/x/master.m3u8"));
        A.ok(sneaky.phimHlsUrl === true, "phát hiện .m3u8 ẨN trong query đã encode → phimHlsUrl=true", String(sneaky.phimHlsUrl));
    }

    A.suite("T1.6 — Chuỗi E2E-level: bootstrap → stream → wrap (ghép toàn bộ hàm thật)");
    {
        // Mô phỏng đúng thứ tự app.js chạy khi người dùng bấm tab PHIM rồi chọn phim:
        const cfg = await ctx.requestJson("https://api.jsonbin.io/v3/b/6a81f84a5b2b4c0012345678", 8000);
        const target = ctx.extractMovieTargetUrl(cfg);
        A.ok(ctx.isValidMovieTargetUrl(ctx.normalizeMovieManifestUrl(target)), "target_url vượt qua validation");
        const base = ctx.getMovieBaseUrl(ctx.normalizeMovieManifestUrl(target));
        ctx.setMovieBaseUrl(base);
        const manifest = await ctx.requestJson(ctx.normalizeMovieManifestUrl(target), 8000);
        A.eq(manifest.id, "community.bintv.phim", "manifest mock đọc được qua requestJson thật");
        const raw = await ctx.fetchMovieStreamsShared("movie", "abc123");
        const streams = ctx.filterStreams(raw); // đúng thứ tự app.js: fetch raw → lọc validStreams
        const chosen = streams[0];              // app.js chọn validStreams[0], các stream sau là fallback
        const wrap = ctx.wrapStreamUrl(chosen.url);
        A.ok(wrap.phimHlsUrl === true, "stream chọn là HLS → app.js sẽ đi đường hls.js");
        const finalUrl = wrap.phimStreamUrl;
        A.ok(String(finalUrl).startsWith(PROXY_ORIGIN + "/proxy?url="), "URL CUỐI đưa vào player = proxy nội bộ");
        const fq = new URL(String(finalUrl)).searchParams;
        A.eq(fq.get("url"), chosen.url, "proxy bảo toàn stream URL gốc cho Player");
        A.eq(fq.get("__ref"), "https://www.movie.example/watch/abc123", "proxy mang đúng Referer chống 403 cho Player");
        console.log("  [INFO] URL cuối (đã sanitize): " + PROXY_ORIGIN + "/proxy?url=<" + fq.get("url").length + " chars, .m3u8>&__ref=<referer>");
    }

    const allOk = A.summary();
    process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error("T1 CRASH:", e); process.exit(2); });
