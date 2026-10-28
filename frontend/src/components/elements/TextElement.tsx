import React from 'react';
import { DesignElement, displayValue } from '../../types';
import { getZplFont } from '../../utils/zplFonts';
import { splitVariables } from '../../utils/variables';

interface Props { element: DesignElement; scale: number; }

const JUSTIFY_TO_CSS = { L: 'left', C: 'center', R: 'right', J: 'justify' } as const;

// {{name}} placeholders get a light tint so they stand out from the fixed text;
// the tint does not change the text size or position.
function withVariables(text: string) {
  return splitVariables(text).map((part, i) =>
    part.variable
      ? <span key={i} style={{ background: 'rgba(59, 130, 246, 0.22)', borderRadius: 2 }}>{part.text}</span>
      : <React.Fragment key={i}>{part.text}</React.Fragment>
  );
}

export function TextElement({ element, scale }: Props) {
  const fontSize = (element.fontSize ?? 30) * scale;
  const reversed = element.reversed ?? false;
  const font = getZplFont(element.fontName);
  // ^A width narrower/wider than the height: stretch the glyphs horizontally
  const widthRatio = element.fontWidth && element.fontSize ? element.fontWidth / element.fontSize : 1;
  const text = displayValue(element) || 'Text';

  const boxStyle: React.CSSProperties = {
    width: element.width * scale,
    height: element.height * scale,
    fontFamily: font.cssFamily,
    fontSize: Math.max(8, fontSize),
    fontWeight: font.fontWeight,
    textTransform: font.textTransform,
    overflow: 'hidden',
    userSelect: 'none',
    background: reversed ? 'black' : 'transparent',
    color: reversed ? 'white' : 'black',
  };

  if (element.block) {
    // ^FB: lines split on \& and aligned inside the block. The block is laid out at
    // width / widthRatio and scaled back, so wrapping and alignment follow the glyph width.
    const { maxLines, lineSpacing, justify, hangingIndent } = element.block;
    const lines = text.split('\\&');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return (
      <div style={boxStyle}>
        <div
          style={{
            width: (element.width * scale) / widthRatio,
            transform: `scaleX(${widthRatio})`,
            transformOrigin: 'left top',
            textAlign: JUSTIFY_TO_CSS[justify],
            lineHeight: `${(element.fontSize ?? 30) * scale + lineSpacing * scale}px`,
            paddingLeft: hangingIndent * scale,
            textIndent: -hangingIndent * scale,
          }}
        >
          {lines.slice(0, maxLines).map((line, i) => (
            <div key={i}>{line ? withVariables(line) : ' '}</div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...boxStyle, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
      <span style={{ display: 'inline-block', transform: `scaleX(${widthRatio})`, transformOrigin: 'left center' }}>
        {withVariables(text)}
      </span>
    </div>
  );
}
