// Khởi động theo chuẩn GameHub: khởi tạo SDK -> nạp dữ liệu đã lưu của người chơi -> chạy game.
GameHub.init().then(function () {
  return GameHub.load().catch(function () { return null; });
}).then(function (saved) {
  window.__save = saved || {};
  var s = document.createElement('script');
  s.src = 'game.js';
  document.body.appendChild(s);
});
