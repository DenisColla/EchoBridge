// Small custom pictograms for the scene panels (same stroke style as ui/icons.js).
const NS = 'http://www.w3.org/2000/svg';

export function svgIcon(inner, size = 22, viewBox = '0 0 24 24') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'pv-icon');
  svg.innerHTML = inner;
  return svg;
}

export const LIGHT_ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  spot: '<path d="M9 3h6l3 9H6z"/><path d="M7 15l-2 5M12 15v6M17 15l2 5"/>',
  point: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/>',
};

// Quick camera angle pictograms (side view: figure + camera; top view: head + camera)
const FIG = '<circle cx="15" cy="6" r="2.2"/><path d="M15 8.5v7M15 15.5l-2 5.5M15 15.5l2 5.5M12 11h6"/>';
const HEAD_TOP = '<circle cx="12" cy="10" r="4.2"/><path d="M12 14.2v1.6"/>';
const CAM = (x, y, a) => `<g transform="translate(${x} ${y}) rotate(${a})"><rect x="-2.6" y="-2" width="4" height="4" rx="1"/><path d="M1.4 -1.2 3.2 -2.2v4.4L1.4 1.2"/></g>`;
export const ANGLE_ICONS = {
  eye: `${FIG}${CAM(4.5, 6, 0)}<path d="M8.5 6h3.5" stroke-dasharray="1.6 1.6"/>`,
  low: `${FIG}${CAM(4.5, 20, -40)}<path d="M8 17.5l3.5-3" stroke-dasharray="1.6 1.6"/>`,
  high: `${FIG}${CAM(4.5, 3, 40)}<path d="M8 5.5l3.5 3" stroke-dasharray="1.6 1.6"/>`,
  top: `<circle cx="12" cy="15" r="2"/><path d="M5 21h14"/>${CAM(12, 4, 90)}<path d="M12 8v4" stroke-dasharray="1.6 1.6"/>`,
  front: `${HEAD_TOP}${CAM(12, 21, -90)}`,
  threeq: `${HEAD_TOP}${CAM(19.5, 18.5, -135)}`,
  side: `${HEAD_TOP}${CAM(21, 10, 180)}`,
  back: `${HEAD_TOP}${CAM(12, 2.5, 90)}`,
};
