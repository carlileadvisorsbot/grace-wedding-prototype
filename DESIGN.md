# Wedding Website Design System

## Direction

Romantic Northern Michigan: calm, lakeside, refined, and relaxed. Navy grounds the interface; powder blue and cream create breathing room; coral, peach, butter yellow, and fresh green appear as restrained garden accents. Real Tucker and Syd photography carries the emotion.

## Color tokens

- Navy: `#102f51`
- Deep navy: `#071f38`
- Powder blue: `#9bbbd0`
- Pale blue: `#e8f0f4`
- Cream: `#fbf8f1`
- Paper: `#f4efe5`
- Ink: `#17314a`
- Muted text: `#667887`
- Coral: `#d98573`
- Peach: `#eab09b`
- Butter yellow: `#dfc16e`
- Garden green: `#678976`

## Typography

- Display: Italiana, weight 400
- Body and navigation: DM Sans, weights 300–600
- Handwritten/editorial accent: Georgia italic

## Layout and interaction

- Six tabbed panels: Home, Our Story, Wedding, Travel, Gallery, FAQ
- One main panel visible at a time when JavaScript is available
- All panels remain readable in document order without JavaScript
- Sticky, horizontally scrollable tab bar on small screens
- Minimum touch target: 44px
- Spacing uses fluid clamps around a 22px mobile base and 76px desktop maximum
- Corners remain mostly square; borders and whitespace replace card shadows
- Motion is restrained and disabled when `prefers-reduced-motion` is set

## Photography roles

- Desktop Home: `21-wide-lawn.jpg`
- Mobile Home: `04-dock-walk.jpg`
- Our Story: `19-warm-steps-candid.jpg`
- Story detail: `20-ring-detail.jpg`
- Wedding / venue: `08-clubhouse-hydrangeas.jpg`
- Travel transition: `13-dock-black-and-white.jpg`
- Gallery: all 21 Walloon images, lazy-loaded behind the Gallery tab
