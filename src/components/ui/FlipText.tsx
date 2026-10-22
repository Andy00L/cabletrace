import type { CSSProperties, ReactNode } from "react";

type FlipTextProps = {
  /** The heading's text; each letter flips on its own when the pointer passes over it. */
  text: string;
  as?: "h1" | "h2" | "span";
  id?: string;
  className?: string;
  /** The landing's scroll rise (src/components/landing/LandingMotion.tsx): "ready" with its order in `style`. */
  rise?: "ready";
  style?: CSSProperties;
};

/**
 * Text whose letters flip and rise on hover, after ObsidianUI's Flip Text (MIT, obsidianui.dev/docs/flip-text), done in
 * CSS instead of motion, so it ships no script (the `flip-glyph` rules in src/app/globals.css). The element keeps the
 * whole text as its accessible name, and its letters (hidden from assistive technology) still read as the plain text,
 * so a test or a copy reads "Every cable cut, replayed." once. Words never break inside.
 */
export function FlipText({ text, as: Element = "span", id, className = "", rise, style }: FlipTextProps) {
  const words = text.split(" ");
  const children: ReactNode[] = [];
  words.forEach((word, wordIndex) => {
    if (wordIndex > 0) children.push(" ");
    children.push(
      <span key={`${word}-${wordIndex}`} className="inline-block whitespace-nowrap" aria-hidden="true">
        {[...word].map((letter, letterIndex) => (
          <span key={letterIndex} className="flip-glyph">
            {letter}
          </span>
        ))}
      </span>,
    );
  });
  return (
    <Element id={id} aria-label={text} className={className} data-rise={rise} style={style}>
      {children}
    </Element>
  );
}
