/* =====================================================================
 * app_js_slices.js — TRÍCH NGUYÊN VĂN nguồn hàm từ app.js THẬT của dự án
 * (BinTV/Phim/Web/assets/app.js — đồng nhất byte-for-byte với assets gốc
 * của Phim.apk). KHÔNG viết lại logic: các hàm dưới đây được CẮT trực
 * tiếp từ tệp app.js bằng brace-matching, rồi chạy trong Node VM với
 * stub tối thiểu (document/window/XMLHttpRequest) để kiểm chứng luồng:
 *
 *   Click Phim → Gọi API (JSONBin config → manifest → stream.json)
 *   → Parse/Extract stream URL → lọc isValidMovieTargetUrl
 *   → wrap /proxy?url=...&__ref=referer (đúng code trong startMoviePlayback)
 *   → phát hiện HLS (.m3u8) → (chuyển cho Player)
 *
 * Nếu app.js thay đổi, các slice tự động lấy bản mới (không hard-code
 * nội dung hàm trong test).
 * ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP_JS_PATH = path.join(__dirname, "..", "..", "..", "BinTV", "Phim", "Web", "assets", "app.js");

function readAppJs() {
    return fs.readFileSync(APP_JS_PATH, "utf8");
}

/** Cắt nguyên văn `function <name>(...) { ... }` (brace-matching, có ý thức
 *  về chuỗi/ký tự escape) từ nguồn app.js. Trả về text gốc 100%. */
function sliceFunction(source, name) {
    const marker = "function " + name + "(";
    const start = source.indexOf(marker);
    if (start < 0) throw new Error("sliceFunction: không tìm thấy hàm '" + name + "' trong app.js");
    let i = source.indexOf("{", start);
    if (i < 0) throw new Error("sliceFunction: hàm '" + name + "' không có thân");
    let depth = 0;
    let inStr = null;      // '"' | "'" | null
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;
    for (; i < source.length; i++) {
        const ch = source[i];
        const next = source[i + 1];
        if (inLineComment) { if (ch === "\n") inLineComment = false; continue; }
        if (inBlockComment) { if (ch === "*" && next === "/") { inBlockComment = false; i++; } continue; }
        if (inStr) {
            if (escaped) { escaped = false; continue; }
            if (ch === "\\") { escaped = true; continue; }
            if (ch === inStr) inStr = null;
            continue;
        }
        if (ch === "/" && next === "/") { inLineComment = true; i++; continue; }
        if (ch === "/" && next === "*") { inBlockComment = true; i++; continue; }
        if (ch === '"' || ch === "'") { inStr = ch; continue; }
        if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (depth === 0) return source.substring(start, i + 1); }
    }
    throw new Error("sliceFunction: không đóng được brace của '" + name + "'");
}

/** Cắt nguyên văn khối proxy-wrap trong startMoviePlayback:
 *  từ `var phimStreamUrl = url;` đến hết IIFE gán `phimHlsUrl`
 *  (kết thúc bằng `})();` ngay trước log "[STREAM] source detected"). */
function sliceProxyWrapBlock(source) {
    const startMarker = "var phimStreamUrl = url;";
    const endMarker = 'try { window.__phimDebug && window.__phimDebug.log("[STREAM] source detected"';
    const start = source.indexOf(startMarker);
    if (start < 0) throw new Error("sliceProxyWrapBlock: thiếu marker bắt đầu");
    const end = source.indexOf(endMarker, start);
    if (end < 0) throw new Error("sliceProxyWrapBlock: thiếu marker kết thúc");
    return source.substring(start, end);
}

/** Cắt nguyên văn khối lọc stream hợp lệ trong callback của loadMovieStreams
 *  (vòng lặp validStreams dùng isValidMovieTargetUrl). */
function sliceValidStreamsFilter(source) {
    const startMarker = "var validStreams = [];";
    const anchor = source.indexOf("function loadMovieStreams(", 0);
    if (anchor < 0) throw new Error("sliceValidStreamsFilter: không thấy loadMovieStreams");
    const start = source.indexOf(startMarker, anchor);
    if (start < 0) throw new Error("sliceValidStreamsFilter: thiếu marker");
    const endMarker = "if (!validStreams.length) {";
    const end = source.indexOf(endMarker, start);
    if (end < 0) throw new Error("sliceValidStreamsFilter: thiếu marker kết thúc");
    return source.substring(start, end);
}

