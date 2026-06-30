import type { Config } from 'tailwindcss';

const config: Config = {
  // 'content' tells Tailwind which files to scan for class names.
  // Tailwind reads these at build time and strips any class it doesn't
  // find — so the final CSS only contains classes you actually used.
  // Miss a path here and those classes get purged from production builds.
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Custom design tokens (colours, spacing, fonts) go here.
      // 'extend' merges with Tailwind's defaults — replacing 'theme'
      // directly would remove all built-in utilities.
    },
  },
  plugins: [],
};

export default config;
