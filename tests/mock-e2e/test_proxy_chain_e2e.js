/* =====================================================================
 * test_proxy_chain_e2e.js (T3) — E2E LUỒNG DỮ LIỆU THẬT QUA HTTP:
 *
 *   [app.js THẬT (slice nguyên văn, chạy Node VM)]
 *        │  Click Phim → JSONBin config → manifest → stream.json
 *        ▼
 *   MOCK CDN (lib/mock_cdn.js — gate Referer như CDN thật: thiếu → 403)
 *        ▲
 *        │  /proxy?url=&__ref= (header injection + m3u8 rewrite + redirect rewrite)
 *   MIRROR PROXY (lib/mirror_proxy.js — contract PhimLocalServer.swift,
 *                 rewrite = swift_mirror.js đã kiểm chứng T2 55/55)
 *        ▲
 *        │  wrapped URL (đúng dạng WKWebView/hls.js sẽ fetch trên iOS)
 *   [Khối proxy-wrap THẬT của startMoviePlayback]
 *
 * Verify: URL cuối hợp lệ + player nhận đúng URL + headers (Referer/UA/
 * Origin/Range) tới được CDN + playlist tree đi hết qua proxy + bytes
 * segment/key/MP4 nguyên vẹn + redirect được bọc (không lộ upstream).
 * ===================================================================== */
"use strict";

const A = require("./lib/assert_lite");
const slices = require("./lib/app_js_slices");
const M = require("./lib/swift_mirror");
const { startMockCdn, segBytes } = require("./lib/mock_cdn");
const { startMirrorProxy } = require("./lib/mirror_proxy");

