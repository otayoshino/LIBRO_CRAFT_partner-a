/**
 * Google Analytics 4（gtag.js）による利用状況の計測（社内分析用）。
 *
 * - 本番の配置先（ALLOWED_LOCATIONS）で開かれたときだけ gtag.js を読み込む。
 *   localhost・開発機・検証配備では何も読み込まず、trackEvent() も何もしない。
 * - 測定IDがプレースホルダのままのときも何もしない。
 * - book名・ファイル名・URL・部品の内容など、book固有の情報は送らない。
 */

// 測定ID。発行後にこの行だけ差し替える（未発行の間はプレースホルダのまま＝計測しない）
const GA_MEASUREMENT_ID = 'G-MT0VFHGQ8B';
const GA_PLACEHOLDER_ID = 'G-' + 'XXXXXXXXXX';

// main と partner-a を同じプロパティで区別するための値
const APP_VARIANT = 'partner-a';

// 計測する配置先（hostname 完全一致 かつ pathname 前方一致）
// '/LIBRO_CRAFT/' は本番機上の検証配備 '/LIBRO_CRAFT_test/' に一致しない
const ALLOWED_LOCATIONS = [
  { hostname: 'craft.libro-plus.com', pathPrefix: '/LIBRO_CRAFT/' },
];

let enabled = false;

function isAllowedLocation() {
  const { hostname, pathname } = window.location;
  return ALLOWED_LOCATIONS.some(loc => hostname === loc.hostname && pathname.startsWith(loc.pathPrefix));
}

/** 起動時に1回呼ぶ。条件を満たすときだけ gtag.js を読み込む */
export function initAnalytics() {
  if (enabled) return;
  if (GA_MEASUREMENT_ID === GA_PLACEHOLDER_ID || !/^G-[A-Z0-9]+$/.test(GA_MEASUREMENT_ID)) return;
  if (!isAllowedLocation()) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID, {
    app_variant: APP_VARIANT,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
  document.head.appendChild(script);

  enabled = true;
}

/** カスタムイベントを送る。計測無効時は何もしない。送信の失敗は本体の動作に影響させない */
export function trackEvent(name, params = {}) {
  if (!enabled) return;
  try {
    window.gtag('event', name, { app_variant: APP_VARIANT, ...params });
  } catch (_) {
    // 計測の失敗は無視する
  }
}
