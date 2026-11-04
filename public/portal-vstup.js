/* Přístup jen přes DATEC Portál (stejný soubor ve všech chráněných agendách).
   Portál otevře agendu na adrese …#portal=<vstupenka>. Stránka si vstupenku uloží do sessionStorage,
   odstraní ji z adresy a přidává ji v hlavičce x-portal-token ke každému dotazu na vlastní /api.
   Bez vstupenky, nebo když ji API odmítne, zakryje stránku výzvou k otevření z portálu. */
(function () {
  "use strict";
  var PORTAL = "https://datec-portal.netlify.app", KLIC = "datec_portal_vstupenka", token = "";
  try {
    var m = /(?:^#|&)portal=([^&]+)/.exec(location.hash);
    if (m) {
      token = decodeURIComponent(m[1]);
      try { sessionStorage.setItem(KLIC, token); } catch (e) { /* jen v paměti */ }
      history.replaceState(null, "", location.pathname + location.search);
    } else {
      try { token = sessionStorage.getItem(KLIC) || ""; } catch (e) { token = ""; }
    }
  } catch (e) { /* bez vstupenky */ }

  var zakryto = false;
  function zavora(text) {
    if (zakryto) return; zakryto = true;
    try { sessionStorage.removeItem(KLIC); } catch (e) { /* nic */ }
    var ukaz = function () {
      var d = document.createElement("div");
      d.setAttribute("role", "alertdialog");
      d.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;" +
        "background:#eef4fb;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0b2545";
      var k = document.createElement("div");
      k.style.cssText = "max-width:440px;background:#fff;border:2px solid #0b2f5b;border-radius:18px;padding:26px 24px;text-align:center;box-shadow:6px 6px 0 #0b2f5b";
      var h = document.createElement("h1"); h.textContent = "Otevřete agendu z DATEC Portálu"; h.style.cssText = "font-size:21px;margin:0 0 10px";
      var p = document.createElement("p"); p.textContent = text || "Tato agenda je dostupná jen po přihlášení do DATEC Portálu."; p.style.margin = "0 0 18px";
      var a = document.createElement("a"); a.href = PORTAL; a.target = "_top"; a.textContent = "Přejít do DATEC Portálu";
      a.style.cssText = "display:inline-block;background:#0b2f5b;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:12px";
      k.append(h, p, a); d.append(k); document.body.append(d);
    };
    if (document.body) ukaz(); else document.addEventListener("DOMContentLoaded", ukaz);
  }

  var vlastniApi = function (adresa) {
    try { var u = new URL(adresa, location.href); return u.origin === location.origin && /^\/api(\/|$)/.test(u.pathname) && u.pathname !== "/api/health"; }
    catch (e) { return false; }
  };
  var puvodni = window.fetch.bind(window);
  window.fetch = function (vstup, init) {
    var adresa = typeof vstup === "string" ? vstup : (vstup && vstup.url) || String(vstup);
    if (!vlastniApi(adresa)) return puvodni(vstup, init);
    if (!token) { zavora(); return Promise.reject(new Error("Agenda se otevírá jen z DATEC Portálu.")); }
    init = Object.assign({}, init || {});
    var h = new Headers(init.headers || (typeof vstup !== "string" && vstup.headers) || {});
    h.set("x-portal-token", token); init.headers = h;
    return puvodni(vstup, init).then(function (r) {
      if (r.status === 401 || r.status === 403) r.clone().json().then(function (j) { zavora(j && j.error); }, function () { zavora(); });
      return r;
    });
  };
  window.DATEC_PORTAL = { maVstupenku: function () { return !!token; }, zavora: zavora };
  if (!token) zavora();
})();
