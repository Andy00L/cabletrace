"use client";

import { useEffect, useRef } from "react";
import { buildAsciiGrid, parseHexColour, shiftGlyph, type AsciiCell, type GlyphRampName, type Rgb } from "@/lib/ascii/ascii-grid";

/** The palette tokens a glyph layer can be toned toward or laid on (src/app/globals.css, @theme). */
export type AsciiTone = "page" | "card" | "ink" | "slate" | "slate-raised" | "mist" | "dusk";

type AsciiPictureProps = {
  /** A picture on this site (a canvas cannot read another origin's pixels), ideally its smallest width. */
  src: string;
  /** The part of the picture to draw, as fractions: left, top, width, height. */
  region?: readonly [number, number, number, number];
  /** The cell's width in CSS px; a line is 1.5 cells tall. */
  cellPx: number;
  ramp: GlyphRampName;
  /** True on a light ground, so dark patches carry the glyphs. */
  isInverted?: boolean;
  tone?: AsciiTone | null;
  toneShare?: number;
  /** Fills the canvas first; null leaves it see-through. */
  background?: AsciiTone | null;
  /** The last share of the rows thins out toward `fadeTo`, so the glyphs end in the page. */
  fadeShare?: number;
  fadeTo?: AsciiTone;
  /** A few glyphs step along the ramp and back while the picture is on screen (never under reduced motion). */
  isShimmering?: boolean;
  className?: string;
};

// The canvas draws at most at this device pixel ratio: glyphs of 6 to 10 px gain nothing past it.
const MAX_PIXEL_RATIO = 2;
// A line is this many cells tall, and the font size is this many cell widths (a monospace glyph is about 0.6 em wide,
// so it fills about 0.87 of its cell).
const LINE_HEIGHT_CELLS = 1.5;
const FONT_SIZE_CELLS = 1.45;
// The shimmer: every SHIMMER_INTERVAL_MS this share of the drawn glyphs steps one place on the ramp, then steps back
// on the next tick (about 7 changes a second; slow enough to read as the sea breathing, not as noise).
const SHIMMER_INTERVAL_MS = 140;
const SHIMMER_SHARE = 0.012;

function readToneRgb(element: HTMLElement, tone: AsciiTone): Rgb | null {
  return parseHexColour(getComputedStyle(element).getPropertyValue(`--color-${tone}`).trim());
}

function toCssColour(rgb: Rgb): string {
  return `rgb(${Math.round(rgb[0])} ${Math.round(rgb[1])} ${Math.round(rgb[2])})`;
}

/**
 * A picture redrawn as glyphs on a canvas, each glyph in the colour of the patch it replaces (the ASCII layer, after
 * ascii-magic.com; docs/UI_DESIGN_SYSTEM.md). Decorative: hidden from assistive technology, so the page's own picture
 * or text carries the meaning. It redraws when its box changes size and shimmers only while on screen.
 */
