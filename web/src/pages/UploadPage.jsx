import React, { useState, useEffect, useRef } from 'react';
import { api, dateStr } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Icon from '../components/Icon';

export default function UploadPage() {
  const { user, openLogin, openRegister } = useAuth();
  const { toastGood, toastBad } = useToast();

  const [submissions, setSubmissions] = useState([]);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null); // { ok: bool, errors: [], warnings: [], msg: '' }
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef(null);

  const loadSubs = async () => {
    try {
      const res = await api('/api/my/submissions');
      setSubmissions(res.submissions || []);
    } catch {
      setSubmissions([]);
    } finally {
      setLoadingSubs(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadSubs();
    }
  }, [user]);

  const handleFile = async file => {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) {
      setResult({ ok: false, errors: ['Chỉ chấp nhận file định dạng .zip'], warnings: [] });
      return;
    }

    setUploading(true);
    setResult({ ok: null, warnings: [], msg: 'Đang tải lên và kiểm tra cấu trúc gói game...' });

    try {
      const res = await api('/api/submissions', { method: 'POST', raw: file });
      setResult({
        ok: true,
        warnings: res.warnings || [],
        msg: `Đã gửi duyệt thành công! Game "${res.submission.manifest.name}" v${res.submission.version} đang chờ quản trị viên xem xét.`,
      });
      loadSubs();
      toastGood('Đã gửi game lên hàng đợi duyệt!');
    } catch (e) {
      setResult({
        ok: false,
        errors: (e.data && e.data.errors) || [e.message],
        warnings: (e.data && e.data.warnings) || [],
      });
    } finally {
      setUploading(false);
    }
  };

  const handleWithdraw = async id => {
    try {
      await api(`/api/submissions/${id}`, { method: 'DELETE' });
      toastGood('Đã rút bản gửi');
      loadSubs();
    } catch (err) {
      toastBad(err.message);
    }
  };

  if (!user) {
    return (
      <div className="panel center" style={{ maxWidth: '560px', margin: '40px auto' }}>
        <h2>
          <Icon name="upload-cloud" /> Đăng game của bạn
        </h2>
        <p className="muted">
          Bạn cần đăng nhập để gửi game. Game sẽ được quản trị viên xem xét trước khi hiển thị công khai.
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px' }}>
          <button className="btn primary" onClick={openLogin}>
            Đăng nhập
          </button>
          <button className="btn" onClick={openRegister}>
            Tạo tài khoản
          </button>
        </div>
        <p className="small" style={{ marginTop: '16px' }}>
          <a href="#/docs">
            <Icon name="file-text" size={14} /> Xem chuẩn game & SDK
          </a>
        </p>
      </div>
    );
  }

  const STATUS_LABELS = {
    pending: 'Chờ duyệt',
    approved: 'Đã duyệt',
    rejected: 'Bị từ chối',
    withdrawn: 'Đã rút',
  };

  return (
    <div className="grid2">
      <div className="stack">
        {/* Upload Box */}
        <div className="panel">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: 0 }}>
            <Icon name="upload-cloud" /> Gửi game mới
          </h2>
          <div
            className={`drop ${dragOver ? 'over' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              handleFile(e.dataTransfer.files[0]);
            }}
          >
            <div style={{ fontSize: '42px', margin: '8px 0' }}>
              <Icon name="upload-cloud" size={42} />
            </div>
            <b>Kéo thả file .zip vào đây</b>
            <div className="muted small">hoặc bấm để chọn · tối đa 30MB</div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={e => {
                handleFile(e.target.files[0]);
                e.target.value = '';
              }}
            />
          </div>

          {/* Result Alert */}
          {result && (
            <div style={{ marginTop: '14px' }}>
              {result.ok === null && (
                <div className="report warn">
                  <Icon name="timer" size={14} /> {result.msg}
                </div>
              )}
              {result.ok === true && (
                <div className="report ok">
                  <b>
                    <Icon name="circle-check" size={14} /> {result.msg}
                  </b>
                  {result.warnings?.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <b>Cảnh báo:</b>
                      <ul>
                        {result.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {result.ok === false && (
                <div className="report err">
                  <b>
                    <Icon name="triangle-alert" size={14} /> Chưa đạt chuẩn — {result.errors?.length} lỗi cần sửa:
                  </b>
                  <ul>
                    {result.errors?.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                  {result.warnings?.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <b>Cảnh báo:</b>
                      <ul>
                        {result.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Submissions List */}
        <div className="panel">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="send" /> Các lần gửi của bạn
          </h3>
          {loadingSubs ? (
            <p className="muted">Đang tải...</p>
          ) : submissions.length > 0 ? (
            submissions.map(s => (
              <div
                key={s.id}
                className="panel"
                style={{ marginBottom: '10px', background: 'var(--card2)' }}
              >
                <div className="row" style={{ alignItems: 'center' }}>
                  <b>{s.manifest.name}</b>
                  <span className="muted small">v{s.version}</span>
                  <span className={`status ${s.status}`}>{STATUS_LABELS[s.status] || s.status}</span>
                  <span className="spacer" />
                  <span className="muted small">{dateStr(s.createdAt)}</span>
                  {s.status === 'pending' && (
                    <button
                      className="btn sm bad"
                      onClick={() => handleWithdraw(s.id)}
                    >
                      Rút lại
                    </button>
                  )}
                </div>

                {s.note && (
                  <div
                    className={`report ${s.status === 'rejected' ? 'err' : 'ok'}`}
                    style={{ marginTop: '8px' }}
                  >
                    <b>Phản hồi từ quản trị viên:</b> {s.note}
                  </div>
                )}

                {s.status === 'approved' && (
                  <div style={{ marginTop: '6px' }}>
                    <a href={`#/game/${encodeURIComponent(s.slug)}`}>→ Mở trang game</a>
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="muted">Chưa có lần gửi nào.</p>
          )}
        </div>
      </div>

      {/* Checklist Aside */}
      <aside className="panel">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Icon name="circle-check" /> Checklist nhanh
        </h3>
        <ul style={{ paddingLeft: '18px', margin: 0 }} className="muted">
          <li>
            <code>gamehub.json</code> ở thư mục gốc của gói
          </li>
          <li>
            Có file <code>index.html</code> (entry point)
          </li>
          <li>
            Mọi file nằm trong gói — <b>không</b> tải CDN / tài nguyên bên ngoài
          </li>
          <li>
            Gọi <code>GameHub.init()</code>, <code>ready()</code>, <code>submitScore()</code>
          </li>
          <li>
            Có <code>thumbnail</code> kích thước 640×360
          </li>
          <li>
            Tăng <code>version</code> khi cập nhật phiên bản mới
          </li>
        </ul>
        <p style={{ marginTop: '14px' }}>
          <a className="btn" href="#/docs">
            <Icon name="file-text" /> Đọc tài liệu SDK
          </a>
        </p>
      </aside>
    </div>
  );
}
