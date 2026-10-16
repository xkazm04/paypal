// The ground texture: a hairline graticule (CSS gradients only, no images). 'polar' adds rings and
// spokes centred on (x, y), where the seal sits; 'grid' is plain chart paper. Ornamental: aria-hidden,
// pointer-events none. Put it first inside a positioned container (it fills it).
import type { CSSProperties } from 'react';
import './brand.css';

export type GraticuleProps = {
  variant?: 'polar' | 'grid';
  /** Centre of the polar rings, as CSS lengths or percentages. Default 72% 50%. */
  x?: string;
  y?: string;
  /** Cover the whole viewport (fixed) instead of the nearest positioned parent. */
  fixed?: boolean;
  className?: string;
};

export function Graticule({ variant = 'polar', x = '72%', y = '50%', fixed, className }: GraticuleProps) {
  const style = { '--gx': x, '--gy': y } as CSSProperties;
  return <div className={`br-ground${fixed ? ' fixed' : ''}${className ? ` ${className}` : ''}`} data-variant={variant} style={style} aria-hidden="true" />;
}
