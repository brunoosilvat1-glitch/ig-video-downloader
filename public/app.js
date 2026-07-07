const form = document.querySelector("#videoForm");
const input = document.querySelector("#postUrl");
const statusBox = document.querySelector("#status");
const result = document.querySelector("#result");
const emptyState = document.querySelector("#emptyState");
const video = document.querySelector("#video");
const description = document.querySelector("#description");
const downloadButton = document.querySelector("#downloadButton");
const loadButton = document.querySelector("#loadButton");

function setStatus(message, type = "info") {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", type === "error");
}

function makeFilename(text) {
  return (text || "instagram-video")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "instagram-video";
}

function setDownloadEnabled(enabled) {
  downloadButton.classList.toggle("disabled", !enabled);
  downloadButton.setAttribute("aria-disabled", String(!enabled));
}

function getShortcode(url) {
  const match = url.match(/\/(p|reel|tv|reels)\/([A-Za-z0-9_-]+)/);
  return match ? match[2] : null;
}

function decodeHtml(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Extrai URL do vídeo do HTML da página de embed do Instagram
// O HTML é carregado pelo celular do próprio usuário (com IP residencial e sem bloqueio)
async function extractFromEmbed(postUrl) {
  const shortcode = getShortcode(postUrl);
  if (!shortcode) throw new Error("Link do Instagram inválido. Verifique se o link é de um Reel ou post público.");

  // Usar o nosso servidor como proxy para evitar CORS ao fazer o fetch do HTML
  const response = await fetch(`/api/inspect?url=${encodeURIComponent(postUrl)}`);
  const data = await response.json();

  if (data.error) throw new Error(data.error);
  if (!data.videoUrl) throw new Error("Não foi possível encontrar o vídeo neste link.");

  return data;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const postUrl = input.value.trim();
  if (!postUrl) return;

  result.classList.add("hidden");
  emptyState.classList.remove("hidden");
  setDownloadEnabled(false);
  loadButton.disabled = true;
  setStatus("Carregando vídeo e descrição...");

  try {
    const data = await extractFromEmbed(postUrl);

    // Tentar mostrar o video direto (funciona no desktop e alguns celulares)
    video.src = data.videoUrl;
    if (data.thumbnail) video.poster = data.thumbnail;
    description.textContent = data.description || "Sem descrição pública encontrada.";

    const fileName = makeFilename(data.title || data.description);

    // Botão de download usa proxy do servidor para forçar download correto
    downloadButton.href = `/api/download?url=${encodeURIComponent(data.videoUrl)}&filename=${encodeURIComponent(fileName)}`;
    downloadButton.removeAttribute("target");
    downloadButton.setAttribute("download", `${fileName}.mp4`);

    // Se o vídeo não carregar em 5 segundos, tentar via proxy
    const videoLoadTimeout = setTimeout(() => {
      if (video.readyState < 2) {
        // Mudar para proxy como fallback
        video.src = `/api/download?url=${encodeURIComponent(data.videoUrl)}&inline=true`;
      }
    }, 5000);

    video.addEventListener("loadeddata", () => {
      clearTimeout(videoLoadTimeout);
    }, { once: true });

    video.addEventListener("error", () => {
      clearTimeout(videoLoadTimeout);
      // Tentar proxy como fallback quando o link direto falha
      if (!video.src.includes("/api/download")) {
        video.src = `/api/download?url=${encodeURIComponent(data.videoUrl)}&inline=true`;
      }
    }, { once: true });

    emptyState.classList.add("hidden");
    result.classList.remove("hidden");
    setDownloadEnabled(true);
    setStatus("Vídeo pronto. Aperte play ou clique em Baixar vídeo.");
  } catch (error) {
    description.textContent = "Carregue um link válido para ver a descrição pública aqui.";
    setStatus(error.message, "error");
  } finally {
    loadButton.disabled = false;
  }
});

// Registra o Service Worker para PWA
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then((reg) => console.log("Service Worker registrado:", reg.scope))
      .catch((err) => console.error("Erro no Service Worker:", err));
  });
}
