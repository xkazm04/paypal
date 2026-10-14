// src/shared/ui - the v2 baseline as React (see README.md). Styles: src/design/ui.css.
export * from './components';
export { Sheet, type SheetProps, type SheetSize } from './Sheet';
export { Popover, type PopoverProps } from './Popover';
export { Inspector, InspectorHostProvider, Split, useInspectorHost, type InspectorProps } from './Inspector';
export { closeTopLayer, layerCount, pushLayer, topLayerKind, useLayer, useLayerCount, type LayerKind } from './layers';
export { focusLost, modalFocusTarget, shouldRescue, trapTab, useFocusOnMount, useFocusRescue, useModalFocus, useReturnFocus } from './focus';
export { ToastProvider, useToast, TOAST_MS, type PushToast, type ToastTone } from './toast';
export { ThemeSwitch } from './ThemeSwitch';
export * from './story';
export * from './experiments';
export { HoldButton, type HoldButtonProps } from './hold';
export { Why } from './why';
export { SummaryCard, type SummaryCardProps } from './SummaryCard';
export { Disclosure } from './Disclosure';
export { ChromeBackContext, DetailPage, type DetailPageProps } from './DetailPage';
export { Stepper, type StepperStep } from './Stepper';
// Calibre console kit (rebuild WP1a; styles in design/kit.css)
export { Stack, pileCount, TabStrip, ModuleTab, nextTab, FilterChips, toggleFilter, Facts, ListShell, Depth, shownCount, UNKNOWN,
  type StackProps, type ModuleTabProps, type FilterOption, type Fact, type FactTone, type ListShellProps } from './console';
export { HoldGesture, holdPhaseWord, shownProgress, type HoldGestureProps, type HoldPhase } from './HoldGesture';
export { Presence, type PresenceProps } from './Presence';
