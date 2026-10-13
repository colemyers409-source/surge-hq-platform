/* Surge Apparel — garment mockup renderer shared by the store and the builder. */
(function (g) {
  var BOLT = 'M13.5 2 L4 13.6 H10.6 L9.4 22 L20 9.6 H13.2 Z';
  var TEE = 'M130 40 Q200 72 270 40 L352 80 L388 162 L332 188 L320 168 L322 420 Q200 434 78 420 L80 168 L68 188 L12 162 L48 80 Z';
  var TEE_B = 'M130 40 Q200 56 270 40 L352 80 L388 162 L332 188 L320 168 L322 420 Q200 434 78 420 L80 168 L68 188 L12 162 L48 80 Z';
  var HOOD = 'M122 70 L62 100 L20 262 L25 402 L70 406 L86 232 L90 420 Q200 434 310 420 L314 232 L330 406 L375 402 L380 262 L338 100 L278 70 Q200 6 122 70 Z';
  var ZIP = 'M140 50 L60 86 L20 272 L25 410 L70 412 L86 222 L90 420 Q200 434 310 420 L314 222 L330 412 L375 410 L380 272 L340 86 L260 50 Q200 72 140 50 Z';
  var POLO = 'M128 46 L200 60 L272 46 L346 82 L380 158 L330 180 L318 162 L320 420 Q200 434 80 420 L82 162 L70 180 L20 158 L54 82 Z';
  var CREW = 'M132 44 Q200 70 268 44 L340 80 L384 300 L382 410 L338 414 L320 210 L322 420 Q200 434 78 420 L80 210 L62 414 L18 410 L16 300 L60 80 Z';

  // Each part: [d, kind] kind: g = garment fill, s = stroke-only detail, d = dark fill, m = metal (zip/buttons)
  var BLANKS = {
    tee: { label: 'T-Shirt', vb: [400, 440], sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
      front: [[TEE, 'g'], ['M148 40 Q200 88 252 40', 's'], ['M330 180 L318 162 M70 180 L82 162', 's']],
      back: [[TEE_B, 'g'], ['M140 42 Q200 58 260 42', 's']],
      places: { lchest: ['front', 252, 150, 62], center: ['front', 200, 178, 150], yoke: ['back', 200, 92, 80], fullback: ['back', 200, 215, 210] } },
    crew: { label: 'Crewneck', vb: [400, 440], sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
      front: [[CREW, 'g'], ['M150 46 Q200 86 250 46', 's'], ['M92 404 L308 404', 's']],
      back: [[CREW, 'g'], ['M146 46 Q200 62 254 46', 's']],
      places: { lchest: ['front', 252, 150, 62], center: ['front', 200, 180, 150], yoke: ['back', 200, 96, 80], fullback: ['back', 200, 218, 200] } },
    hoodie: { label: 'Hoodie', vb: [400, 440], sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
      front: [[HOOD, 'g'], ['M150 72 Q200 132 250 72 Q200 40 150 72 Z', 'd'], ['M182 112 L178 190 M218 112 L222 190', 'm'], ['M132 300 L268 300 L284 382 L116 382 Z', 's']],
      back: [[HOOD, 'g'], ['M122 70 Q200 150 278 70 Q200 16 122 70 Z', 'g']],
      places: { lchest: ['front', 252, 196, 56], center: ['front', 200, 214, 140], yoke: ['back', 200, 156, 80], fullback: ['back', 200, 250, 200] } },
    quarterzip: { label: 'Quarter-Zip', vb: [400, 440], sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
      front: [[ZIP, 'g'], ['M148 52 L152 24 Q200 12 248 24 L252 52 Q200 70 148 52 Z', 'g'], ['M200 18 L200 156', 'm'], ['M194 40 h12 v18 h-12 Z', 'mf']],
      back: [[ZIP, 'g'], ['M148 52 L152 26 Q200 18 248 26 L252 52', 'g']],
      places: { lchest: ['front', 254, 176, 60], yoke: ['back', 200, 98, 80], fullback: ['back', 200, 228, 200] } },
    polo: { label: 'Polo', vb: [400, 440], sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
      front: [[POLO, 'g'], ['M140 40 L200 58 L178 104 L130 66 Z', 'g'], ['M260 40 L200 58 L222 104 L270 66 Z', 'g'], ['M192 60 h16 v92 h-16 Z', 's'], ['M200 84 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M200 108 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M200 132 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0', 'mf'], ['M330 180 L318 162 M70 180 L82 162', 's']],
      back: [[POLO, 'g'], ['M132 48 Q200 30 268 48 L262 66 Q200 52 138 66 Z', 'g']],
      places: { lchest: ['front', 258, 168, 56], yoke: ['back', 200, 98, 80], fullback: ['back', 200, 222, 200] } },
    cap: { label: 'Rope Cap', vb: [400, 300], sizes: ['One Size'],
      front: [['M70 220 Q70 82 200 74 Q330 82 330 220 Z', 'g'], ['M44 222 Q200 268 356 222 Q360 254 200 286 Q40 254 44 222 Z', 'g2'], ['M64 230 Q200 270 336 230', 'rope'], ['M200 74 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0', 'mf']],
      back: [['M70 250 Q70 82 200 74 Q330 82 330 250 Z', 'g'], ['M150 250 Q150 196 200 196 Q250 196 250 250 Z', 'd'], ['M140 236 h120 v12 h-120 Z', 'mf'], ['M200 78 L200 196', 's']],
      places: { front: ['front', 200, 156, 112], back: ['back', 200, 168, 64] } },
    dad: { label: 'Dad Hat', vb: [400, 300], sizes: ['One Size'],
      front: [['M80 214 Q78 96 200 88 Q322 96 320 214 Z', 'g'], ['M60 214 Q200 252 340 214 Q346 246 200 270 Q54 246 60 214 Z', 'g2'], ['M200 88 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0', 'mf']],
      back: [['M80 244 Q78 96 200 88 Q322 96 320 244 Z', 'g'], ['M156 244 Q156 200 200 200 Q244 200 244 244 Z', 'd'], ['M150 232 h100 v10 h-100 Z', 'mf']],
      places: { front: ['front', 200, 160, 96], back: ['back', 200, 172, 60] } }
  };
  var PLACE_LABEL = { lchest: 'Left chest', center: 'Center chest', yoke: 'Upper back', fullback: 'Full back', front: 'Front panel', back: 'Back (above strap)' };
  var LOGOS = { A: 'Block Wordmark', B: 'SP Monogram', C: 'Flag Logo', D: 'Bolt Shield' };

  function lum(hex) { hex = (hex || '#000').replace('#', ''); if (hex.length === 3) hex = hex.replace(/./g, '$&$&');
    var n = parseInt(hex, 16), r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255; return (0.299 * r + 0.587 * gg + 0.114 * b) / 255; }
  function shade(hex, f) { hex = (hex || '#000').replace('#', ''); var n = parseInt(hex, 16);
    var c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) { return Math.max(0, Math.min(255, Math.round(v * f))); });
    return '#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join(''); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var FILES = { A: 'Block_Wordmark', B: 'SP_Monogram', C: 'Flag_Wordmark', D: 'Bolt_Shield' };
  function logoSrc(l) { if (!l || !l.logo) return ''; return /^(https?:|data:|\/)/.test(l.logo) ? l.logo : '/shop/logos/Surge_' + (FILES[l.logo] || FILES.A) + '_' + (l.ink || 'gold') + '.png'; }

  var uid = 0;
  // design = {logos:[{logo,ink,place,scale,dy}, ...]} — one entry per print/embroidery location
  function render(blank, hex, view, design, opt) {
    var B = BLANKS[blank] || BLANKS.tee; opt = opt || {};
    var id = 'sg' + (++uid), light = lum(hex) > 0.62, line = light ? 'rgba(0,0,0,.22)' : 'rgba(255,255,255,.14)';
    var w = B.vb[0], h = B.vb[1];
    var out = '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + esc(B.label + ' ' + view) + '"' + (opt.cls ? ' class="' + opt.cls + '"' : '') + '>';
    out += '<defs><linearGradient id="' + id + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="' + (light ? 0 : 0.07) + '"/><stop offset="1" stop-color="#000" stop-opacity="' + (light ? 0.10 : 0.28) + '"/></linearGradient></defs>';
    (B[view] || []).forEach(function (p) {
      var d = p[0], k = p[1];
      if (k === 'g' || k === 'g2') {
        var f = k === 'g2' ? shade(hex, light ? 0.9 : 0.8) : hex;
        out += '<path d="' + d + '" fill="' + f + '" stroke="' + line + '" stroke-width="2" stroke-linejoin="round"/>';
        out += '<path d="' + d + '" fill="url(#' + id + 'g)"/>';
      } else if (k === 's') out += '<path d="' + d + '" fill="none" stroke="' + line + '" stroke-width="2.5" stroke-linecap="round"/>';
      else if (k === 'd') out += '<path d="' + d + '" fill="' + shade(hex, 0.45) + '"/>';
      else if (k === 'm') out += '<path d="' + d + '" fill="none" stroke="' + (light ? '#9A9488' : '#8C877A') + '" stroke-width="3" stroke-linecap="round"/>';
      else if (k === 'mf') out += '<path d="' + d + '" fill="' + (light ? '#9A9488' : '#5A564C') + '"/>';
      else if (k === 'rope') out += '<path d="' + d + '" fill="none" stroke="' + (opt.rope || '#C5B071') + '" stroke-width="5" stroke-dasharray="7 4"/>';
    });
    ((design && design.logos) || []).forEach(function (L) {
      if (!L || !L.logo) return;
      var P = B.places[L.place]; if (!P || P[0] !== view) return;
      var s = P[3] * (L.scale || 1), x = P[1] - s / 2, y = P[2] - s / 2 + (L.dy || 0);
      out += '<image href="' + esc(logoSrc(L)) + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + s.toFixed(1) + '" height="' + s.toFixed(1) + '" preserveAspectRatio="xMidYMid meet"/>';
    });
    return out + '</svg>';
  }
  g.SurgeRender = { BLANKS: BLANKS, PLACE_LABEL: PLACE_LABEL, LOGOS: LOGOS, render: render, logoSrc: logoSrc, lum: lum, BOLT: BOLT };
})(window);
