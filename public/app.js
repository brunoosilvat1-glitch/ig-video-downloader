const form = document.querySelector("#videoForm");
const input = document.querySelector("#postUrl");
const statusBox = document.querySelector("#status");
const result = document.querySelector("#result");
const emptyState = document.querySelector("#emptyState");
const video = document.querySelector("#video");
const description = document.querySelector("#description");
const downloadButton = document.querySelector("#downloadButton");
const loadButton = document.querySelector("#loadButton");
const settingsBtn = document.querySelector("#settingsBtn");
const sessionModal = document.querySelector("#sessionModal");
const sessionForm = document.querySelector("#sessionForm");
const modalCloseBtn = document.querySelector("#modalClose");
const sessionStatusDot = document.querySelector("#sessionStatusDot");
const sessionStatusText = document.querySelector("#sessionStatusText");

// ──── Status ────────────────────────────────────────────────────────────────
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

// ──── Verificar sessão ───────────────────────────────────────────────────────
async function checkSessionStatus() {
  try {
    const res = await fetch("/api/session");
    const data = await res.json();
    if (data.configured) {
      sessionStatusDot.classList.add("active");
      sessionStatusDot.classList.remove("inactive");
      sessionStatusText.textContent = "Sessão ativa";
    } else {
      sessionStatusDot.classList.remove("active");
      sessionStatusDot.classList.add("inactive");
      sessionStatusText.textContent = "Sem sessão";
    }
    return data.configured;
  } catch {
    return false;
  }
}

// ──── Modal de sessão ────────────────────────────────────────────────────────
function openModal() {
  sessionModal.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  sessionModal.classList.remove("open");
  document.body.style.overflow = "";
}

settingsBtn.addEventListener("click", openModal);
modalCloseBtn.addEventListener("click", closeModal);
sessionModal.addEventListener("click", (e) => {
  if (e.target === sessionModal) closeModal();
});

sessionForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const sessionid = document.querySelector("#sessionid").value.trim();
  const csrftoken = document.querySelector("#csrftoken").value.trim();
  const ds_user_id = document.querySelector("#ds_user_id").value.trim();

  if (!sessionid) {
    document.querySelector("#sessionError").textContent = "O campo sessionid é obrigatório.";
    return;
  }
  document.querySelector("#sessionError").textContent = "";

  const saveBtn = document.querySelector("#saveSessionBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Salvando...";

  try {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionid, csrftoken, ds_user_id })
    });
    const data = await res.json();
    if (data.ok) {
      await checkSessionStatus();
      closeModal();
      setStatus("✅ Sessão do Instagram configurada! Agora você pode baixar qualquer vídeo.");
    } else {
      document.querySelector("#sessionError").textContent = data.error || "Erro ao salvar.";
    }
  } catch {
    document.querySelector("#sessionError").textContent = "Erro de conexão com o servidor.";
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Salvar sessão";
  }
});

// ──── Form principal ─────────────────────────────────────────────────────────
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
      // Se o erro for por falta de sessão, abrir o modal
      if (data.error && data.error.includes("sessão")) {
        openModal();
      }
      throw new Error(data.error || "Não foi possível carregar esse link.");
    }

    // Tentar URL direta primeiro (funciona bem no desktop)
    video.src = data.videoUrl;
    if (data.thumbnail) video.poster = data.thumbnail;
    description.textContent = data.description || "Sem descrição pública encontrada.";

    const fileName = makeFilename(data.title || data.description);
    downloadButton.href = `/api/download?url=${encodeURIComponent(data.videoUrl)}&filename=${encodeURIComponent(fileName)}`;
    downloadButton.removeAttribute("target");
    downloadButton.setAttribute("download", `${fileName}.mp4`);

    // Fallback automático para proxy se o vídeo não carregar em 4 segundos
    let fallbackTriggered = false;
    const fallbackTimeout = setTimeout(() => {
      if (video.readyState < 2 && !fallbackTriggered) {
        fallbackTriggered = true;
        video.src = `/api/download?url=${encodeURIComponent(data.videoUrl)}&inline=true`;
      }
    }, 4000);

    video.addEventListener("loadeddata", () => clearTimeout(fallbackTimeout), { once: true });
    video.addEventListener("error", () => {
      clearTimeout(fallbackTimeout);
      if (!fallbackTriggered) {
        fallbackTriggered = true;
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

// ──── Init ───────────────────────────────────────────────────────────────────
checkSessionStatus();

// Registra o Service Worker para PWA
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then((reg) => console.log("Service Worker registrado:", reg.scope))
      .catch((err) => console.error("Erro no Service Worker:", err));
  });
}
