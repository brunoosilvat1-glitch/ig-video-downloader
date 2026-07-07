const CACHE_NAME = "ig-downloader-v6";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];

// Instalar Service Worker e salvar arquivos estáticos no cache
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Ativar e limpar caches antigos
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Responder requisições com cache ou buscar na rede
self.addEventListener("fetch", (event) => {
  // Ignorar chamadas de API do backend (não devem ser gerenciadas pelo SW)
  if (event.request.url.includes("/api/")) {
    return;
  }

  // Ignorar requisições fora do nosso próprio domínio (evita quebrar mídias externas no Safari)
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Ignorar requisições com cabeçalho de Range ou de vídeo (evita bugs de reprodução no iOS)
  if (event.request.headers.has("range") || event.request.url.match(/\.(mp4|m3u8|webm|ogg)($|\?)/i)) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        // Salva novas páginas estáticas no cache dinamicamente
        if (response.status === 200 && response.type === "basic") {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      });
    }).catch(() => {
      // Retorna a página inicial se estiver offline
      return caches.match("/");
    })
  );
});
