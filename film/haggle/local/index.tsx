// The Table's bespoke film heroes for the haggle pilot, injected into the demo-film kit as @film/local.
// Importing fonts.ts registers the brand faces (Archivo, Sofia Sans) before any frame renders.
import type { ComponentMap } from '@film/kit';
import '../../shared/fonts.ts';
import { PriceCorridor } from '../../shared/PriceCorridor.tsx';
import { PreviewTag } from '../../shared/PreviewTag.tsx';

export const components: ComponentMap = { PriceCorridor, PreviewTag };
