/* =====================================================================
 * swift_mirror.js — BẢN PORT 1:1 (transliteration) các hàm THUẦN của
 * PhimLocalServer.swift sang JavaScript, dùng cho test trong sandbox
 * (không có Swift toolchain). Mỗi hàm ghi chú dòng nguồn Swift tương ứng.
 *
 * Phạm vi mirror:
 *   - encodeQueryValue      (PhimLocalServer.swift:1158)
 *   - originOf              (:1146)
 *   - baseUrlOf             (:1153)
 *   - proxifyM3u8Value      (:1167)
 *   - rewriteUriAttrs       (:1191, uriAttrPattern :357)
 *   - rewriteM3u8Urls       (:1213)
 *   - rewriteRedirectLocation (:1031-1046 — khối 3xx Location)
 *   - isM3u8ContentType / urlLooksLikeM3u8 (:1112/:1118)
 *   - Header contract của /proxy (:809-834, userAgent :349-352)
 *
 * KHÁC BIỆT CÓ CHỦ ĐÍCH (documented, xem README.md mục Limitations):
 *   - Foundation URL(string:relativeTo:) vs WHATWG URL: khác nhau ở vài
 *     edge case hiếm (scheme-relative "//host/x", port mặc định tường
 *     minh). originOf dưới đây parse THỦ CÔNG để giữ hành vi Foundation
 *     (giữ port tường minh, kể cả :80/:443).
 * ===================================================================== */
"use strict";

/* ---- Foundation-style URL parse (scheme://host[:port]/...) ---- */
function foundationParse(url) {
    const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(.*)$/.exec(String(url));
    if (!m) return null;
    const scheme = m[1].toLowerCase();
    let authority = m[2];
    let host = authority;
    let port = null;
    // userinfo@host:port
    const at = authority.lastIndexOf("@");
    if (at >= 0) host = authority.substring(at + 1);
    const colon = host.lastIndexOf(":");
    // IPv6 [::1]:port
    if (host.startsWith("[")) {
        const close = host.indexOf("]");
        if (close >= 0 && host.substring(close + 1).startsWith(":")) {
            port = parseInt(host.substring(close + 2), 10);
            host = host.substring(0, close + 1);
        }
    } else if (colon >= 0) {
        const p = host.substring(colon + 1);
        if (/^\d*$/.test(p)) { port = p === "" ? null : parseInt(p, 10); host = host.substring(0, colon); }
    }
    if (!host) return null;
    return { scheme, host, port };
}

/* PhimLocalServer.swift:1146 — originOf */
function originOf(url) {
    const parsed = foundationParse(url);
    if (!parsed) return "";
    const portPart = parsed.port != null ? ":" + parsed.port : "";
    return (parsed.scheme || "http") + "://" + parsed.host + portPart;
}

/* PhimLocalServer.swift:1153 — baseUrlOf: chuỗi tới hết "/" cuối cùng */
function baseUrlOf(urlString) {
    const idx = urlString.lastIndexOf("/");
    if (idx < 0) return "";
    return urlString.substring(0, idx + 1);
}

/* PhimLocalServer.swift:1158 — encodeQueryValue
 * allowed = alphanumerics + "-_.~" ; còn lại %XX (UTF-8, hex HOA)
 * (khớp Java URLEncoder.encode(...).replace("+","%20").replace("*","%2A")
 *  .replace("%7E","~") — Swift addingPercentEncoding xuất hex uppercase) */
function encodeQueryValue(value) {
    const allowed = /^[A-Za-z0-9\-_.~]$/;
    const bytes = Buffer.from(String(value), "utf8");
    let out = "";
    for (const b of bytes) {
        const ch = String.fromCharCode(b);
        out += allowed.test(ch) ? ch : "%" + b.toString(16).toUpperCase().padStart(2, "0");
    }
    return out;
}

