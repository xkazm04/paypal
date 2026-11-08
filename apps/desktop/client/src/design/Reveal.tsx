// The one render-in primitive for content pages (framer-motion, named motion from design/motion.ts).
// A page wraps its blocks in <RevealGroup> and each block in <Reveal>; blocks arrive in a short,
// orderly fade-and-rise, top to bottom. Calm motion (OS setting or in-app switch) and the test
// environment render everything at once with no animation, so existing tests and the stagger
// scheduler (console/stagger.tsx, which decides WHEN a part mounts) are untouched: this only decides
// how a part that has mounted APPEARS. Display only; opacity + transform, so nothing reflows.
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { createContext, useContext, type ReactNode } from 'react';
import { DUR, EASE, useCalm } from './motion';

/** Distance (px) a block rises while it fades in. */
export const REVEAL_RISE = 10;
/** Gap (ms) between consecutive blocks of a group. */
export const REVEAL_STEP_MS = 45;
/** A group never delays its last block past this (ms), however long the page. */
export const REVEAL_CAP_MS = 360;

const inTest = import.meta.env.MODE === 'test';

const GroupCtx = createContext(false);

function variants(calm: boolean): Variants {
  return calm
    ? { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0, transition: { duration: 0 } } }
    : {
      hidden: { opacity: 0, y: REVEAL_RISE },
      show: { opacity: 1, y: 0, transition: { duration: DUR.slow / 1000, ease: [...EASE.out] } },
    };
}

type GroupProps = Omit<HTMLMotionProps<'div'>, 'variants' | 'initial' | 'animate'> & { children: ReactNode; step?: number };

/** Parent of a page's blocks: staggers its <Reveal> children. Renders a plain div under calm/test. */
export function RevealGroup({ children, step = REVEAL_STEP_MS, ...rest }: GroupProps) {
  const calm = useCalm();
  if (calm || inTest) return <GroupCtx.Provider value><motion.div {...rest}>{children}</motion.div></GroupCtx.Provider>;
  const s = Math.min(step, REVEAL_CAP_MS / 8) / 1000;
  return (
    <GroupCtx.Provider value>
      <motion.div {...rest} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: s, delayChildren: 0.02 } } }}>
        {children}
      </motion.div>
    </GroupCtx.Provider>
  );
}

type RevealProps = Omit<HTMLMotionProps<'div'>, 'variants' | 'initial' | 'animate'> & { children: ReactNode };

/** One block. Inside a <RevealGroup> it takes its turn; alone it reveals on mount. */
export function Reveal({ children, ...rest }: RevealProps) {
  const calm = useCalm();
  const inGroup = useContext(GroupCtx);
  if (calm || inTest) return <motion.div {...rest}>{children}</motion.div>;
  const v = variants(false);
  return inGroup
    ? <motion.div {...rest} variants={v}>{children}</motion.div>
    : <motion.div {...rest} variants={v} initial="hidden" animate="show">{children}</motion.div>;
}
