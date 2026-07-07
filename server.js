import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { URL } from "node:url";
import { Readable } from "node:stream";

const PORT = Number(process.env.PORT || 5176);
const PUBLIC_DIR = resolve("public");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".webp": "image/webp"
};

// Sessão do Instagram armazenada em memória
// Será populada via endpoint /api/session
let igSession = {
  sessionid: process.env.IG_SESSION_ID || "",
  csrftoken: process.env.IG_CSRF_TOKEN || "",
  ds_user_id: process.env.IG_DS_USER_ID || ""
};

function buildCookieHeader(extra = "") {
  const parts = [];
  if (igSession.sessionid) parts.push(`sessionid=${igSession.sessionid}`);
  if (igSession.csrftoken) parts.push(`csrftoken=${igSession.csrftoken}`);
  if (igSession.ds_user_id) parts.push(`ds_user_id=${igSession.ds_user_id}`);
  if (extra) parts.push(extra);
  return parts.join("; ");
}

function hasSession() {
  return igSession.sessionid.length > 0;
}

const instagramHeaders = {
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "upgrade-insecure-requests": "1",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function cleanText(value = "") {
  let decoded = decodeHtml(value);
  try {
    decoded = decoded
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\");
  } catch {
    // Ignore
  }
  return decoded
    .replace(/^Instagram: /i, "")
    .trim();
}

function decodeHtml(value = "") {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function getMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i");
  const match = html.match(pattern);
  return match ? decodeHtml(match[1]) : "";
}

function getJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(decodeHtml(block[1]).trim());
      if (parsed) return Array.isArray(parsed) ? parsed[0] : parsed;
    } catch {
      // Continue through malformed or unrelated JSON-LD blocks.
    }
  }
  return {};
}

function getJsonScripts(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const parsed = [];

  for (const block of blocks) {
    try {
      parsed.push(JSON.parse(decodeHtml(block[1]).trim()));
    } catch {
      // Some Instagram script blocks are not useful JSON payloads.
    }
  }

  return parsed;
}

function deepFindMedia(value, found = { videos: [], descriptions: [], thumbnails: [], dashManifests: [] }) {
  if (!value || typeof value !== "object") return found;

  if (Array.isArray(value)) {
    for (const item of value) deepFindMedia(item, found);
    return found;
  }

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      const normalized = cleanMediaUrl(item);
      if (/^(https?:)?\/\//i.test(normalized) && /\.mp4(\?|$)/i.test(normalized)) {
        found.videos.push(normalized.startsWith("//") ? `https:${normalized}` : normalized);
      }
      if (/manifest|dash/i.test(key) && /BaseURL|Representation|SegmentBase|u003CBaseURL/i.test(item)) {
        found.dashManifests.push(item);
      }
      if (/^(https?:)?\/\//i.test(normalized) && /scontent|cdninstagram|fbcdn/i.test(normalized) && /jpg|webp|png/i.test(normalized)) {
        found.thumbnails.push(normalized.startsWith("//") ? `https:${normalized}` : normalized);
      }
      if (/caption|description|title/i.test(key) && item.length > 8 && !/^https?:\/\//i.test(item)) {
        found.descriptions.push(cleanText(item));
      }
    } else {
      deepFindMedia(item, found);
    }
  }

  return found;
}

function cleanMediaUrl(value = "") {
  return decodeHtml(value)
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/u0026/g, "&")
    .replace(/\\u003C|u003C/g, "<")
    .replace(/\\u003E|u003E/g, ">")
    .split("<")[0]
    .replace(/&amp;/g, "&")
    .trim();
}

function decodeManifest(value = "") {
  return decodeHtml(value)
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/u0026/g, "&")
    .replace(/\\u003C|u003C/g, "<")
    .replace(/\\u003E|u003E/g, ">")
    .replace(/\\u0025/g, "%")
    .replace(/u0025/g, "%");
}

function getUrlScore(url, fallbackScore = 0) {
  const efgMatch = url.match(/[?&]efg=([^&]+)/);
  if (!efgMatch) return fallbackScore;

  try {
    let encoded = decodeURIComponent(efgMatch[1]);
    while (/%[0-9A-F]{2}/i.test(encoded)) {
      const decoded = decodeURIComponent(encoded);
      if (decoded === encoded) break;
      encoded = decoded;
    }
    const jsonText = Buffer.from(encoded, "base64").toString("utf8");
    const metadata = JSON.parse(jsonText);
    return Number(metadata.bitrate || fallbackScore) || fallbackScore;
  } catch {
    return fallbackScore;
  }
}

function hasAudioHint(url) {
  return /\/m86\/|progressive|audio|aacl|mp4a|_audio_|audio_dashinit/i.test(url);
}