/* PhimLocalServer.swift:1167 — proxifyM3u8Value */
function proxifyM3u8Value(value, baseUrl, selfOrigin, refSuffix) {
    let trimmed = String(value).replace(/^["']+|["']+$/g, "");
    trimmed = trimmed.trim();
    if (trimmed === "") return value;
    let absolute;
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        absolute = trimmed;
    } else {
        if (!baseUrl) return value;
        let resolved;
        try { resolved = new URL(trimmed, baseUrl); } catch (e) { return value; }
        absolute = resolved.href;
    }
    // Chống proxy 2 tầng (khi upstream đã là URL proxy cùng origin).
    if (selfOrigin && absolute.startsWith(selfOrigin) && absolute.includes("/proxy?url=")) {
        if (refSuffix && !absolute.includes("__ref=")) {
            return absolute + refSuffix;
        }
        return absolute;
    }
    return "/proxy?url=" + encodeQueryValue(absolute) + refSuffix;
}

/* PhimLocalServer.swift:1191 + :357 — rewriteUriAttrs, pattern URI="([^"]+)" */
const URI_ATTR_PATTERN = /URI="([^"]+)"/g;
function rewriteUriAttrs(line, transform) {
    let result = "";
    let lastOffset = 0;
    let found = false;
    URI_ATTR_PATTERN.lastIndex = 0;
    let m;
    while ((m = URI_ATTR_PATTERN.exec(line)) !== null) {
        found = true;
        result += line.substring(lastOffset, m.index);
        result += 'URI="' + transform(m[1]) + '"';
        lastOffset = m.index + m[0].length;
    }
    if (found) result += line.substring(lastOffset);
    return { replaced: result, found };
}

/* PhimLocalServer.swift:1213 — rewriteM3u8Urls */
function rewriteM3u8Urls(manifestText, baseUrl, extraReferer) {
    const selfOrigin = originOf(baseUrl);
    let refSuffix = "";
    if (extraReferer) refSuffix = "&__ref=" + encodeQueryValue(extraReferer);
    const normalized = String(manifestText).replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    const outLines = [];
    for (const line of lines) {
        if (line === "") { outLines.push(line); continue; }
        if (line.startsWith("#")) {
            const { replaced, found } = rewriteUriAttrs(line, (value) =>
                proxifyM3u8Value(value, baseUrl, selfOrigin, refSuffix));
            outLines.push(found ? replaced : line);
        } else {
            outLines.push(proxifyM3u8Value(line, baseUrl, selfOrigin, refSuffix));
        }
    }
    return outLines.join("\n");
}

/* PhimLocalServer.swift:1031-1046 — 3xx Location tuyệt đối → bọc /proxy */
function rewriteRedirectLocation(locValue, extraReferer) {
    const parsed = foundationParse(locValue);
    if (parsed && (parsed.scheme === "http" || parsed.scheme === "https")) {
        let refPart = "";
        if (extraReferer) refPart = "&__ref=" + encodeQueryValue(extraReferer);
        return "/proxy?url=" + encodeQueryValue(locValue) + refPart;
    }
    return locValue; // tương đối giữ nguyên (parity server.js)
}

/* PhimLocalServer.swift:1112/:1118 */
function isM3u8ContentType(contentType) {
    return /mpegurl|x-mpegurl|application\/vnd\.apple\.mpegurl/i.test(String(contentType || ""));
}
function urlLooksLikeM3u8(url) {
    return /\.m3u8(\?|$)/i.test(String(url || ""));
}

/* Header contract /proxy (PhimLocalServer.swift:349-352, :809-834) */
const PROXY_HEADERS = {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    acceptLanguage: "vi,en-US;q=0.8,en;q=0.6",
    acceptEncoding: "identity",
};

/* Origin suy ra từ referer — mirror :815-821 */
function originFromReferer(referer) {
    if (!referer) return null;
    const parsed = foundationParse(referer);
    if (!parsed) return null;
    const portPart = parsed.port != null ? ":" + parsed.port : "";
    return (parsed.scheme || "http") + "://" + parsed.host + portPart;
}

module.exports = {
    foundationParse,
    originOf,
    baseUrlOf,
    encodeQueryValue,
    proxifyM3u8Value,
    rewriteUriAttrs,
    rewriteM3u8Urls,
    rewriteRedirectLocation,
    isM3u8ContentType,
    urlLooksLikeM3u8,
    originFromReferer,
    PROXY_HEADERS,
};
