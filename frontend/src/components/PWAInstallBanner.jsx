import { useState, useEffect } from 'react';

export default function PWAInstallBanner() {
  const [prompt, setPrompt] = useState(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setPrompt(e);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!show) return null;

  return (
    <div className="pwa-banner">
      <div className="pwa-banner-text">
        Install <span>COOP Society</span> for offline access &amp; faster loading.
      </div>
      <div className="pwa-banner-actions">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShow(false)}
        >
          Not now
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={async () => {
            if (prompt) {
              prompt.prompt();
              await prompt.userChoice;
            }
            setShow(false);
          }}
        >
          Install App
        </button>
      </div>
    </div>
  );
}
