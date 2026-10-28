/* Bộ quân cờ SVG (vẽ riêng cho GameHub). Pieces.url('n', 'w') -> data URL dùng cho <img>. */
(function (root) {
  'use strict';
  var BASE = '<path d="M22 88h56a4 4 0 0 0 4-4v-3a4 4 0 0 0-4-4H22a4 4 0 0 0-4 4v3a4 4 0 0 0 4 4z"/>'
    + '<path d="M29 77h42l-3-7H32z"/>';
  var SHAPES = {
    p: BASE + '<path d="M37 70c1-9 5-15 7-20h12c2 5 6 11 7 20z"/><path d="M39 51h22a3 3 0 0 0 0-6H39a3 3 0 0 0 0 6z"/>'
      + '<circle cx="50" cy="33" r="12"/>',
    r: BASE + '<path d="M34 70l2-31h28l2 31z"/><path d="M30 39h40l-3-5H33z"/>'
      + '<path d="M28 34V18h9v7h7v-7h12v7h7v-7h9v16z"/>',
    n: BASE + '<path d="M33 70c0-9 3-14 8-20-7 1-12 4-16 8-5-2-7-7-4-12 6-9 14-16 18-26l3-8 5 7c13 2 25 13 25 32 0 8-2 14-4 19z"/>'
      + '<circle cx="42" cy="32" r="2.8" class="d"/><path d="M53 22c7 3 12 10 13 20" class="l"/>',
    b: BASE + '<path d="M38 70c1-8 3-12 5-16h14c2 4 4 8 5 16z"/><path d="M38 55h24a3 3 0 0 0 0-6H38a3 3 0 0 0 0 6z"/>'
      + '<path d="M50 14c10 7 16 16 16 23 0 7-6 12-16 12s-16-5-16-12c0-7 6-16 16-23z"/><circle cx="50" cy="11" r="4.5"/>'
      + '<path d="M54 26l-8 10" class="l"/>',
    q: BASE + '<path d="M33 70l-6-36 13 15 10-24 10 24 13-15-6 36z"/>'
      + '<circle cx="27" cy="31" r="5"/><circle cx="50" cy="21" r="5"/><circle cx="73" cy="31" r="5"/><circle cx="39" cy="24" r="4"/><circle cx="61" cy="24" r="4"/>'
      + '<path d="M35 62h30" class="l"/>',
    k: BASE + '<path d="M33 70l-4-26c-1-7 6-11 12-7l9 6 9-6c6-4 13 0 12 7l-4 26z"/>'
      + '<path d="M46 31V22h-6v-6h6v-6h8v6h6v6h-6v9z"/><path d="M36 62h28" class="l"/>',
  };
  var COLORS = {
    w: { fill: '#fbf7ee', stroke: '#2e2a26', detail: '#2e2a26' },
    b: { fill: '#36313c', stroke: '#141218', detail: '#b8b0c4' },
  };
  var cache = {};
  function svg(type, color) {
    var c = COLORS[color];
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>'
      + 'g{fill:' + c.fill + ';stroke:' + c.stroke + ';stroke-width:3;stroke-linejoin:round;stroke-linecap:round}'
      + '.l{fill:none;stroke:' + c.detail + ';stroke-width:2.6}.d{fill:' + c.detail + ';stroke:none}</style>'
      + '<g>' + SHAPES[type] + '</g></svg>';
  }
  root.Pieces = {
    svg: svg,
    url: function (type, color) {
      var k = type + color;
      return cache[k] || (cache[k] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(type, color)));
    },
  };
})(window);
