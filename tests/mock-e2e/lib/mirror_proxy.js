/* =====================================================================
 * mirror_proxy.js — MIRROR HÀNH VI /proxy của PhimLocalServer.swift
 * (chạy Node trong sandbox vì không có Swift toolchain; trên thiết bị,
 *  PhimLocalServer.swift là bản THẬT với cùng contract này):
 *
 *  Contract (dòng Swift tương ứng):
 *  - GET /proxy?url=<enc>&__ref=<enc>            (:795-865 parse/dispatch)
 *  - Headers tới upstream: UA Chrome 126 (:349), Accept (:351),
 *    Accept-Language (:352), Accept-Encoding: identity (:813),
 *    Referer=__ref (:816), Origin=scheme://host[:port] của __ref (:819),
 *    Range/If-Range forward nguyên (:831-834)
 *  - KHÔNG tự follow redirect (followRedirects=false cả RawHttp lẫn
 *    URLSession) → 3xx trả về client với Location TUYỆT ĐỐI đã bọc lại
 *    /proxy?url= + __ref (:1031-1046)
 *  - Body m3u8 (content-type khớp :355 HOẶC url .m3u8 :1118) →
 *    rewriteM3u8Urls(text, baseUrlOf(target), extraReferer) (:1050-1060)
 *  - Response: copy headers upstream trừ access-control-*, transfer-
 *    encoding, content-length (:1124-1131), thêm Content-Length thật +
 *    Access-Control-Allow-Origin: * (:695)
 *  - HEAD: trả headers không body (pending.isHead)
 *  - /health: 200 "ok" (parity route health của server Phim)
 *
 *  Phần rewrite dùng swift_mirror.js (port 1:1 các hàm thuần Swift —
 *  đã được T2 kiểm chứng 55/55).
 *  KHÁC BIỆT documented: bỏ qua tầng DoH (iOS-only, trực giao với luồng
 *  URL) và RawHttp/ATS (Node không có ATS); semantics header/rewrite/
 *  redirect giữ nguyên 100%.
 * ===================================================================== */
"use strict";

const http = require("http");
const M = require("./swift_mirror");

const HOP_BY_HOP = new Set([
    "access-control-allow-origin",
    "access-control-allow-credentials",
    "transfer-encoding",
    "content-length",
    "connection",
    "keep-alive",
]);

function startMirrorProxy() {
    const state = { server: null, port: 0, origin: "", log: [] };

    const server = http.createServer(async (req, res) => {
        const u = new URL(req.url, "http://localhost");

        if (u.pathname === "/health") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            return res.end("ok");
        }

        if (u.pathname !== "/proxy") {
            res.writeHead(404, { "Content-Type": "text/plain" });
            return res.end("not found");
        }

        const targetRaw = u.searchParams.get("url");
        const extraReferer = u.searchParams.get("__ref") || null;
        if (!targetRaw) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            return res.end("missing url");
        }

        // Dựng request upstream ĐÚNG header contract Swift (:809-834)
        const headers = {
            "User-Agent": M.PROXY_HEADERS.userAgent,
            "Accept": M.PROXY_HEADERS.accept,
            "Accept-Language": M.PROXY_HEADERS.acceptLanguage,
            "Accept-Encoding": M.PROXY_HEADERS.acceptEncoding,
        };
        if (extraReferer) {
            headers["Referer"] = extraReferer;
            const origin = M.originFromReferer(extraReferer);
            if (origin) headers["Origin"] = origin;
        } else if (req.headers["referer"]) {
            headers["Referer"] = req.headers["referer"];
            if (req.headers["origin"]) headers["Origin"] = req.headers["origin"];
        }
        if (req.headers["range"]) headers["Range"] = req.headers["range"];
        if (req.headers["if-range"]) headers["If-Range"] = req.headers["if-range"];

        state.log.push({ target: targetRaw, referer: extraReferer, method: req.method });

        let upstream;
        try {
            upstream = await fetch(targetRaw, { method: req.method, headers, redirect: "manual" });
        } catch (e) {
            res.writeHead(502, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
            return res.end("upstream fetch failed: " + e.message);
        }

        const code = upstream.status;
        // Copy headers (trừ hop-by-hop + ACL + length — parity upstreamHeaderList)
        const outHeaders = [];
        upstream.headers.forEach((value, key) => {
            if (!HOP_BY_HOP.has(key.toLowerCase())) outHeaders.push([key, value]);
        });
        let contentType = upstream.headers.get("content-type") || "";

        // 3xx + Location tuyệt đối → bọc /proxy (Swift :1031-1046)
        if (code >= 300 && code < 400) {
            const loc = upstream.headers.get("location");
            if (loc) {
                const rewritten = M.rewriteRedirectLocation(loc, extraReferer);
                for (let i = 0; i < outHeaders.length; i++) {
                    if (outHeaders[i][0].toLowerCase() === "location") outHeaders[i][1] = rewritten;
                }
            }
        }

        // Body
        const isM3u8 = M.isM3u8ContentType(contentType) || M.urlLooksLikeM3u8(targetRaw);
        let body;
        if (req.method === "HEAD") {
            body = Buffer.alloc(0);
            // HEAD: content-length từ upstream (parity Swift giữ length cho HEAD)
            const cl = upstream.headers.get("content-length");
            if (cl) outHeaders.push(["Content-Length", cl]);
        } else {
            const raw = Buffer.from(await upstream.arrayBuffer());
            if (isM3u8 && raw.length <= 2000000) {
                const base = M.baseUrlOf(targetRaw);
                const text = M.rewriteM3u8Urls(raw.toString("utf8"), base, extraReferer);
                body = Buffer.from(text, "utf8");
            } else {
                body = raw;
            }
            outHeaders.push(["Content-Length", String(body.length)]);
        }
        outHeaders.push(["Access-Control-Allow-Origin", "*"]);

        res.writeHead(code, outHeaders);
        res.end(body);
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

module.exports = { startMirrorProxy };
