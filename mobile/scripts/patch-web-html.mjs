// Runs after `expo export --platform web`: makes the exported page
// installable and phone-friendly. Expo's generated index.html has no way to
// add these tags, so they're inserted here.
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../dist/index.html", import.meta.url);
let html = readFileSync(file, "utf8");

html = html.replace(
  /<meta name="viewport"[^>]*>/,
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />'
);

const head = `
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#1F7A5C" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="PestApp" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <style id="pestapp-phone">
      /* dvh keeps the bottom tab bar above a phone browser's own toolbar */
      html, body { height: 100%; height: 100dvh; }
      #root { height: 100%; height: 100dvh; }
      body { overscroll-behavior: none; -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    </style>
    <script>
      if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
      }
    </script>
`;
if (!html.includes('rel="manifest"')) html = html.replace("</head>", `${head}  </head>`);
writeFileSync(file, html);
console.log("patched dist/index.html for phone install + offline");
