# Accessibility Improvements

## Current State

The web UI uses semantic HTML in some places but lacks comprehensive accessibility:
- No ARIA labels on interactive elements
- No skip navigation link
- Focus indicators may be missing or inconsistent
- Icon-only buttons lack accessible names
- Color alone is used for some status indicators

## Problem

- Screen reader users cannot navigate effectively
- Keyboard-only users may get trapped or lose focus
- Color-blind users may miss status indicators
- No WCAG AA compliance verification
- International users need proper RTL/localization support (future)

## What to Implement

### 1. Keyboard Navigation
- **Tab order**: All interactive elements reachable via Tab
- **Focus indicators**: Visible focus ring on all focusable elements (using `:focus-visible`)
- **Skip link**: "Skip to main content" link at top of page
- **Keyboard shortcuts**: Already started (Ctrl+S) — extend to more actions
- **Trap focus**: In modals and dialogs, Tab cycles within the dialog

### 2. Screen Reader Support
- **ARIA labels**: Add `aria-label` to all icon-only buttons (theme toggle, close buttons, etc.)
- **ARIA roles**: Ensure correct roles on navigation, main content, dialogs
- **Live regions**: Use `aria-live="polite"` for status updates (agent started/stopped)
- **Semantic HTML**: Replace `<div>` with `<nav>`, `<main>`, `<section>`, `<article>` where appropriate
- **Alt text**: Add descriptive alt text to all images and icons

### 3. Color & Contrast
- **WCAG AA compliance**: Ensure 4.5:1 contrast ratio for text
- **Don't rely on color alone**: Add icons or text alongside color indicators
  - Status: green dot + "Running" text
  - Errors: red icon + error text
  - Warnings: orange triangle icon + warning text
- **High contrast mode**: Optional enhanced contrast setting

### 4. Responsive Focus Management
- After modal close: return focus to trigger element
- After page navigation: set focus to page title or main content
- After form submit: focus on result/feedback message

### Implementation Steps

1. Audit all interactive elements for ARIA labels
2. Add `<a href="#main" class="skip-link">Skip to content</a>` to Shell
3. Add `:focus-visible` styles to all interactive elements in CSS
4. Replace div-based layouts with semantic HTML elements
5. Add `aria-live` regions for status updates
6. Add icon + text labels to all color-coded status indicators
7. Test with screen reader (VoiceOver/NVDA)
8. Verify contrast ratios with browser DevTools

### Files to Modify
- `web/src/components/Shell.tsx` — add skip link
- `web/src/components/Layout.tsx` — semantic nav, ARIA labels
- `web/src/index.css` — focus styles, skip link styles
- `web/src/pages/*.tsx` — semantic elements, ARIA labels
- `web/src/components/*.tsx` — ARIA labels on interactive elements

### Notes
- Medium complexity — spread across many files but each change is small
- Can be done incrementally page by page
- Use Lighthouse accessibility audit to track progress
- WCAG AA is the target (not AAA — AAA is extremely strict)
- Consider adding an accessibility statement page
