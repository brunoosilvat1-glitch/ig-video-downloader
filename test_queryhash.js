// Testar método alternativo: usar o endpoint de conteúdo do Instagram web com query_hash legado
const shortcode = "C8j-JAcAT-b";

async function getCSRFAndSession() {
  const res = await fetch("https://www.instagram.com/", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    }
  });
  const cookieMap = {};
  for (const [, val] of [...res.headers.entries()].filter(([k]) => k === "set-cookie")) {
    const parts = val.split(";")[0].trim().split("=");
    if (parts.length >= 2) cookieMap[parts[0]] = parts.slice(1).join("=");
  }
  return {
    csrf: cookieMap["csrftoken"] || "",
    cookieStr: Object.entries(cookieMap).map(([k,v]) => `${k}=${v}`).join("; ")
  };
}

async function test() {
  const { csrf, cookieStr } = await getCSRFAndSession();
  console.log("CSRF:", csrf.slice(0,20));
  
  // Try old graphql query_hash approach
  const queryHashes = [
    "b3055c01b4b222b8a47dc12b090e4e64",
    "2efa04f61586458cef44441f474eee91",
    "477b65a610463740ccdb83135b2014db",
  ];
  
  for (const hash of queryHashes) {
    const url = `https://www.instagram.com/graphql/query/?query_hash=${hash}&variables=${encodeURIComponent(JSON.stringify({ shortcode }))}`;
    console.log(`\nTrying hash ${hash.slice(0,8)}...`);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "X-CSRFToken": csrf,
        "Referer": "https://www.instagram.com/",
        "Cookie": cookieStr,
        "X-IG-App-ID": "936619743392459",
      }
    });
    console.log("Status:", res.status);
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (data.data?.shortcode_media) {
        const m = data.data.shortcode_media;
        console.log("SUCCESS! Video URL:", m.video_url?.slice(0, 100));
        return;
      } else {
        console.log("Data:", JSON.stringify(data).slice(0, 200));
      }
    } catch {
      console.log("Non-JSON:", text.slice(0, 200));
    }
  }
  
  // Try the embed with video url
  console.log("\nTrying embed approach...");
  const embedRes = await fetch(`https://www.instagram.com/reel/${shortcode}/embed/captioned/`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html",
    }
  });
  const embedHtml = await embedRes.text();
  console.log("Embed status:", embedRes.status);
  console.log("Embed length:", embedHtml.length);
  
  // Search for video URLs in the embed page
  const videoUrlMatch = embedHtml.match(/"video_url":"([^"]+)"/);
  const mp4InScript = embedHtml.match(/src="(https?[^"]+\.mp4[^"]*)"/);
  console.log("video_url field:", videoUrlMatch ? videoUrlMatch[1].replace(/\\\//g, "/").slice(0, 100) : "NOT FOUND");
  console.log("mp4 in script:", mp4InScript ? mp4InScript[1].slice(0, 100) : "NOT FOUND");
  
  // Check for PlaybackURL or CDN URL in embed
  const cdnMatch = embedHtml.match(/"(https?:\/\/[^"]*(?:cdninstagram|fbcdn)[^"]*\.mp4[^"]*)"/);
  console.log("CDN mp4:", cdnMatch ? cdnMatch[1].replace(/\\\//g, "/").slice(0, 100) : "NOT FOUND");
  
  // Save HTML snippet with video reference
  const videoIdx = embedHtml.indexOf("video");
  if (videoIdx !== -1) {
    console.log("Video context:", embedHtml.slice(Math.max(0, videoIdx - 50), videoIdx + 200));
  }
}

test().catch(console.error);
