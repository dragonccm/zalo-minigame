import React, { useState, useEffect } from 'react';

export default function DocsPage() {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Tài liệu chuẩn game & SDK — GameHub';
    fetch('/docs.html')
      .then(res => res.text())
      .then(data => setHtml(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="center" style={{ padding: '60px' }}>
        <div className="spin" />
        <p className="muted">Đang nạp tài liệu...</p>
      </div>
    );
  }

  return (
    <div className="docs" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
