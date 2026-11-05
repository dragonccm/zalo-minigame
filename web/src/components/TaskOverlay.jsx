import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import Icon from './Icon';

export default function TaskOverlay({ host, offer, onFinish }) {
  const [selectedTask, setSelectedTask] = useState(null);
  const [run, setRun] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [claimed, setClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const slug = host.game.slug;
  const p = offer.placement;

  const cancelRun = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (run && !host.preview) {
      await api(`/api/games/${slug}/rewards/runs/${run.runId}/cancel`, { method: 'POST' }).catch(() => {});
    }
  };

  const handleClose = async () => {
    await cancelRun();
    onFinish({ rewarded: false, reason: 'closed', placement: p.placement });
  };

  const handleBack = async () => {
    await cancelRun();
    setSelectedTask(null);
    setRun(null);
    setErr('');
  };

  const handleStartTask = async task => {
    if (task.url) {
      window.open(task.url, '_blank', 'noopener,noreferrer');
    }
    if (run) return;
    setErr('');
    try {
      const res = host.preview
        ? { runId: 0 }
        : await api(`/api/games/${slug}/rewards/${encodeURIComponent(p.placement)}/start`, {
            method: 'POST',
            body: { taskId: task.id },
          });
      setRun(res);
      startTimeRef.current = Date.now();
      setTimeLeft(task.durationSec);

      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        const remaining = Math.max(0, Math.ceil(task.durationSec - elapsed));
        setTimeLeft(remaining);
        if (remaining <= 0) {
          clearInterval(timerRef.current);
        }
      }, 250);
    } catch (e) {
      setErr(e.message);
    }
  };

  const handleClaim = async () => {
    setClaiming(true);
    setErr('');
    try {
      const res = host.preview
        ? { rewarded: true, placement: p.placement, reward: p.reward, preview: true }
        : await api(`/api/games/${slug}/rewards/runs/${run.runId}/claim`, {
            method: 'POST',
            body: { code: code.trim() },
          });

      if (timerRef.current) clearInterval(timerRef.current);
      setClaimed(true);
      if (host.opts.onRefreshUser) host.opts.onRefreshUser();

      setTimeout(() => {
        onFinish({
          rewarded: true,
          placement: res.placement,
          reward: res.reward,
          token: res.token || null,
          runId: res.runId || null,
          task: res.task ? { id: res.task.id, title: res.task.title, type: res.task.type } : null,
          preview: !!res.preview,
        });
      }, 1200);
    } catch (ex) {
      setErr(ex.message);
      if (ex.status === 409 || ex.status === 410) {
        setRun(null);
        if (timerRef.current) clearInterval(timerRef.current);
      }
    } finally {
      setClaiming(false);
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (claimed) {
    return (
      <div className="tasklayer">
        <div className="taskcard center">
          <div style={{ fontSize: '56px', margin: '12px 0' }}>
            <Icon name="party-popper" size={56} />
          </div>
          <h3>Hoàn thành nhiệm vụ!</h3>
          <p className="muted">
            Đã nhận: <b>{p.name}</b>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="tasklayer">
      <div className="taskcard">
        {/* Header */}
        <div className="tk-head">
          {selectedTask && (
            <button className="tk-back" onClick={handleBack} title="Quay lại">
              ‹
            </button>
          )}
          <span>
            <Icon name={selectedTask ? selectedTask.icon || 'link' : 'gift'} />{' '}
            {selectedTask ? selectedTask.title : 'Làm nhiệm vụ nhận thưởng'}
          </span>
          <button className="tk-x" onClick={handleClose} title="Đóng">
            <Icon name="x" />
          </button>
        </div>

        {!selectedTask ? (
          <>
            <div className="tk-reward">
              <Icon name="gift" /> {p.name}
              {p.description && <small>{p.description}</small>}
            </div>

            {offer.testMode && (
              <div className="tk-test">
                <Icon name="flask-conical" /> Chế độ thử nghiệm: không giới hạn lượt, chờ tối đa 5 giây
              </div>
            )}

            <p className="muted small">
              Chọn 1 nhiệm vụ{offer.remainingToday ? ` · còn ${offer.remainingToday} lượt hôm nay` : ''}:
            </p>

            <div className="tk-list">
              {offer.tasks.map(t => (
                <button key={t.id} className="tk-item" onClick={() => setSelectedTask(t)}>
                  <span className="tk-ic">
                    <Icon name={t.icon || 'link'} />
                  </span>
                  <span>
                    <b>{t.title}</b>
                    <small>
                      {t.typeLabel} · <Icon name="timer" size={12} /> {t.durationSec} giây
                      {t.verify === 'code' ? ' · cần mã xác nhận' : ''}
                    </small>
                  </span>
                  <span className="tk-go">›</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {selectedTask.description && <p className="muted small">{selectedTask.description}</p>}

            <ol className="tk-steps">
              <li>
                Bấm <b>{selectedTask.typeLabel}</b> — trang sẽ mở ở tab mới.
              </li>
              <li>
                Ở lại ít nhất <b>{selectedTask.durationSec} giây</b>
                {selectedTask.verify === 'code' ? ', tìm mã xác nhận được đọc/ghim trong đó' : ''}.
              </li>
              <li>
                Quay lại đây và bấm <b>Nhận thưởng</b>.
              </li>
            </ol>

            <button
              className={`btn tk-wide ${run ? '' : 'primary'}`}
              onClick={() => handleStartTask(selectedTask)}
            >
              <Icon name="external-link" /> {run ? 'Mở lại liên kết' : selectedTask.typeLabel}
            </button>

            {run && (
              <>
                <div className="tk-progress">
                  <div className="bar">
                    <i
                      style={{
                        width: `${
                          selectedTask.durationSec
                            ? Math.min(100, ((selectedTask.durationSec - timeLeft) / selectedTask.durationSec) * 100)
                            : 100
                        }%`,
                      }}
                    />
                  </div>
                  <span>
                    {timeLeft > 0 ? (
                      `Còn ${timeLeft} giây...`
                    ) : (
                      <>
                        <Icon name="circle-check" size={14} /> Đã đủ thời gian
                      </>
                    )}
                  </span>
                </div>

                {selectedTask.verify === 'code' && (
                  <input
                    type="text"
                    placeholder="Nhập mã xác nhận"
                    maxLength={40}
                    autoComplete="off"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                  />
                )}

                {err && <div className="tk-err">{err}</div>}

                <button
                  className="btn good tk-wide"
                  style={{ marginTop: '10px' }}
                  disabled={timeLeft > 0 || (selectedTask.verify === 'code' && !code.trim()) || claiming}
                  onClick={handleClaim}
                >
                  <Icon name="gift" /> {claiming ? 'Đang xác nhận...' : `Nhận thưởng: ${p.name}`}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