async function main() {
    const cdn = await startMockCdn();
    const proxy = await startMirrorProxy();
    console.log("[INFO] Mock CDN     : " + cdn.origin);
    console.log("[INFO] Mirror proxy : " + proxy.origin + "  (đóng vai PhimLocalServer trên iOS)");

    // MockXHR chạy HTTP THẬT — requestJson/fetchMovieStreamsShared của app.js
    // sẽ fetch live tới mock CDN (đúng như WKWebView fetch trên thiết bị).
    const resolver = async (url) => {
        const r = await fetch(url, { redirect: "follow" });
        return { status: r.status, body: await r.text() };
    };
    const ctx = slices.attachHelpers(slices.buildContext({ origin: proxy.origin, xhrResolver: resolver }));

    /* ---------- T3.1 Bootstrap live: config → manifest → streams ---------- */
    A.suite("T3.1 — Click Phim: bootstrap THẬT qua HTTP live (hàm app.js nguyên văn)");
    const cfg = await ctx.requestJson(cdn.origin + "/bin/config", 8000);
    const target = ctx.extractMovieTargetUrl(cfg);
    A.eq(target, cdn.origin + "/addon/manifest.json", "extractMovieTargetUrl (unwrap record) trên response LIVE");
    const manifestUrl = ctx.normalizeMovieManifestUrl(target);
    A.ok(ctx.isValidMovieTargetUrl(manifestUrl), "manifestUrl vượt validation");
    const baseUrl = ctx.getMovieBaseUrl(manifestUrl);
    A.eq(baseUrl, cdn.origin + "/addon", "getMovieBaseUrl từ manifestUrl LIVE");
    ctx.setMovieBaseUrl(baseUrl);

    const manifest = await ctx.requestJson(manifestUrl, 8000);
    A.ok(Array.isArray(manifest.catalogs) && manifest.catalogs.length > 0, "manifest LIVE có catalogs (UI danh sách phim sẽ render)");

    const rawStreams = await ctx.fetchMovieStreamsShared("movie", "tt01");
    A.eq(rawStreams.length, 4, "fetchMovieStreamsShared LIVE trả 4 raw streams");
    const valid = ctx.filterStreams(rawStreams);
    A.eq(valid.length, 3, "filterStreams loại externalUrl-only (giữ hls+mp4+jpg đúng hành vi thật)");
    const chosen = valid[0];
    A.ok(chosen.url.includes("master.m3u8") && chosen.url.includes("referer="), "stream chọn = HLS master kèm referer+pkey trong query");

    /* ---------- T3.2 Khối proxy-wrap THẬT → URL đưa vào player ---------- */
    A.suite("T3.2 — startMoviePlayback proxy-wrap (code THẬT) với origin = proxy iOS");
    const wrap = ctx.wrapStreamUrl(chosen.url);
    A.ok(wrap.phimHlsUrl === true, "phimHlsUrl=true → app.js chọn đường hls.js");
    const wrapped = wrap.phimStreamUrl;
    A.ok(wrapped.startsWith(proxy.origin + "/proxy?url="), "URL CUỐI = proxy nội bộ (dạng WKWebView fetch)");
    const wq = new URL(wrapped).searchParams;
    A.eq(wq.get("url"), chosen.url, "proxy?url= bảo toàn stream URL gốc");
    A.eq(wq.get("__ref"), cdn.origin + "/watch/tt01", "__ref = referer giải mã từ query stream URL (chìa khóa chống 403)");
    console.log("  [INFO] [PHIM_DEBUG] Step=PLAYBACK -> Action=wrapStreamUrl -> Status=ok -> Payload=" +
        proxy.origin + "/proxy?url=<" + chosen.url.length + " chars .m3u8>&__ref=<" + (cdn.origin + "/watch/tt01").length + " chars>");

    /* ---------- T3.3 GET master qua proxy → rewrite kiểm chứng ---------- */
    A.suite("T3.3 — Master playlist qua proxy: rewrite children + ACAO + content-type");
    const masterRes = await fetch(wrapped);
    A.eq(masterRes.status, 200, "GET master qua proxy → 200");
    A.eq(masterRes.headers.get("access-control-allow-origin"), "*", "ACAO:* (parity Swift :695)");
    A.ok(M.isM3u8ContentType(masterRes.headers.get("content-type") || ""), "content-type mpegurl giữ nguyên");
    const masterText = await masterRes.text();
    const masterLines = masterText.split("\n");
    A.ok(masterLines.every((l) => l.startsWith("#") || l === "" || l.startsWith("/proxy?url=")),
        "MỌI child đều là /proxy?url= (không lộ URL upstream TRẦN cho hls.js)");
    A.eq((masterText.match(/__ref=/g) || []).length, 2, "cả 2 variant đều mang __ref");
    const variant720 = masterLines.find((l) => decodeURIComponent(l).includes("720p.m3u8"));
    const variant1080 = masterLines.find((l) => decodeURIComponent(l).includes("1080p.m3u8"));
    A.ok(variant720 && variant1080, "đủ 2 variant (relative + absolute) sau rewrite");

    /* ---------- T3.4 Descend playlist tree như hls.js ---------- */
    A.suite("T3.4 — Media playlist + KEY + MAP + segments qua proxy (bytes + header gate)");
    const mediaRes = await fetch(new URL(variant720, proxy.origin).href);
    A.eq(mediaRes.status, 200, "GET 720p media playlist → 200");
    const mediaText = await mediaRes.text();
    A.ok(mediaText.includes('#EXT-X-KEY:METHOD=AES-128,URI="/proxy?url='), "EXT-X-KEY URI đã bọc /proxy");
    A.ok(mediaText.includes('#EXT-X-MAP:URI="/proxy?url='), "EXT-X-MAP URI đã bọc /proxy");
    const childLines = mediaText.split("\n").filter((l) => l && !l.startsWith("#"));
    A.ok(childLines.length === 3 && childLines.every((l) => l.startsWith("/proxy?url=")), "3 segment đều qua proxy");

    async function getChild(lineRegex) {
        const line = mediaText.split("\n").find((l) => lineRegex.test(l));
        if (!line) throw new Error("không tìm thấy child: " + lineRegex);
        const mm = /URI="([^"]+)"/.exec(line);
        const child = mm ? mm[1] : line;
        return fetch(new URL(child, proxy.origin).href);
    }

    const keyRes = await getChild(/#EXT-X-KEY/);
    A.eq(keyRes.status, 200, "AES key qua proxy → 200 (CDN gate Referer ĐÃ nhận header — thiếu sẽ là 403)");
    const keyBuf = Buffer.from(await keyRes.arrayBuffer());
    A.ok(keyBuf.equals(segBytes(42, 16)), "bytes key nguyên vẹn (đúng 16 byte CDN phát)");

    const mapRes = await getChild(/#EXT-X-MAP/);
    A.eq(mapRes.status, 200, "init.mp4 (EXT-X-MAP) qua proxy → 200");
    A.ok(Buffer.from(await mapRes.arrayBuffer()).equals(segBytes(9, 512)), "bytes init.mp4 nguyên vẹn");

    const seg1Res = await getChild(/seg1/);
    A.eq(seg1Res.status, 200, "seg1.ts?sig=abc qua proxy → 200");
    A.ok(Buffer.from(await seg1Res.arrayBuffer()).equals(segBytes(1, 188 * 3)), "bytes seg1 nguyên vẹn");

    const seg2Res = await getChild(/seg2/);
    A.ok(Buffer.from(await seg2Res.arrayBuffer()).equals(segBytes(2, 188 * 3)), "bytes seg2 nguyên vẹn");

    const seg3Res = await getChild(/seg3/);
    A.ok(Buffer.from(await seg3Res.arrayBuffer()).equals(segBytes(3, 188 * 3)), "bytes seg3 (absolute trên CDN) nguyên vẹn");

    // Header log phía CDN: bằng chứng header injection
    const hlsCalls = cdn.received.filter((r) => r.path.startsWith("/hls/tt01/") || r.path.startsWith("/key.bin"));
    A.ok(hlsCalls.length >= 6, "CDN ghi nhận ≥6 call /hls+/key (master+media+key+map+3seg)");
    A.ok(hlsCalls.every((c) => c.referer === cdn.origin + "/watch/tt01"), "MỌI call media mang Referer đúng (từ __ref)");
    A.ok(hlsCalls.every((c) => c.origin === cdn.origin), "MỌI call media mang Origin suy từ referer (parity Swift :819)");
    A.ok(hlsCalls.every((c) => c.ua === M.PROXY_HEADERS.userAgent), "MỌI call media mang UA Chrome 126 (parity Swift :349)");
    A.ok(hlsCalls.every((c) => c.acceptEncoding === "identity"), "Accept-Encoding: identity (không gzip — parity Swift :813)");

    /* ---------- T3.5 Redirect 3xx: Location bọc lại /proxy ---------- */
    A.suite("T3.5 — 3xx Location TUYỆT ĐỐI → bọc /proxy (Swift :1031-1046)");
    const redirUrl = proxy.origin + "/proxy?url=" + encodeURIComponent(cdn.origin + "/redirect/tt01/m3u8") +
        "&__ref=" + encodeURIComponent(cdn.origin + "/watch/tt01");
    const redirRes = await fetch(redirUrl, { redirect: "manual" });
    A.eq(redirRes.status, 302, "proxy trả 302 nguyên trạng (KHÔNG tự follow — followRedirects=false)");
    const loc = redirRes.headers.get("location") || "";
    A.ok(loc.startsWith("/proxy?url="), "Location đã bọc /proxy?url= (browser không fetch thẳng upstream)");
    const locQ = new URL(loc, proxy.origin).searchParams;
    A.ok(locQ.get("url").includes("/hls/tt01/master.m3u8"), "Location trỏ đúng đích master của CDN");
    A.eq(locQ.get("__ref"), cdn.origin + "/watch/tt01", "__ref lan truyền qua redirect hop");
    const followed = await fetch(new URL(loc, proxy.origin).href);
    A.eq(followed.status, 200, "follow Location (đã bọc) → master 200");
    A.ok((await followed.text()).includes("/proxy?url="), "master sau redirect vẫn rewrite children");

    /* ---------- T3.6 Token hết hạn → redirect quảng cáo PHÁT HIỆN được ---------- */
    A.suite("T3.6 — Token hết hạn (302 → playlist quảng cáo) không bị proxy che giấu");
    const expiredUrl = proxy.origin + "/proxy?url=" + encodeURIComponent(cdn.origin + "/expired/tt01.m3u8");
    const expiredRes = await fetch(expiredUrl, { redirect: "manual" });
    A.eq(expiredRes.status, 302, "expired stream → 302 (app.js/video NHẬN BIẾT được để fallback movieStreamFallback)");
    const adLoc = expiredRes.headers.get("location") || "";
    const adFollowed = await fetch(new URL(adLoc, proxy.origin).href);
    const adText = await adFollowed.text();
    A.ok(adText.includes("ad-seg.ts"), "nội dung playlist quảng cáo lộ rõ → lớp fallback app.js kích hoạt đúng (parity hành vi sc.k-20.xyz)");

    /* ---------- T3.7 MP4 + Range + HEAD ---------- */
    A.suite("T3.7 — MP4: full body + Range 206 + HEAD (parity pending.isHead)");
    const mp4Wrap = ctx.wrapStreamUrl(valid[1].url);
    A.ok(mp4Wrap.phimHlsUrl === false, "MP4 → phimHlsUrl=false (đường video.src/AVPlayer)");
    const mp4Url = mp4Wrap.phimStreamUrl;
    A.ok(mp4Url.startsWith(proxy.origin + "/proxy?url="), "MP4 cross-origin cũng qua proxy");
    const mp4Res = await fetch(mp4Url);
    A.eq(mp4Res.status, 200, "GET MP4 → 200");
    const mp4Buf = Buffer.from(await mp4Res.arrayBuffer());
    A.ok(mp4Buf.equals(segBytes(5, 4096)), "bytes MP4 nguyên vẹn 4096B");
    A.eq(mp4Res.headers.get("content-length"), "4096", "Content-Length thật (parity Swift ghi lại length)");

    const rangeRes = await fetch(mp4Url, { headers: { Range: "bytes=0-99" } });
    A.eq(rangeRes.status, 206, "Range → 206 Partial Content (hls.js/AVPlayer seek)");
    const rangeBuf = Buffer.from(await rangeRes.arrayBuffer());
    A.ok(rangeBuf.length === 100 && rangeBuf.equals(segBytes(5, 4096).subarray(0, 100)), "100 byte đầu khớp");
    const mp4CdnCalls = cdn.received.filter((r) => r.path.startsWith("/v/tt01/movie.mp4"));
    A.ok(mp4CdnCalls.some((c) => c.range === "bytes=0-99"), "Range forward nguyên văn tới upstream (parity Swift :831)");

    const headRes = await fetch(mp4Url, { method: "HEAD" });
    A.eq(headRes.status, 200, "HEAD qua proxy → 200");
    A.eq(headRes.headers.get("content-length"), "4096", "HEAD giữ Content-Length upstream");

    /* ---------- T3.8 Same-origin không wrap kép ---------- */
    A.suite("T3.8 — Chống double-wrap với origin proxy THẬT");
    const rewrap = ctx.wrapStreamUrl(wrapped);
    A.eq(rewrap.phimStreamUrl, wrapped, "URL đã-proxied (same-origin) KHÔNG bị wrap lần 2");

    cdn.server.close();
    proxy.server.close();
    const allOk = A.summary();
    process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error("T3 CRASH:", e); process.exit(2); });
