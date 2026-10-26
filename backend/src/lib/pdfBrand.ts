// Blue Duck Pest Control branding for the PDFs: the brand colors and typefaces.
// The brand's own display fonts (Country Blues, Ronsard Crystal) are paid, so the
// guidelines' free alternates are used: Barlow, Krona One and Red Hat Text.
import { Font } from "@react-pdf/renderer";
import fs from "node:fs";
import path from "node:path";

function findAssets(): string {
  const candidates = [
    path.join(process.cwd(), "assets"),
    path.join(process.cwd(), "backend", "assets"),
    path.resolve(__dirname, "../../assets"),
  ];
  return candidates.find((c) => fs.existsSync(path.join(c, "fonts"))) ?? candidates[0];
}

export const ASSETS_DIR = findAssets();
export const LOGO_PATH = path.join(ASSETS_DIR, "blue-duck-logo.png");

export const BRAND = {
  navy: "#002255",
  deepBlue: "#003969",
  blue: "#0079FF",
  sky: "#26A5FF",
  teal: "#007A66",
  lime: "#77C242",
  orange: "#E67300",
  yellow: "#FFC20D",
  paleYellow: "#FFF3A3",
  // tints of the navy for text, rules and fills
  textMuted: "#51668A",
  rule: "#D9E3F0",
  fill: "#E6F1FF",
};

let registered = false;
export function registerBrandFonts() {
  if (registered) return;
  registered = true;
  const f = (name: string) => path.join(ASSETS_DIR, "fonts", name);
  Font.register({
    family: "Red Hat Text",
    fonts: [
      { src: f("RedHatText-400.ttf"), fontWeight: 400 },
      { src: f("RedHatText-700.ttf"), fontWeight: 700 },
    ],
  });
  Font.register({
    family: "Barlow",
    fonts: [
      { src: f("Barlow-600.ttf"), fontWeight: 600 },
      { src: f("Barlow-700.ttf"), fontWeight: 700 },
      { src: f("Barlow-800.ttf"), fontWeight: 800 },
    ],
  });
  Font.register({ family: "Krona One", src: f("KronaOne-400.ttf") });
  // No automatic hyphenation: keeps words (and email addresses) whole.
  Font.registerHyphenationCallback((word) => [word]);
}
