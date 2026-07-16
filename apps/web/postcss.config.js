// PostCSS is the CSS processing pipeline that Tailwind plugs into.
// Next.js runs PostCSS automatically on every CSS file —
// no extra configuration needed beyond listing the plugins.
//
// Tailwind v4 moved its PostCSS integration out of the 'tailwindcss'
// package itself and into '@tailwindcss/postcss' — using 'tailwindcss'
// directly here (the v3 way) is what threw "trying to use tailwindcss
// directly as a PostCSS plugin" during the build. v4 also handles vendor
// prefixing internally via Lightning CSS, so autoprefixer is redundant now.
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
