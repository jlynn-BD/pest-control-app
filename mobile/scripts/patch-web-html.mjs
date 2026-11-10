// Runs after `expo export --platform web`: makes the exported page
// installable and phone-friendly. Expo's generated index.html has no way to
// add these tags, so they're inserted here.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// Brand fonts (Red Hat Text, Barlow, Krona One - see public/fonts), declared inline
// so they load with the page and are cached for offline use with the rest of the app.
const fontsCssFile = new URL("../public/fonts/fonts.css", import.meta.url);
const fontFaces = existsSync(fontsCssFile) ? readFileSync(fontsCssFile, "utf8") : "";

const file = new URL("../dist/index.html", import.meta.url);
let html = readFileSync(file, "utf8");

html = html.replace(
  /<meta name="viewport"[^>]*>/,
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />'
);

const head = `
    <link rel="manifest" href="/manifest.json" />
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
    <meta name="theme-color" content="#002255" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="PestApp" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="preload" href="/fonts/RedHatText-400-700.woff2" as="font" type="font/woff2" crossorigin />
    <style id="pestapp-fonts">
${fontFaces}
      html, body, #root { font-family: 'Red Hat Text', system-ui, -apple-system, 'Segoe UI', sans-serif; background-color: #F3F7FC; }
      input, textarea, button, select { font-family: inherit; }
    </style>
    <style id="pestapp-phone">
      /* Pin the app to the actual window. 100dvh was taller than the visible area on some Android phones (it counted the system bars), which pushed the bottom bar under the phone's own buttons; top/bottom 0 always matches what is really on screen. */
      html { height: 100%; overflow: hidden; }
      body { position: fixed; top: 0; right: 0; bottom: 0; left: 0; height: auto; width: 100%; }
      #root { position: absolute; top: 0; right: 0; bottom: 0; left: 0; height: auto; }
      body { overscroll-behavior: none; -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      /* Long-presses and drags on the site map were selecting text (blue handles + Copy / Look Up menu) - it's an app, not a page, so nothing but form fields is selectable. */
      * { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
      input, textarea, [contenteditable="true"] { -webkit-user-select: text; user-select: text; }
    </style>
    <script>
      /* Open the app address with ?debug=1 to show the screen measurements on top of the page (for diagnosing layout problems on a particular phone). */
      if (/[?&]debug=1/.test(location.search)) {
        window.addEventListener("load", function () {
          var probe = document.createElement("div");
          probe.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
          document.body.appendChild(probe);
          function show() {
            var cs = getComputedStyle(probe);
            var vv = window.visualViewport;
            el.textContent = ["inner " + innerWidth + "x" + innerHeight, "visual " + (vv ? Math.round(vv.width) + "x" + Math.round(vv.height) : "n/a"), "screen " + screen.width + "x" + screen.height + " avail " + screen.availWidth + "x" + screen.availHeight, "outer " + outerWidth + "x" + outerHeight, "dpr " + devicePixelRatio, "insets t" + cs.paddingTop + " r" + cs.paddingRight + " b" + cs.paddingBottom + " l" + cs.paddingLeft, "standalone " + (matchMedia("(display-mode: standalone)").matches || navigator.standalone === true), "root " + Math.round(document.getElementById("root").getBoundingClientRect().height)].join("\\n");
          }
          var el = document.createElement("pre");
          el.style.cssText = "position:fixed;left:6px;bottom:90px;z-index:99999;margin:0;padding:6px;background:rgba(0,0,0,.8);color:#7CFC00;font:11px/1.3 monospace;pointer-events:none;border-radius:6px";
          document.body.appendChild(el);
          show();
          window.addEventListener("resize", show);
          setInterval(show, 1500);
        });
      }
      if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
      }
    </script>
`;
if (!html.includes('rel="manifest"')) html = html.replace("</head>", `${head}  </head>`);
writeFileSync(file, html);
console.log("patched dist/index.html for phone install + offline");
