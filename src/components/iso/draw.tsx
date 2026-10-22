// From the Anatomy kit (github.com/wheresryan22/anatomy, kit/react/draw.tsx), MIT licence: see ./LICENSE. Server-safe
// React component: the framed Plate, without its legend keys. The rest is left out: the anchor figure is drawn as one
// SVG document (src/components/landing/anchor-figure-svg.ts), not as React elements.
import * as React from "react";

interface PlateProps {
  fig: string;
  title?: string;
  hint?: React.ReactNode;
  readout?: React.ReactNode;
  caption?: React.ReactNode;
  children: React.ReactNode;
}

export function Plate({ fig, title, hint, readout, caption, children }: PlateProps) {
  return (
    <figure className="iso-figure">
      <div className="iso-plate">
        <div className="iso-plate-corners" aria-hidden="true">
          <span className="iso-plate-corner" data-corner="fig">
            {fig}
          </span>
          {title ? (
            <span className="iso-plate-corner" data-corner="title">
              {title}
            </span>
          ) : null}
          {hint ? (
            <span className="iso-plate-corner" data-corner="hint">
              {hint}
            </span>
          ) : null}
          <span className="iso-plate-corner" data-corner="readout" data-readout="">
            {readout}
          </span>
        </div>
        {children}
      </div>
      {caption ? (
        <figcaption className="iso-legend">
          <span className="iso-caption">{caption}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
