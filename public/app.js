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
    const response = await fetch(`/api/inspect?url=${encodeURIComponent(postUrl)}`);
    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error || "Não foi possível carregar esse link.");
    }

    video.src = `/api/download?url=${encodeURIComponent(data.videoUrl)}&inline=true`;
    if (data.thumbnail) video.poster = data.thumbnail;
    description.textContent = data.description || "Sem descrição pública encontrada.";

    const fileName = makeFilename(data.title || data.description);
    downloadButton.href = `/api/download?url=${encodeURIComponent(data.videoUrl)}&filename=${encodeURIComponent(fileName)}`;
    downloadButton.setAttribute("download", `${fileName}.mp4`);

    emptyState.classList.add("hidden");
    result.classList.remove("hidden");
    setDownloadEnabled(true);
    setStatus(data.note || "Vídeo pronto para baixar.");
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
