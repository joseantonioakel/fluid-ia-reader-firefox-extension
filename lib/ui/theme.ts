export interface Theme {
  bg: string;
  fg: string;
  bar: string;
  border: string;
  hover: string;
  link: string;
  accent: string;
  dark: boolean;
  /** Fondo de los overlays: el color de la página con un 10 % de celeste. */
  overlayBg: string;
}

/** Celeste de referencia para teñir el fondo de los overlays. */
const CELESTE: readonly [number, number, number] = [135, 206, 235];
const TINT = 0.1;

/**
 * Mezcla un color con celeste al 10 %. Sobre un fondo blanco da un blanco
 * azulado; sobre uno negro, un negro azulado. El overlay sigue siendo opaco,
 * que es lo que permite que tape el texto original.
 */
export function tintWithCeleste(rgb: readonly [number, number, number], amount = TINT): string {
  const mixed = rgb.map((channel, i) =>
    Math.round(channel * (1 - amount) + CELESTE[i]! * amount),
  );
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

function parseRgb(value: string): [number, number, number] | null {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match?.[1]) return null;
  const parts = match[1].split(',').map((p) => Number.parseFloat(p.trim()));
  const [r, g, b, a] = parts;
  if (r === undefined || g === undefined || b === undefined) return null;
  if (a !== undefined && a === 0) return null; // transparente: no informa
  return [r, g, b];
}

/** Detecta si la página es oscura mirando el fondo efectivo de body/html. */
export function detectTheme(): Theme {
  let rgb: [number, number, number] | null = null;
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const bg = getComputedStyle(el).backgroundColor;
    const parsed = parseRgb(bg);
    if (parsed) {
      rgb = parsed;
      break;
    }
  }
  const pageBg = rgb ?? [255, 255, 255];
  const [r, g, b] = pageBg;
  // Luminancia relativa aproximada.
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const dark = luminance < 0.5;

  // El overlay parte del fondo REAL de la página, no de un blanco o negro fijo:
  // así encaja también en páginas de fondo crema o gris.
  const overlayBg = tintWithCeleste(pageBg);

  return dark
    ? {
        bg: '#16181d',
        fg: '#e7e9ee',
        bar: 'rgba(22,24,29,0.92)',
        border: '#333842',
        hover: '#232733',
        link: '#7fb4ff',
        accent: '#5b8cff',
        dark: true,
        overlayBg,
      }
    : {
        bg: '#ffffff',
        fg: '#1c1f26',
        bar: 'rgba(255,255,255,0.92)',
        border: '#dde1e8',
        hover: '#f2f4f8',
        link: '#1a5fd0',
        accent: '#2f6bff',
        dark: false,
        overlayBg,
      };
}
