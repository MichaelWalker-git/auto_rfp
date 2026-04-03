# Web UI Conventions

> UI component and styling rules for AutoRFP frontend.

---

## Component Library

- Use **Shadcn UI** components from `@/components/ui/` — never raw HTML `<button>`, `<input>`, `<select>`, etc.
- To swap the underlying library, only change `components/ui/` implementations.

## Styling

- **Tailwind CSS v4** only — no raw CSS files, no CSS modules.
- Custom theme tokens defined in `globals.css` via `@theme` directive.
- Indigo (`indigo-500`) as primary color, Slate for neutrals, Emerald for success.

## Accessibility

- Use ARIA attributes and semantic HTML where applicable.
- Ensure all interactive elements are keyboard-navigable.