/* =====================================================================
 * DOM/WINDOW stub tối thiểu — chỉ đủ cho các hàm được slice (KHÔNG mô
 * phỏng UI). Anchor <a> dùng WHATWG URL (cùng semantics WebKit với các
 * URL http/https tuyệt đối mà luồng phim sử dụng).
 * ===================================================================== */

function makeAnchorStub() {
    // document.createElement("a") → object có href setter parse URL
    return function () {
        const a = {
            _u: null,
            set href(value) {
                try { a._u = new URL(String(value), "http://stub.local/"); }
                catch (e) { a._u = null; }
            },
            get href() { return a._u ? a._u.href : ""; },
            get protocol() { return a._u ? a._u.protocol : ":"; },
            get hostname() { return a._u ? a._u.hostname : ""; },
            get host() { return a._u ? a._u.host : ""; },
            get origin() { return a._u ? a._u.origin : ""; },
            get pathname() { return a._u ? a._u.pathname : "/"; },
            get search() { return a._u ? a._u.search : ""; },
        };
        return a;
    };
}

/** MockXHR — XMLHttpRequest giả, phục vụ từ map url→response (T1) hoặc
 *  từ HTTP thật (T3, qua fetchTransport). Bám sát surface mà requestJson
 *  của app.js dùng: open/send/timeout/onreadystatechange/status/
 *  responseText/abort. */
function makeMockXHRClass(resolver) {
    return class MockXHR {
        constructor() {
            this.readyState = 0;
            this.status = 0;
            this.responseText = "";
            this.timeout = 0;
            this.onreadystatechange = null;
            this.onerror = null;
            this.ontimeout = null;
            this._aborted = false;
            this._method = "GET";
            this._url = "";
        }
        open(method, url) { this._method = method; this._url = url; this.readyState = 1; }
        send() {
            Promise.resolve()
                .then(() => resolver(this._url, this._method))
                .then((res) => {
                    if (this._aborted) return;
                    this.status = res.status;
                    this.responseText = res.body;
                    this.readyState = 4;
                    if (this.onreadystatechange) this.onreadystatechange();
                })
                .catch(() => {
                    if (this._aborted) return;
                    this.status = 0;
                    this.readyState = 4;
                    if (this.onerror) this.onerror(new Error("Network error"));
                });
        }
        abort() { this._aborted = true; }
    };
}

/** Dựng VM context chứa các hàm THẬT đã slice + stub, trả về API gọi được.
 *  opts.origin: window.location.origin (mặc định http://127.0.0.1:3000 —
 *  đúng dạng server Phim nội bộ trên iOS).
 *  opts.xhrResolver: (url, method) => Promise<{status, body}> */
