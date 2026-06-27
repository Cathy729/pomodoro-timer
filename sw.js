// 番茄钟 Service Worker — 离线缓存与快速加载
const CACHE_NAME = 'pomodoro-v2';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './提示音1.wav',
  './提示音2.wav',
  './提示音3.wav',
  './音乐1.wav',
  './音乐2.mp3',
  './音乐3.wav'
];

// 安装：预缓存所有资源
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('🍅 番茄钟: 缓存资源中...');
      return cache.addAll(ASSETS).catch(err => {
        console.warn('部分资源缓存失败（可能文件较大）:', err);
      });
    })
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 请求：优先缓存，回退网络（大文件直接从网络请求）
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // 音频文件：网络优先（文件太大不适合全部预缓存）
  if (url.pathname.match(/\.(wav|mp3)$/)) {
    e.respondWith(
      fetch(e.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return response;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // 其他资源：缓存优先
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
