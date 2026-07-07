// Testar o endpoint graphql diretamente com o doc_id que a biblioteca usa
const postUrl = "https://www.instagram.com/reel/C8j-JAcAT-b/";
const shortcode = "C8j-JAcAT-b";

async function getCSRF() {
  const res = await fetch("https://www.instagram.com/", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html",
    }
  });
  const cookies = [];
  for (const [key, val] of res.headers.entries()) {
    if (key.toLowerCase() === "set-cookie") {
      cookies.push(val);
    }
  }
  let csrf = "";
  let cookieStr = "";
  for (const c of cookies) {
    const kv = c.split(";")[0].trim();
    if (kv.startsWith("csrftoken=")) {
      csrf = kv.replace("csrftoken=", "");
    }
    cookieStr += kv + "; ";
  }
  console.log("CSRF:", csrf.slice(0, 20));
  console.log("Cookies:", cookieStr.slice(0, 80));
  return { csrf, cookieStr };
}

async function test() {
  const { csrf, cookieStr } = await getCSRF();
  
  const variables = JSON.stringify({
    shortcode,
    fetch_tagged_user_count: null,
    hoisted_comment_id: null,
    hoisted_reply_id: null
  });
  
  // Try multiple doc_ids
  const docIds = [
    "9510064595728286",  // from instagram-url-direct
    "8845758582119845",  // alternative
    "10019507408719835", // another
  ];
  
  for (const docId of docIds) {
    console.log(`\nTrying doc_id: ${docId}`);
    const body = new URLSearchParams({
      variables,
      doc_id: docId
    }).toString();

    const res = await fetch("https://www.instagram.com/graphql/query", {
      method: "POST",
      headers: {
        "X-CSRFToken": csrf,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://www.instagram.com/",
        "Cookie": cookieStr,
        "X-Requested-With": "XMLHttpRequest",
        "X-IG-App-ID": "936619743392459",
      },
      body
    });
    
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Length:", text.length);
    
    try {
      const data = JSON.parse(text);
      if (data.data?.xdt_shortcode_media) {
        const m = data.data.xdt_shortcode_media;
        console.log("SUCCESS with doc_id", docId, "! Video URL:", m.video_url?.slice(0, 100));
        return;
      } else {
        console.log("Response:", JSON.stringify(data).slice(0, 200));
      }
    } catch {
      console.log("Non-JSON response:", text.slice(0, 200));
    }
  }
  
  try {
    const data = JSON.parse(text);
    console.log("Data keys:", Object.keys(data));
    if (data.data?.xdt_shortcode_media) {
      const m = data.data.xdt_shortcode_media;
      console.log("SUCCESS! Media type:", m.__typename);
      console.log("Is video:", m.is_video);
      console.log("Video URL:", m.video_url?.slice(0, 100));
      console.log("Caption:", m.edge_media_to_caption?.edges?.[0]?.node?.text?.slice(0, 100));
    } else {
      console.log("Response data:", JSON.stringify(data, null, 2).slice(0, 800));
    }
  } catch {
    console.log("Response text:", text.slice(0, 500));
  }
}

test().catch(e => {
  console.error("Error:", e.message);
});
