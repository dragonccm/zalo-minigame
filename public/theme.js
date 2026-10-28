// Chủ đề theo mùa — nạp trong <head> để gắn class trước khi trang hiển thị (không nháy màu).
// Halloween tự bật từ 15/10 đến hết 2/11. Thử/tắt tay: ?theme=halloween | ?theme=none (nhớ trong trình duyệt).
(function () {
  'use strict';
  var pick = null;
  try {
    var q = new URLSearchParams(location.search).get('theme');
    if (q) { localStorage.setItem('gh_theme', q); }
    pick = localStorage.getItem('gh_theme');
  } catch (e) { /* trình duyệt chặn bộ nhớ: dùng lịch */ }
  var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
  var season = (m === 10 && day >= 15) || (m === 11 && day <= 2) ? 'halloween' : '';
  var theme = pick === 'none' ? '' : (pick || season);
  if (theme !== 'halloween') return;
  document.documentElement.classList.add('halloween');
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', '#140b22');
})();
