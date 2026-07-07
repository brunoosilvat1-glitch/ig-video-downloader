// Testar se conseguimos usar o graphql com cookies do proprio usuario
// Simular o que o navegador do usuario faz quando esta logado no instagram

async function testWithUserAgent(userAgent) {
  const sessionRes = await fetch("https://www.instagram.com/", {
    headers: {
      "User-Agent": userAgent,
      "Accept": "text/html",
    }
  });
  const cookieMap = {};
  for (const [k, v] of sessionRes.headers.entries()) {
    if (k === "set-cookie") {
      const kv = v.split(";")[0].trim();
      const eqIdx = kv.indexOf("=");
      if (eqIdx > 0) cookieMap[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1);
    }
  }
  const csrf = cookieMap["csrftoken"] || "";
  const cookieStr = Object.entries(cookieMap).map(([k,v]) => `${k}=${v}`).join("; ");
  
  const shortcode = "C8j-JAcAT-b";
  const body = new URLSearchParams({
    variables: JSON.stringify({ shortcode }),
    doc_id: "9510064595728286"
  }).toString();
  
  const res = await fetch("https://www.instagram.com/graphql/query", {
    method: "POST",
    headers: {
      "X-CSRFToken": csrf,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
      "Accept": "*/*",
      "Referer": "https://www.instagram.com/",
      "Cookie": cookieStr,
      "X-IG-App-ID": "936619743392459",
      "X-ASBD-ID": "129477",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
    },
    body
  });
  
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (data.data?.xdt_shortcode_media?.video_url) {
      return { success: true, videoUrl: data.data.xdt_shortcode_media.video_url };
    }
    return { success: false, response: JSON.stringify(data).slice(0, 100) };
  } catch {
    return { success: false, response: text.slice(0, 100) };
  }
}

async function main() {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
  ];
  
  for (const ua of userAgents) {
    const name = ua.slice(0, 50);
    console.log(`\nTesting: ${name}...`);
    const result = await testWithUserAgent(ua);
    if (result.success) {
      console.log("SUCCESS! Video URL:", result.videoUrl.slice(0, 100));
      return;
    } else {
      console.log("Failed:", result.response);
    }
  }
}

main().catch(console.error);
