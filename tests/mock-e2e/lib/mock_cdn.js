/* =====================================================================
 * mock_cdn.js — CDN PHIM GIẢ LẬP (plain HTTP, loopback, port ngẫu nhiên)
 * mô phỏng hành vi nguồn phim thật mà app.js/PhimLocalServer phải xử lý:
 *
 *  - /bin/config                 → JSONBin shape {record:{target_url}}
 *  - /addon/manifest.json        → Stremio addon manifest
 *  - /addon/stream/movie/tt01.json → streams: HLS (referer+pkey trong query),
 *                                  MP4, poster.jpg, externalUrl-only
 *  - /hls/tt01/*                 → BẮT BUỘC Referer = /watch/tt01 (thiếu → 403)
 *                                  master → variant relative + absolute
 *                                  media  → EXT-X-KEY, EXT-X-MAP, segments
 *  - /key.bin?token=             → 16-byte AES key (bắt buộc Referer)
 *  - /v/tt01/movie.mp4           → bytes + Range/206
 *  - /redirect/tt01/m3u8         → 302 Location TUYỆT ĐỐI về master
 *  - /expired/tt01.m3u8          → 302 về /ads/promo.m3u8 (mô phỏng token
 *                                  hết hạn kiểu sc.k-20.xyz → playlist quảng cáo)
 *
 *  Mọi request được GHI LOG headers (referer/origin/user-agent/range/
 *  accept-encoding) để test assert header injection qua proxy.
 * ===================================================================== */
"use strict";

const http = require("http");

function segBytes(seed, n) {
    const b = Buffer.alloc(n);
    for (let i = 0; i < n; i++) b[i] = (i * 7 + seed * 13) % 256;
    return b;
}