function findDashVideoCandidates(value) {
  const manifest = decodeManifest(value);
  const candidates = [];
  const representationPattern = /<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/gi;
  let match;

  while ((match = representationPattern.exec(manifest))) {
    const attrs = match[1];
    const body = match[2];
    const baseUrlMatch = body.match(/<BaseURL>([\s\S]*?)<\/BaseURL>/i);
    if (!baseUrlMatch) continue;

    const url = cleanMediaUrl(baseUrlMatch[1]);
    if (!/^https?:\/\//i.test(url) || !/\.mp4(\?|$)/i.test(url)) continue;

    const bandwidth = Number((attrs.match(/\bbandwidth=["']?(\d+)/i) || [])[1] || 0);
    const width = Number((attrs.match(/\bwidth=["']?(\d+)/i) || [])[1] || 0);
    const height = Number((attrs.match(/\bheight=["']?(\d+)/i) || [])[1] || 0);
    const score = bandwidth || (width * height) || getUrlScore(url);

    candidates.push({ url, score, hasAudio: false });
  }

  return candidates;
}

function findEscapedVideoUrls(html) {
  return [...html.matchAll(/https?:\\\/\\\/[^"']+/g)]
    .map((match) => cleanMediaUrl(match[0]))
    .filter((candidate) => /\.mp4(\?|$)/i.test(candidate));
}

function isInstagramErrorPage(html) {
  return /PolarisErrorRoute|httpErrorPage|show_lox_redesigned_404_page/i.test(html);
}

function findVideoUrl(html) {
  const candidates = [];
  const addUrl = (url, score = 0, hasAudio = true) => {
    const cleaned = cleanMediaUrl(url);
    if (/^https?:\/\//i.test(cleaned) && /\.mp4(\?|$)/i.test(cleaned)) {
      candidates.push({
        url: cleaned,
        score: score || getUrlScore(cleaned),
        hasAudio: hasAudio || hasAudioHint(cleaned)
      });
    }
  };

  [
    getMeta(html, "og:video"),
    getMeta(html, "og:video:url"),
    getMeta(html, "og:video:secure_url")
  ].filter(Boolean).forEach((url) => addUrl(url, 0, true));

  const jsonLd = getJsonLd(html);
  if (jsonLd.contentUrl) addUrl(jsonLd.contentUrl, 0, true);
  if (jsonLd.video?.contentUrl) addUrl(jsonLd.video.contentUrl, 0, true);

  const directMatch = html.match(/"video_url"\s*:\s*"([^"]+)"/);
  if (directMatch) {
    addUrl(directMatch[1], 0, true);
  }

  findEscapedVideoUrls(html).forEach((url) => addUrl(url, 0, true));

  for (const scriptJson of getJsonScripts(html)) {
    const found = deepFindMedia(scriptJson);
    found.videos.forEach((url) => addUrl(url, 0, true));
    found.dashManifests.flatMap(findDashVideoCandidates).forEach((candidate) => candidates.push(candidate));
  }

  const byUrl = new Map();
  for (const candidate of candidates) {
    const current = byUrl.get(candidate.url);
    if (!current || candidate.score > current.score) byUrl.set(candidate.url, candidate);
  }

  return [...byUrl.values()]
    .sort((a, b) => Number(b.hasAudio) - Number(a.hasAudio) || b.score - a.score)[0]?.url || "";
}

function findDescription(html) {
  const jsonCaptions = [];
  for (const scriptJson of getJsonScripts(html)) {
    jsonCaptions.push(...deepFindMedia(scriptJson).descriptions);
  }

  const jsonLd = getJsonLd(html);
  const candidates = [
    ...jsonCaptions,
    jsonLd.caption,
    jsonLd.description,
    getMeta(html, "og:description")
  ].filter(Boolean);

  return cleanText(candidates.find(Boolean) || "");
}

function findThumbnail(html) {
  const jsonLd = getJsonLd(html);
  const thumbnails = [
    getMeta(html, "og:image"),
    jsonLd.thumbnailUrl
  ].filter(Boolean);

  for (const scriptJson of getJsonScripts(html)) {
    thumbnails.push(...deepFindMedia(scriptJson).thumbnails);
  }

  return [...new Set(thumbnails)].find((candidate) => /^https?:\/\//i.test(candidate)) || "";
}

function normalizeInstagramUrl(value) {
  const url = new URL(value);
  const allowedHosts = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Use um link começando com http ou https.");
  }

  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    if (/\.mp4($|\?)/i.test(url.pathname)) return url;
    throw new Error("Cole um link público do Instagram ou um link direto .mp4.");
  }

  url.protocol = "https:";
  return url;
}

function getEmbedUrl(instagramUrl) {
  try {
    const url = new URL(instagramUrl);
    url.search = ""; // Limpa parâmetros
    let pathname = url.pathname.replace(/\/embed\/?$/i, "");
    if (!pathname.endsWith("/")) {
      pathname += "/";
    }
    url.pathname = pathname + "embed/";
    return url.toString();
  } catch {
    return instagramUrl;
  }
}

async function inspectUrl(rawUrl) {
  const url = normalizeInstagramUrl(rawUrl);

  if (/\.mp4($|\?)/i.test(url.pathname)) {
    return {
      sourceUrl: url.toString(),
      videoUrl: url.toString(),
      description: "Link direto de vídeo.",
      title: "video-instagram",
      thumbnail: "",
      note: "Link direto detectado."
    };
  }

  // Montar headers com cookie de sessão se disponível
  const headersWithSession = { ...instagramHeaders };
  const cookieHeader = buildCookieHeader();
  if (cookieHeader) {
    headersWithSession["cookie"] = cookieHeader;
    headersWithSession["x-csrftoken"] = igSession.csrftoken || "";
    headersWithSession["x-ig-app-id"] = "936619743392459";
    headersWithSession["sec-fetch-site"] = "same-origin";
  }

  let html = "";
  let response;
  try {
    response = await fetch(url, { headers: headersWithSession, redirect: "follow" });
    if (response.ok) {
      html = await response.text();
    }
  } catch (err) {
    // Silenciar erros de conexão para tentar o fallback
  }

  let videoUrl = "";
  if (html) {
    videoUrl = findVideoUrl(html);
  }

  // Fallback via GraphQL quando há sessão ativa (funciona sem bloqueio com sessionid)
  if (!videoUrl && hasSession()) {
    try {
      const shortcodeMatch = url.pathname.match(/\/(p|reel|tv|reels)\/([A-Za-z0-9_-]+)/);
      if (shortcodeMatch) {
        const shortcode = shortcodeMatch[2];
        const gqlHeaders = {
          "accept": "*/*",
          "content-type": "application/x-www-form-urlencoded",
          "cookie": cookieHeader,
          "x-csrftoken": igSession.csrftoken,
          "x-ig-app-id": "936619743392459",
          "x-requested-with": "XMLHttpRequest",
          "referer": "https://www.instagram.com/",
          "user-agent": instagramHeaders["user-agent"]
        };
        const gqlBody = new URLSearchParams({
          variables: JSON.stringify({ shortcode }),
          doc_id: "9510064595728286"
        }).toString();
        const gqlRes = await fetch("https://www.instagram.com/graphql/query", {
          method: "POST",
          headers: gqlHeaders,
          body: gqlBody
        });
        const gqlData = await gqlRes.json();
        const media = gqlData?.data?.xdt_shortcode_media;
        if (media?.video_url) {
          videoUrl = cleanMediaUrl(media.video_url);
          const captionEdge = media?.edge_media_to_caption?.edges?.[0]?.node?.text || "";
          const gqlDescription = cleanText(captionEdge);
          const gqlThumbnail = media?.display_url || "";
          return {
            sourceUrl: url.toString(),
            videoUrl,
            description: gqlDescription,
            title: cleanText(getMeta(html, "og:title") || "video-instagram"),
            thumbnail: gqlThumbnail,
            note: "Vídeo obtido com sucesso via sessão autenticada."
          };
        }
      }
    } catch (e) {
      console.error("Erro no fallback GraphQL:", e.message);
    }
  }

  // Fallback para o link de EMBED do Instagram se o link principal for bloqueado ou falhar
  if (!videoUrl || isInstagramErrorPage(html) || !response || !response.ok) {
    try {
      const embedUrl = getEmbedUrl(url.toString());
      const embedResponse = await fetch(embedUrl, { headers: headersWithSession, redirect: "follow" });
      if (embedResponse.ok) {
        const embedHtml = await embedResponse.text();
        const embedVideoUrl = findVideoUrl(embedHtml);
        if (embedVideoUrl) {
          videoUrl = embedVideoUrl;
          html = embedHtml;
        }
      }
    } catch (e) {
      console.error("Erro no fallback do Embed:", e.message);
    }
  }

  const description = findDescription(html);
  const title = cleanText(getMeta(html, "og:title") || "video-instagram");
  const thumbnail = findThumbnail(html);

  if (!videoUrl) {
    if (isInstagramErrorPage(html)) {
      throw new Error("O Instagram devolveu uma pagina de erro para esse link. Confira se o Reel ainda existe, se o link esta completo e se ele abre sem login em uma janela anonima.");
    }
    if (!hasSession()) {
      throw new Error("Configure sua sessão do Instagram nas Configurações do app para desbloquear o download.");
    }
    throw new Error("Nao encontrei uma URL publica de video nesta pagina. O post pode exigir login, ser privado, ser carrossel, story, ou o Instagram pode ter ocultado o arquivo.");
  }

  return {
    sourceUrl: url.toString(),
    videoUrl,
    description,
    title,
    thumbnail,
    note: "Vídeo obtido com sucesso."
  };
}

async function proxyDownload(req, res, rawUrl, filename, inline = false) {
  const abortController = new AbortController();

  req.on("close", () => {
    abortController.abort();
  });

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("URL de vídeo inválida.");
    }

    const outgoingHeaders = {
      "accept": "video/webm,video/ogg,video/*;q=0.9,*/*;q=0.8",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "referer": "https://www.instagram.com/",
      "sec-fetch-dest": "video",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-site": "cross-site",
      "user-agent": instagramHeaders["user-agent"]
    };

    if (req.headers.range) {
      outgoingHeaders.range = req.headers.range;
    }

    const response = await fetch(url, {
      headers: outgoingHeaders,
      redirect: "follow",
      signal: abortController.signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`Falha ao baixar o vídeo: ${response.status}.`);
    }

    const responseHeaders = {
      "content-type": "video/mp4",
      "cache-control": "no-store",
      "accept-ranges": "bytes",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS"
    };

    if (inline) {
      responseHeaders["content-disposition"] = "inline";
    } else {
      const safeName = (filename || "instagram-video")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9._-]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "instagram-video";
      responseHeaders["content-disposition"] = `attachment; filename="${safeName}.mp4"`;
    }

    const contentLength = response.headers.get("content-length");
    const contentRange = response.headers.get("content-range");
    if (contentLength) responseHeaders["content-length"] = contentLength;
    if (contentRange) responseHeaders["content-range"] = contentRange;

    res.writeHead(response.status, responseHeaders);

    const nodeStream = Readable.fromWeb(response.body);
    nodeStream.pipe(res);

    nodeStream.on("error", (err) => {
      console.error("Erro na stream do proxy:", err.message);
      abortController.abort();
    });
  } catch (err) {
    if (err.name === "AbortError") {
      return;
    }
    console.error("Erro no proxy:", err.message);
    if (!res.headersSent) {
      sendJson(res, 500, { error: err.message });
    }
  }
}

async function serveStatic(req, res, pathname) {
  const filePath = pathname === "/" ? join(PUBLIC_DIR, "index.html") : join(PUBLIC_DIR, pathname);
  const resolved = resolve(filePath);

  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(resolved);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(resolved)] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET, HEAD, OPTIONS"
      });
      res.end();
      return;
    }

    const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);

    // Endpoint para salvar cookies de sessão do Instagram
    if (requestUrl.pathname === "/api/session" && req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString("utf-8");
      try {
        const payload = JSON.parse(body);
        if (payload.sessionid) {
          igSession.sessionid = payload.sessionid.trim();
          igSession.csrftoken = (payload.csrftoken || "").trim();
          igSession.ds_user_id = (payload.ds_user_id || "").trim();
          console.log("[Config] Sessão do Instagram atualizada.");
          return sendJson(res, 200, { ok: true, message: "Sessão salva! Pode baixar os vídeos agora." });
        } else {
          return sendJson(res, 400, { error: "Campo sessionid é obrigatório." });
        }
      } catch {
        return sendJson(res, 400, { error: "JSON inválido." });
      }
    }

    // Endpoint para verificar se há sessão configurada
    if (requestUrl.pathname === "/api/session" && req.method === "GET") {
      return sendJson(res, 200, {
        configured: hasSession(),
        ds_user_id: igSession.ds_user_id || ""
      });
    }

    if (requestUrl.pathname === "/api/inspect") {
      const target = requestUrl.searchParams.get("url") || "";
      if (!target) return sendJson(res, 400, { error: "Cole um link primeiro." });
      const data = await inspectUrl(target);
      return sendJson(res, 200, data);
    }

    if (requestUrl.pathname === "/api/download") {
      const target = requestUrl.searchParams.get("url") || "";
      const filename = requestUrl.searchParams.get("filename") || "";
      const inline = requestUrl.searchParams.get("inline") === "true";
      if (!target) return sendJson(res, 400, { error: "URL de vídeo ausente." });
      return await proxyDownload(req, res, target, filename, inline);
    }

    await serveStatic(req, res, decodeURIComponent(requestUrl.pathname));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Erro inesperado." });
  }
}).listen(PORT, "0.0.0.0", () => {
  console.log(`IG Video Downloader local: http://0.0.0.0:${PORT}`);
});