function buildContext(opts) {
    const source = readAppJs();
    const options = opts || {};
    const origin = options.origin || "http://127.0.0.1:3000";
    const resolver = options.xhrResolver
        || (() => Promise.reject(new Error("no xhr resolver configured")));

    const sandbox = {
        console,
        JSON,
        Math,
        Date,
        encodeURIComponent,
        decodeURIComponent,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        String,
        Number,
        Array,
        Object,
        RegExp,
        Error,
        Promise,
        URL,
        setTimeout,
        clearTimeout,
        document: { createElement: makeAnchorStub() },
        window: { location: { origin } },
        XMLHttpRequest: makeMockXHRClass(resolver),
    };
    sandbox.window.document = sandbox.document;
    sandbox.globalThis = sandbox;

    // Nạp các hàm THẬT (nguyên văn từ app.js) vào sandbox.
    const fnNames = [
        "requestJson",
        "extractMovieTargetUrl",
        "normalizeMovieManifestUrl",
        "isValidMovieTargetUrl",
        "getMovieBaseUrl",
        "buildMovieResourceUrlForBase",
        "buildMovieResourceUrl",
        "getMovieRequestErrorMessage",
    ];
    const fnSources = fnNames.map((n) => sliceFunction(source, n));

    // Khối proxy-wrap THẬT của startMoviePlayback → hàm wrapStreamUrl(url)
    const wrapBlock = sliceProxyWrapBlock(source);
    const wrapFnSource =
        "function wrapStreamUrl(url) {\n" +
        "    var phimExtraRefOut = '';\n" +
        wrapBlock +
        "\n    return { phimStreamUrl: phimStreamUrl, phimHlsUrl: phimHlsUrl };\n" +
        "}";

    // Khối lọc validStreams THẬT trong loadMovieStreams → hàm filterStreams(streams)
    const filterBlock = sliceValidStreamsFilter(source);
    const filterFnSource =
        "function filterStreams(streams) {\n" +
        filterBlock +
        "\n    return validStreams;\n" +
        "}";

    // fetchMovieStreamsShared THẬT cần các biến scope của IIFE gốc:
    // movieBaseUrl, movieStreamRequestInFlight, MOVIE_REQUEST_TIMEOUT.
    const fetchStreamsSrc = sliceFunction(source, "fetchMovieStreamsShared");
    const scopePrelude = [
        "var movieBaseUrl = __ctx.movieBaseUrl;",
        "var movieStreamRequestInFlight = {};",
        "var MOVIE_REQUEST_TIMEOUT = 8000;",
    ].join("\n");

    const bootstrap = [
        "var __ctx = globalThis.__ctx;",
        scopePrelude,
        fnSources.join("\n\n"),
        fetchStreamsSrc,
        wrapFnSource,
        filterFnSource,
        // buildMovieResourceUrl dùng movieBaseUrl scope — gán lại được:
        "function setMovieBaseUrl(v) { movieBaseUrl = v; }",
    ].join("\n\n");

    vm.createContext(sandbox);
    sandbox.__ctx = { movieBaseUrl: "" };
    vm.runInContext(bootstrap, sandbox, { filename: "app_js_slices_bootstrap.js" });

    return {
        source,
        sandbox,
        setMovieBaseUrl: (v) => vm.runInContext(`setMovieBaseUrl(${JSON.stringify(v)})`, sandbox),
        extractMovieTargetUrl: (data) => sandbox.__call("extractMovieTargetUrl", data),
        normalizeMovieManifestUrl: (u) => sandbox.__call("normalizeMovieManifestUrl", u),
        isValidMovieTargetUrl: (u) => sandbox.__call("isValidMovieTargetUrl", u),
        getMovieBaseUrl: (u) => sandbox.__call("getMovieBaseUrl", u),
        buildMovieResourceUrl: (resource, type, id) => sandbox.__call3("buildMovieResourceUrl", resource, type, id),
        requestJson: (url, timeout) => sandbox.__requestJson(url, timeout),
        fetchMovieStreamsShared: (type, itemId) => sandbox.__fetchStreams(type, itemId),
        wrapStreamUrl: (url) => sandbox.__call("wrapStreamUrl", url),
        filterStreams: (streams) => sandbox.__call("filterStreams", streams),
        sliceFunction,
        sliceProxyWrapBlock,
        sliceValidStreamsFilter,
    };
}

/** Gắn các bridge helper vào sandbox (phải làm sau buildContext). */
function attachHelpers(ctxApi) {
    const sandbox = ctxApi.sandbox;
    vm.runInContext(`
        globalThis.__call = function (name, arg) {
            return eval(name)(arg);
        };
        globalThis.__call3 = function (name, a, b, c) {
            return eval(name)(a, b, c);
        };
        globalThis.__requestJson = function (url, timeout) {
            return new Promise(function (resolve, reject) {
                requestJson(url, timeout, resolve, reject);
            });
        };
        globalThis.__fetchStreams = function (type, itemId) {
            return new Promise(function (resolve, reject) {
                fetchMovieStreamsShared(type, itemId, resolve, reject);
            });
        };
    `, sandbox, { filename: "app_js_slices_helpers.js" });
    return ctxApi;
}

module.exports = {
    APP_JS_PATH,
    readAppJs,
    sliceFunction,
    sliceProxyWrapBlock,
    sliceValidStreamsFilter,
    buildContext,
    attachHelpers,
    makeMockXHRClass,
};