function startMockCdn() {
    const state = {
        server: null,
        port: 0,
        origin: "",
        received: [],   // {path, method, referer, origin, ua, range, acceptEncoding}
    };

    const server = http.createServer((req, res) => {
        const u = new URL(req.url, "http://localhost");
        state.received.push({
            path: u.pathname + u.search,
            method: req.method,
            referer: req.headers["referer"] || null,
            origin: req.headers["origin"] || null,
            ua: req.headers["user-agent"] || null,
            range: req.headers["range"] || null,
            acceptEncoding: req.headers["accept-encoding"] || null,
        });

        const send = (code, body, headers) => {
            res.writeHead(code, Object.assign({ "Connection": "close" }, headers || {}));
            res.end(body);
        };
        const json = (code, obj) => send(code, JSON.stringify(obj), { "Content-Type": "application/json" });
        const m3u8 = (code, text) => send(code, text, { "Content-Type": "application/vnd.apple.mpegurl" });

        // Referer gate cho nội dung /hls/ và key
        const REFERER_REQUIRED = "http://127.0.0.1" ; // placeholder, set below
        const requiredReferer = state.origin + "/watch/tt01";
        const refererOk = (req.headers["referer"] || "") === requiredReferer;

        if (u.pathname === "/bin/config") {
            return json(200, { record: { target_url: state.origin + "/addon/manifest.json", version: "2026.09" } });
        }
        if (u.pathname === "/addon/manifest.json") {
            return json(200, {
                id: "community.bintv.phim", version: "1.4.2", name: "BinTV Phim (mock)",
                resources: ["catalog", "stream"], types: ["movie", "series"],
                catalogs: [{ type: "movie", id: "binhviet", name: "Phim lẻ", extra: [{ name: "search" }] }],
            });
        }
        if (u.pathname === "/addon/stream/movie/tt01.json") {
            return json(200, {
                streams: [
                    {
                        name: "BinTV", title: "1080p VietSub",
                        url: state.origin + "/hls/tt01/master.m3u8?referer=" +
                            encodeURIComponent(requiredReferer) + "&pkey=SECRET-PKEY",
                    },
                    { name: "BinTV", title: "720p MP4", url: state.origin + "/v/tt01/movie.mp4?token=MP4TOKEN" },
                    { name: "BinTV", title: "poster", url: state.origin + "/img/tt01/poster.jpg" },
                    { name: "BinTV", title: "external", externalUrl: state.origin + "/watch/tt01" },
                ],
            });
        }
        if (u.pathname.startsWith("/hls/tt01/")) {
            if (!refererOk) return json(403, { error: "referer required (mock CDN gate)" });
            if (u.pathname === "/hls/tt01/master.m3u8") {
                return m3u8(200, [
                    "#EXTM3U",
                    "#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720",
                    "720p.m3u8",
                    "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080",
                    state.origin + "/hls/tt01/1080p.m3u8",
                ].join("\n"));
            }
            if (u.pathname === "/hls/tt01/720p.m3u8") {
                return m3u8(200, [
                    "#EXTM3U",
                    "#EXT-X-VERSION:3",
                    "#EXT-X-TARGETDURATION:6",
                    '#EXT-X-KEY:METHOD=AES-128,URI="' + state.origin + '/key.bin?token=SECRET123"',
                    '#EXT-X-MAP:URI="init.mp4"',
                    "#EXTINF:6.000,",
                    "seg1.ts?sig=abc",
                    "#EXTINF:6.000,",
                    "seg2.ts",
                    "#EXTINF:6.000,",
                    state.origin + "/hls/tt01/seg3.ts",
                    "#EXT-X-ENDLIST",
                ].join("\n"));
            }
            if (u.pathname === "/hls/tt01/1080p.m3u8") {
                return m3u8(200, ["#EXTM3U", "#EXTINF:6.000,", "seg1.ts", "#EXT-X-ENDLIST"].join("\n"));
            }
            if (u.pathname === "/hls/tt01/init.mp4") {
                return send(200, segBytes(9, 512), { "Content-Type": "video/mp4" });
            }
            const segMatch = /^\/hls\/tt01\/seg(\d+)\.ts$/.exec(u.pathname);
            if (segMatch) {
                return send(200, segBytes(parseInt(segMatch[1], 10), 188 * 3), { "Content-Type": "video/mp2t" });
            }
            return json(404, { error: "not found" });
        }
        if (u.pathname === "/key.bin") {
            if (!refererOk) return json(403, { error: "referer required for key" });
            return send(200, segBytes(42, 16), { "Content-Type": "application/octet-stream" });
        }
        if (u.pathname === "/v/tt01/movie.mp4") {
            const full = segBytes(5, 4096);
            const range = req.headers["range"];
            if (range) {
                const m = /bytes=(\d+)-(\d*)/.exec(range);
                if (m) {
                    const start = parseInt(m[1], 10);
                    const end = m[2] ? Math.min(parseInt(m[2], 10), full.length - 1) : full.length - 1;
                    res.writeHead(206, {
                        "Content-Type": "video/mp4",
                        "Content-Range": "bytes " + start + "-" + end + "/" + full.length,
                        "Content-Length": String(end - start + 1),
                        "Accept-Ranges": "bytes",
                        "Connection": "close",
                    });
                    return res.end(full.subarray(start, end + 1));
                }
            }
            return send(200, full, { "Content-Type": "video/mp4", "Content-Length": String(full.length), "Accept-Ranges": "bytes" });
        }
        if (u.pathname === "/img/tt01/poster.jpg") {
            return send(200, segBytes(1, 100), { "Content-Type": "image/jpeg" });
        }
        if (u.pathname === "/redirect/tt01/m3u8") {
            // 302 Location TUYỆT ĐỐI — proxy PHẢI bọc lại /proxy?url= (Swift :1031-1046)
            return send(302, "", {
                "Location": state.origin + "/hls/tt01/master.m3u8?referer=" + encodeURIComponent(requiredReferer),
            });
        }
        if (u.pathname === "/expired/tt01.m3u8") {
            // Token hết hạn → CDN đẩy sang playlist quảng cáo (parity sc.k-20.xyz)
            return send(302, "", { "Location": state.origin + "/ads/promo.m3u8" });
        }
        if (u.pathname === "/ads/promo.m3u8") {
            return m3u8(200, ["#EXTM3U", "#EXTINF:15.000,", "ad-seg.ts", "#EXT-X-ENDLIST"].join("\n"));
        }
        return json(404, { error: "unknown path" });
    });

    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            state.port = server.address().port;
            state.origin = "http://127.0.0.1:" + state.port;
            state.server = server;
            resolve(state);
        });
    });
}

module.exports = { startMockCdn, segBytes };
