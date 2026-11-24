// Small line illustrations shared by the onboarding cards and the Guida.
// 200x130 viewBox, styled by .pv-io-art (io.css): muted strokes, accent via classes.

const FIG = (x, y, s = 1, extra = '') => `<g transform="translate(${x} ${y}) scale(${s})" class="fig">
  <circle cx="0" cy="-38" r="8"/><path d="M0-29v30M0 1l-9 34M0 1l9 34M-17 -4l17-19 17 19${extra}"/></g>`;

export const ART = {
  tap: `<svg viewBox="0 0 200 130" aria-hidden="true"><g class="fig">
      <circle cx="100" cy="24" r="10"/><path d="M100 35v38M100 73l-11 44M100 73l11 44M100 40l-26 26"/>
      <path class="hl" d="M100 40l24 10 14 24"/></g>
      <circle class="ripple" cx="138" cy="74" r="9"/><circle class="ripple r2" cx="138" cy="74" r="17"/>
      <path class="finger" d="M146 86v-16a5 5 0 0 1 10 0v12l11 3a6 6 0 0 1 4 7l-2 13a8 8 0 0 1-8 7h-9a9 9 0 0 1-7-4l-8-11a4 4 0 0 1 6-5z"/></svg>`,
  rotate: `<svg viewBox="0 0 200 130" aria-hidden="true">
      <ellipse class="ring rx" cx="100" cy="65" rx="46" ry="14"/>
      <ellipse class="ring ry" cx="100" cy="65" rx="14" ry="46"/>
      <circle class="ring rz" cx="100" cy="65" r="46"/>
      <circle class="joint" cx="100" cy="65" r="7"/>
      <path class="arrow" d="M150 40a56 56 0 0 1 2 46"/><path class="arrow" d="m146 82 6 6 4-8"/></svg>`,
  pinch: `<svg viewBox="0 0 200 130" aria-hidden="true">
      <rect class="frame" x="40" y="14" width="120" height="102" rx="14"/>
      <circle class="dot" cx="80" cy="74" r="9"/><circle class="dot" cx="120" cy="56" r="9"/>
      <path class="arrow" d="M70 84l-16 16m0 0h10m-10 0V90M130 46l16-16m0 0h-10m10 0v10"/>
      <path class="arrow soft" d="M100 26v-8m0 0-4 4m4-4 4 4M100 104v8m0 0-4-4m4 4 4-4"/></svg>`,
  poses: `<svg viewBox="0 0 200 130" aria-hidden="true">
      <rect class="frame" x="14" y="20" width="52" height="92" rx="10"/><rect class="frame on" x="74" y="20" width="52" height="92" rx="10"/><rect class="frame" x="134" y="20" width="52" height="92" rx="10"/>
      ${FIG(40, 86, 0.82)}
      <g transform="translate(100 86) scale(.82)" class="fig hlfig"><circle cx="0" cy="-38" r="8"/><path d="M0-29v30M0 1l-14 30M0 1l12 34M-20-34l20 11 18-22"/></g>
      <g transform="translate(160 86) scale(.82)" class="fig"><circle cx="4" cy="-36" r="8"/><path d="M2-27 0 1M0 1l-14 16 6 18M0 1l12 34M-16 0 2-21 18-6"/></g>
      <path class="spark" d="M118 12c.6 3.5 2.2 5.2 5.7 5.8-3.5.6-5.1 2.3-5.7 5.8-.6-3.5-2.2-5.2-5.7-5.8 3.5-.6 5.1-2.3 5.7-5.8z"/></svg>`,
  // quick zoom: the hand of a small figure magnified in a lens, round button bottom-right
  zoom: `<svg viewBox="0 0 200 130" aria-hidden="true">
      ${FIG(50, 86, 0.9)}
      <circle class="dash" cx="65" cy="83" r="9"/>
      <path class="link" d="M73 77 99 64"/>
      <circle class="lens" cx="132" cy="56" r="38"/>
      <g class="hl"><path d="M114 66q0 18 18 18 16 0 16-16M120 64V44M128 62V36M136 62V38M144 66V48M114 68l-10-12"/></g>
      <circle class="fab" cx="178" cy="110" r="14"/><g class="fabi"><circle cx="176" cy="108" r="5"/><path d="m180 112 4 4M176 106v4M174 108h4"/></g></svg>`,
  // line of action: a bent figure following a curve drawn with a finger
  line: `<svg viewBox="0 0 200 130" aria-hidden="true">
      <path class="stroke" pathLength="1" d="M58 124C46 84 78 34 136 12"/>
      <g class="fig"><circle cx="131" cy="24" r="8"/><path d="M125 32C111 44 100 60 94 80M94 80 74 120M94 80l18 16 4 24M117 42l-25-9-12-15M117 42l24 5 14 13"/></g>
      <path class="body" d="M74 120 94 80C100 60 111 44 125 32"/>
      <circle class="ripple" cx="136" cy="12" r="7"/></svg>`,
  // the Guida: an open book with a question mark
  guide: `<svg viewBox="0 0 200 130" aria-hidden="true">
      <path class="frame" d="M100 34c-16-10-38-12-58-6v78c20-6 42-4 58 6zM100 34c16-10 38-12 58-6v78c-20-6-42-4-58 6z"/>
      <path class="soft" d="M54 46c12-3 22-2 34 2M54 60c12-3 22-2 34 2M54 74c12-3 22-2 34 2M112 48c12-4 22-5 34-2M112 62c12-4 22-5 34-2"/>
      <circle class="qbg" cx="150" cy="84" r="19"/>
      <path class="q" d="M144 79a6 6 0 1 1 9 5c-2 1-3 2-3 5"/><circle class="qdot" cx="150" cy="95" r="1.6"/></svg>`,
};
