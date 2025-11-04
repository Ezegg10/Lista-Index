// Importa os scripts do Firebase (versão compat para facilitar no SW)
importScripts("https://www.gstatic.com/firebasejs/11.6.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging-compat.js");

// Configuração do Firebase (a mesma do app.js)
const firebaseConfig = {
  apiKey: "AIzaSyBl8K0WVSDtGsgJygr3yCSsQ_voywnm114",
  authDomain: "gerenciador-saidas-5s-e4c58.firebaseapp.com",
  databaseURL: "https://gerenciador-saidas-5s-e4c58-default-rtdb.firebaseio.com",
  projectId: "gerenciador-saidas-5s-e4c58",
  storageBucket: "gerenciador-saidas-5s-e4c58.firebasestorage.app",
  messagingSenderId: "990056306037",
  appId: "1:990056306037:web:7bb1f8b8247631acb3af3c",
  measurementId: "G-0ZFEQRYPQT"
};

// Inicializa o Firebase
firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// --- LÓGICA DE PWA (OFFLINE CACHING) ---

const CACHE_NAME = 'saidas-app-cache-v1';
// Lista de ficheiros essenciais para a app funcionar offline
const FILES_TO_CACHE = [
  '/index.html', // Ou a raiz '/' se for o caso
  '/style.css',
  '/app.js',
  '/manifest.json'
  // Adicione aqui URLs de fontes ou ícones locais, se tiver
];

// Evento 'install' - Ocorre quando o SW é instalado
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Cache aberto. Adicionando ficheiros essenciais.');
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting(); // Força o novo SW a assumir
});

// Evento 'fetch' - Interceta todos os pedidos de rede
self.addEventListener('fetch', (event) => {
  event.respondWith(
    // 1. Tenta ir à cache primeiro
    caches.match(event.request).then((response) => {
      if (response) {
        // console.log('[SW] A servir da cache:', event.request.url);
        return response; // Encontrado na cache
      }

      // 2. Se não estiver na cache, vai à rede
      // console.log('[SW] A ir à rede:', event.request.url);
      return fetch(event.request).then((networkResponse) => {
        // (Opcional) Poderíamos clonar e guardar a resposta da rede na cache aqui
        // Mas para esta app, focar-se no cache estático (install) é suficiente
        return networkResponse;
      });
    }).catch((error) => {
      console.error('[SW] Erro no fetch:', error);
      // (Opcional) Poderia devolver uma página de fallback offline
    })
  );
});

// Evento 'activate' - Limpa caches antigos
self.addEventListener('activate', (event) => {
  console.log('[SW] Ativando...');
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[SW] A remover cache antiga:', key);
          return caches.delete(key);
        }
      }));
    })
  );
  return self.clients.claim(); // Torna-se o SW ativo imediatamente
});


// --- LÓGICA DE NOTIFICAÇÃO PUSH ---

// Ouve por mensagens push quando a app está em segundo plano ou fechada
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Mensagem Push recebida em segundo plano: ', payload);

  const notificationTitle = payload.notification.title || 'Nova Mensagem';
  const notificationOptions = {
    body: payload.notification.body || 'Você tem uma nova atualização.',
    icon: '/icon-192.png' // Certifique-se que este ícone existe ou use um do manifest
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