export function AsciiPicture({ src, region = [0, 0, 1, 1], cellPx, ramp, isInverted = false, tone = null, toneShare = 0, background = null, fadeShare = 0, fadeTo = "page", isShimmering = false, className = "" }: AsciiPictureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [regionLeft, regionTop, regionWidth, regionHeight] = region;

  // Syncs with the image loader, ResizeObserver, IntersectionObserver, matchMedia and a timer, none of which React
  // owns: loads the picture once, draws the grid at the canvas's size, and runs the shimmer while it is on screen.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = new Image();
    image.decoding = "async";
    let cells: (AsciiCell | null)[] = [];
    let columns = 0;
    let lineHeight = cellPx * LINE_HEIGHT_CELLS;
    let backgroundColour: string | null = null;
    let shimmerTimer = 0;
    let shiftedCellIndexes: number[] = [];
    let isOnScreen = false;
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const drawCell = (cellIndex: number, glyph: string) => {
      const cell = cells[cellIndex];
      if (!cell) return;
      const x = (cellIndex % columns) * cellPx;
      const y = Math.floor(cellIndex / columns) * lineHeight;
      if (backgroundColour) {
        context.fillStyle = backgroundColour;
        context.fillRect(x, y, cellPx, lineHeight);
      } else {
        context.clearRect(x, y, cellPx, lineHeight);
      }
      context.fillStyle = toCssColour(cell.rgb);
      context.fillText(glyph, x, y);
    };

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0 || !image.complete || image.naturalWidth === 0) return;
      const pixelRatio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      columns = Math.max(1, Math.floor(width / cellPx));
      lineHeight = cellPx * LINE_HEIGHT_CELLS;
      const rows = Math.max(1, Math.floor(height / lineHeight));
      const sampler = document.createElement("canvas");
      sampler.width = columns;
      sampler.height = rows;
      const samplerContext = sampler.getContext("2d");
      if (!samplerContext) return;
      samplerContext.imageSmoothingQuality = "high";
      samplerContext.drawImage(image, regionLeft * image.naturalWidth, regionTop * image.naturalHeight, regionWidth * image.naturalWidth, regionHeight * image.naturalHeight, 0, 0, columns, rows);
      const toneRgb = tone ? readToneRgb(canvas, tone) : null;
      const groundRgb = readToneRgb(canvas, fadeTo) ?? [255, 255, 255];
      const backgroundRgb = background ? readToneRgb(canvas, background) : null;
      backgroundColour = backgroundRgb ? toCssColour(backgroundRgb) : null;
      cells = buildAsciiGrid({ pixels: samplerContext.getImageData(0, 0, columns, rows).data, columns, rows, ramp, isInverted, tone: toneRgb, toneShare, fadeShare, ground: groundRgb });
      shiftedCellIndexes = [];
      context.clearRect(0, 0, width, height);
      if (backgroundColour) {
        context.fillStyle = backgroundColour;
        context.fillRect(0, 0, width, height);
      }
      context.font = `500 ${cellPx * FONT_SIZE_CELLS}px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`;
      context.textBaseline = "top";
      cells.forEach((cell, cellIndex) => {
        if (cell) drawCell(cellIndex, cell.glyph);
      });
    };

    const shimmer = () => {
      shiftedCellIndexes.forEach((cellIndex) => drawCell(cellIndex, cells[cellIndex]?.glyph ?? " "));
      const drawnCount = cells.length;
      const pickCount = Math.ceil(drawnCount * SHIMMER_SHARE);
      shiftedCellIndexes = [];
      for (let pick = 0; pick < pickCount; pick += 1) {
        const cellIndex = Math.floor(Math.random() * drawnCount);
        const cell = cells[cellIndex];
        if (!cell) continue;
        shiftedCellIndexes.push(cellIndex);
        drawCell(cellIndex, shiftGlyph(cell.glyph, ramp, Math.random() < 0.5 ? 1 : -1));
      }
    };

    const updateShimmer = () => {
      window.clearInterval(shimmerTimer);
      if (isShimmering && isOnScreen && !reducedMotionQuery.matches) shimmerTimer = window.setInterval(shimmer, SHIMMER_INTERVAL_MS);
    };

    image.onload = draw;
    image.onerror = () => console.error(`[AsciiPicture] could not load ${src}`);
    image.src = src;
    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(canvas);
    const visibilityObserver = new IntersectionObserver((entries) => {
      isOnScreen = entries.some((entry) => entry.isIntersecting);
      updateShimmer();
    });
    visibilityObserver.observe(canvas);
    reducedMotionQuery.addEventListener("change", updateShimmer);
    return () => {
      window.clearInterval(shimmerTimer);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      reducedMotionQuery.removeEventListener("change", updateShimmer);
      image.onload = null;
      image.onerror = null;
    };
  }, [src, regionLeft, regionTop, regionWidth, regionHeight, cellPx, ramp, isInverted, tone, toneShare, background, fadeShare, fadeTo, isShimmering]);

  return <canvas ref={canvasRef} aria-hidden="true" className={`block ${className}`} />;
}
