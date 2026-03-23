# Dark Mode Best Practices

> Guidelines for ensuring UI components work in both light and dark themes.

---

## 🎨 Core Principle

**NEVER use hardcoded colors like `bg-white`, `bg-gray-200`, `text-slate-500`, etc.**

Always use semantic design tokens that automatically adapt to the current theme.

---

## ✅ Use Semantic Design Tokens

Use these Tailwind CSS classes that reference CSS variables defined in `globals.css`:

| Purpose | Light-mode hardcoded ❌ | Dark-mode compatible ✅ |
|---------|------------------------|------------------------|
| Background | `bg-white` | `bg-background` or `bg-card` |
| Surface/Card | `bg-gray-50`, `bg-slate-100` | `bg-muted` or `bg-card` |
| Text (primary) | `text-black`, `text-slate-900` | `text-foreground` |
| Text (secondary) | `text-gray-500`, `text-slate-600` | `text-muted-foreground` |
| Border | `border-gray-200` | `border` (uses `--border` variable) |
| Hover state | `hover:bg-gray-100` | `hover:bg-accent` |
| Primary accent | `bg-indigo-500`, `text-indigo-600` | `bg-primary`, `text-primary` |
| Primary on bg | `bg-indigo-100` | `bg-primary/10` |
| Divider | `divide-slate-100` | `divide-border` |

---

## 🎯 Available Design Tokens

These tokens are defined in `apps/web/app/globals.css` with both light and dark values:

### Backgrounds & Surfaces
- `bg-background` — Main page background
- `bg-card` — Card/elevated surfaces
- `bg-popover` — Popover/dropdown backgrounds
- `bg-muted` — Muted/subtle backgrounds
- `bg-accent` — Interactive highlight backgrounds
- `bg-sidebar` — Sidebar-specific background

### Text Colors
- `text-foreground` — Primary text
- `text-card-foreground` — Text on cards
- `text-muted-foreground` — Secondary/helper text
- `text-accent-foreground` — Text on accent backgrounds
- `text-primary` — Primary brand color text
- `text-primary-foreground` — Text on primary backgrounds
- `text-destructive` — Error/danger text

### Interactive States
- `hover:bg-accent` — Hover backgrounds
- `hover:text-accent-foreground` — Hover text
- `focus:ring-ring` — Focus ring color

### Borders
- `border` — Default border (uses `border-border` internally)
- `border-input` — Form input borders
- `divide-border` — List dividers

---

## 🖌️ Status Colors with Dark Mode

For status-specific colors (success, warning, error, info), use the `dark:` prefix:

```tsx
// ✅ correct — adapts to dark mode
className="bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400"

// ❌ wrong — invisible in dark mode
className="bg-emerald-100 text-emerald-600"
```

Common pattern for status badges/icons:
```tsx
const STATUS_CONFIG = {
  success: { bg: 'bg-emerald-100 dark:bg-emerald-900/50', text: 'text-emerald-600 dark:text-emerald-400' },
  warning: { bg: 'bg-amber-100 dark:bg-amber-900/50', text: 'text-amber-600 dark:text-amber-400' },
  error: { bg: 'bg-red-100 dark:bg-red-900/50', text: 'text-red-500 dark:text-red-400' },
  info: { bg: 'bg-blue-100 dark:bg-blue-900/50', text: 'text-blue-600 dark:text-blue-400' },
};
```

---

## 🚫 Common Mistakes

| Mistake | Fix |
|---------|-----|
| `bg-white` | `bg-background` or `bg-card` |
| `bg-gray-50`, `bg-slate-50` | `bg-muted` |
| `text-gray-900`, `text-slate-900` | `text-foreground` |
| `text-gray-500`, `text-slate-500` | `text-muted-foreground` |
| `hover:bg-gray-100` | `hover:bg-accent` |
| `border-gray-200` | Remove color (just `border`) |
| `divide-gray-100` | `divide-border` |
| `bg-indigo-50` for highlights | `bg-primary/5` or `bg-primary/10` |

---

## 🔍 Testing Dark Mode

1. **System preference**: Set your OS to dark mode
2. **Dev tools**: In Chrome DevTools, use "Rendering" > "Emulate CSS media feature prefers-color-scheme"
3. **Manual toggle**: If a theme toggle is added, test both states

---

## 📋 Checklist for New Components

Before submitting a PR, verify:

- [ ] No hardcoded white/gray backgrounds (`bg-white`, `bg-gray-*`, `bg-slate-*`)
- [ ] No hardcoded text colors (`text-black`, `text-gray-*`, `text-slate-*`)
- [ ] Status colors have `dark:` variants
- [ ] Borders use semantic `border` class (not `border-gray-*`)
- [ ] Dividers use `divide-border`
- [ ] Hover states use `hover:bg-accent`
- [ ] Component is readable in both light and dark themes

---

## 🔗 Related Files

- `apps/web/app/globals.css` — CSS variable definitions for light/dark themes
- `apps/web/tailwind.config.ts` — Tailwind configuration with `darkMode: ["class", "media"]`
