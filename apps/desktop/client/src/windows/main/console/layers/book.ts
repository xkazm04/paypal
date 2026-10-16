// Area: book (rebuild WP3b). The Book layer: every payment, and plain-language questions about it
// (console/areas/book/BookLayer.tsx). Its views are registered here, so the crumbs and Escape know
// them before the layer's chunk loads. Styles: console/areas/book.css; words: lib/words/book.ts.
import { lazyPart } from '../../../../lib/lazy';
import { BOOK_VIEWS_TITLE } from '../../../../lib/words';
import { MODULE } from '../../../../shared/modules';
import { ModuleCrumb } from '../crumbs';
import { defineLayer, type LayerProps } from '../layers';
import { defineModuleViews } from '../ModuleSummary';
import '../areas/book.css';

export const BOOK_VIEWS = defineModuleViews('book', BOOK_VIEWS_TITLE);

export const layers = [
  defineLayer({
    id: 'book',
    title: () => MODULE.book.name,
    Crumb: ModuleCrumb,
    component: lazyPart<LayerProps>(() => import('../areas/book/BookLayer').then((m) => m.BookLayer)),
  }),
];
