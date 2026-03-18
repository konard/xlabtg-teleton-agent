# Responsive & Mobile Design

## Current State

The web UI has a fixed sidebar layout (`Layout.tsx`) designed for desktop screens. The CSS uses fixed widths and doesn't include mobile breakpoints. The sidebar is always visible.

## Problem

- UI is unusable on mobile devices (sidebar takes too much space)
- No responsive breakpoints
- Tables and lists don't adapt to narrow screens
- Touch targets may be too small for mobile
- No PWA support for mobile home screen installation

## What to Implement

### 1. Responsive Sidebar
- **Desktop (>1024px)**: Full sidebar (current behavior)
- **Tablet (768-1024px)**: Collapsed sidebar (icons only), expand on hover
- **Mobile (<768px)**: Hidden sidebar, hamburger menu to open as overlay
- **Component changes**: Add breakpoint detection and toggle logic to `Layout.tsx`

### 2. Responsive Content Layout
- **Tables**: Horizontal scroll on narrow screens, or convert to card layout
- **Forms**: Stack fields vertically on mobile
- **Stat cards**: 2-column grid on tablet, 1-column on mobile (currently 4-column)
- **Modals**: Full-screen on mobile, centered on desktop

### 3. CSS Breakpoints
```css
/* Add to index.css */
:root {
  --breakpoint-sm: 640px;
  --breakpoint-md: 768px;
  --breakpoint-lg: 1024px;
  --breakpoint-xl: 1280px;
}

@media (max-width: 768px) {
  .sidebar { /* hidden, hamburger menu */ }
  .main-content { /* full width */ }
  .stat-grid { /* 1 column */ }
}
```

### 4. Touch Optimization
- **Minimum touch target**: 44x44px (Apple guideline)
- **Spacing**: Increase spacing between interactive elements on mobile
- **Swipe gestures**: Swipe right to open sidebar, swipe left to close
- **No hover-dependent UI**: All hover-revealed content accessible without hover

### 5. PWA Support (Optional)
- Add `manifest.json` for home screen installation
- Add service worker for offline support
- Add meta tags for mobile web app
- Custom splash screen and app icon

### Implementation Steps

1. Add CSS media queries to `index.css` for all breakpoints
2. Add hamburger menu button to Layout header (mobile only)
3. Add sidebar overlay mode for mobile
4. Make stat card grids responsive
5. Add horizontal scroll to tables on mobile
6. Increase touch targets for all buttons/links
7. Test on various screen sizes using browser DevTools
8. (Optional) Add PWA manifest and service worker

### Files to Modify
- `web/src/index.css` — add all responsive styles
- `web/src/components/Layout.tsx` — hamburger menu, responsive sidebar
- `web/src/components/Shell.tsx` — responsive layout wrapper
- `web/src/pages/Dashboard.tsx` — responsive stat grid
- `web/src/pages/Tools.tsx` — responsive tool list
- `web/src/pages/*.tsx` — responsive adjustments per page

### Notes
- Medium complexity — CSS-heavy but spread across many files
- Test on real mobile devices, not just browser emulation
- Start with sidebar responsiveness (highest impact)
- PWA is a separate, additive effort
- Consider using CSS Container Queries for component-level responsiveness
