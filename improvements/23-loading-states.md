# Loading States & Skeleton Screens

## Current State

Pages show empty or partially rendered content while data loads. Some pages have basic loading text, but there are no skeleton screens or consistent loading patterns.

Buttons remain active during API calls, allowing double-submissions.

## Problem

- Flash of empty content when navigating between pages
- Users don't know if the page is loading or empty
- Buttons can be clicked multiple times during slow API calls
- No progress indicators for long operations
- Inconsistent loading experience across pages

## What to Implement

### 1. Skeleton Screens
- **Component**: `<Skeleton />` — renders a pulsing placeholder matching the shape of content
- **Variants**: `<SkeletonText />`, `<SkeletonCard />`, `<SkeletonTable />`
- **Usage**: Each page shows skeleton while initial data loads
- **Example**: Dashboard stat cards show grey pulsing rectangles before numbers load

### 2. Button Loading States
- **Pattern**: When a button triggers an API call:
  1. Button shows spinner icon
  2. Button text changes (e.g., "Save" → "Saving...")
  3. Button is disabled (prevents double-click)
  4. On complete: restores original state
- **Component**: `<LoadingButton />` wrapper or add `loading` prop to existing buttons

### 3. Progress Bars
- **Component**: `<ProgressBar />` for operations with known progress
- **Use cases**: File upload in Workspace, bulk tool operations
- **Style**: Thin bar at top of section, themed color

### 4. Page-level Loading
- **Component**: `<PageLoader />` — full-page centered spinner for initial route loads
- **Usage**: Wrap page content with loading check

### Implementation Steps

1. Create `<Skeleton />` base component with pulse animation
2. Create skeleton variants for text, cards, tables
3. Add skeleton screens to Dashboard, Tools, Plugins, Memory pages
4. Create `<LoadingButton />` component
5. Replace all action buttons with LoadingButton pattern
6. Create `<ProgressBar />` component
7. Add CSS animations (pulse, spin) to index.css

### Files to Create
- `web/src/components/Skeleton.tsx` — skeleton components
- `web/src/components/LoadingButton.tsx` — button with loading state

### Files to Modify
- `web/src/pages/*.tsx` — add skeleton screens
- `web/src/index.css` — skeleton and loading animations
- Various components — replace buttons with LoadingButton

### Notes
- Low complexity — mostly CSS + simple state management
- Skeleton shapes should roughly match actual content layout
- Pulse animation: CSS `@keyframes pulse { 0%, 100% { opacity: 0.4 } 50% { opacity: 0.8 } }`
- Consider using `React.Suspense` with `lazy()` for route-level loading
