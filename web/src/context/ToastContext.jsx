import React, { createContext, useContext, useState, useCallback } from 'react';
import Icon from '../components/Icon';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((msg, type = '', ms = 4500) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, ms);
  }, []);

  const toastGood = useCallback((msg, ms) => addToast(msg, 'good', ms), [addToast]);
  const toastBad = useCallback((msg, ms) => addToast(msg, 'bad', ms), [addToast]);

  return (
    <ToastContext.Provider value={{ toast: addToast, toastGood, toastBad }}>
      {children}
      <div id="toasts">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`.trim()}>
            {t.type === 'good' && <Icon name="circle-check" className="big" />}
            {t.type === 'bad' && <Icon name="triangle-alert" className="big" />}
            <span dangerouslySetInnerHTML={{ __html: t.msg }} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
