// PostCSS is the CSS processing pipeline that Tailwind plugs into.
// Next.js runs PostCSS automatically on every CSS file —
// no extra configuration needed beyond listing the plugins.
module.exports = {
  plugins: {
    tailwindcss: {},
    // autoprefixer adds vendor prefixes (-webkit-, -moz-) for older browsers.
    autoprefixer: {},
  },
};
