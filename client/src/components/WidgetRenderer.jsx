import { useRef, useEffect, useState } from 'react';

export default function WidgetRenderer({ html }) {
  const iframeRef = useRef(null);
  const [height, setHeight] = useState(400);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    // Build full HTML document with dark theme defaults
    const doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    overflow-y: hidden;
  }
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: #1e1e1e; color: #e8e8e0;
    padding: 16px; font-size: 14px; line-height: 1.6;
  }
  h1, h2, h3 { font-weight: 500; color: #eee; margin: 12px 0 8px; }
  h1 { font-size: 18px; } h2 { font-size: 16px; } h3 { font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 13px; border-radius: 8px; overflow: hidden; }
  td, th { max-width: 200px; }
  thead { position: sticky; top: 0; z-index: 1; }
  th { background: #2a2a2a; color: #e8e8e0; text-align: left; padding: 10px 12px; border-bottom: 2px solid #cc6b4a; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.3px; }
  td { padding: 8px 12px; border-bottom: 1px solid #2a2a2a; color: #bbb; }
  tr:nth-child(even) td { background: #1a1a1a; }
  tr:hover td { background: #2a2a2a; color: #eee; }
  .card { background: #252525; border: 1px solid #333; border-radius: 10px; padding: 14px; margin: 8px 0; }
  .card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 10px 0; }
  .stat-card { background: linear-gradient(135deg, #252525, #1e1e1e); border: 1px solid #333; border-radius: 12px; padding: 16px; text-align: center; transition: border-color 0.2s; }
  .stat-card:hover { border-color: #cc6b4a; }
  .stat-value { font-size: 26px; font-weight: 700; color: #cc6b4a; letter-spacing: -0.5px; }
  .stat-label { font-size: 11px; color: #888; margin-top: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; }
  .badge-critical { background: rgba(239,68,68,0.15); color: #ef4444; }
  .badge-high { background: rgba(245,158,11,0.15); color: #f59e0b; }
  .badge-medium { background: rgba(59,130,246,0.15); color: #3b82f6; }
  .badge-low { background: rgba(74,222,128,0.15); color: #4ade80; }
  .badge-green { background: rgba(74,222,128,0.15); color: #4ade80; }
  .badge-red { background: rgba(239,68,68,0.15); color: #ef4444; }
  .badge-amber { background: rgba(245,158,11,0.15); color: #f59e0b; }
  .filter-bar { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
  .filter-btn { padding: 5px 12px; border-radius: 16px; border: 1px solid #444; background: transparent; color: #aaa; cursor: pointer; font-size: 12px; font-family: inherit; transition: all 0.15s; }
  .filter-btn:hover { background: #333; color: #eee; }
  .filter-btn.active { background: #cc6b4a; border-color: #cc6b4a; color: #fff; }
  .progress-bar { width: 100%; height: 6px; background: #333; border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 3px; background: #cc6b4a; transition: width 0.3s; }
  .chart-wrap { background: #252525; border: 1px solid #333; border-radius: 10px; padding: 14px; margin: 10px 0; max-width: 100%; }
  select, input { background: #2a2a2a; border: 1px solid #444; color: #eee; padding: 6px 10px; border-radius: 8px; font-size: 13px; font-family: inherit; }
  button { cursor: pointer; }
  a { color: #cc6b4a; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .hidden { display: none; }
</style>
</head>
<body>
${html}
<script>
  // Auto-resize: notify parent of content height — multiple passes to catch late renders
  function notifyHeight() {
    const h = document.body.scrollHeight;
    window.parent.postMessage({ type: 'widget-resize', height: h }, '*');
  }
  new ResizeObserver(notifyHeight).observe(document.body);
  // Multiple delayed checks to catch Chart.js renders, late-loading content, filtered table changes
  [100, 300, 600, 1000, 2000, 4000].forEach(ms => setTimeout(notifyHeight, ms));
  // Also re-measure whenever any image/canvas finishes loading
  document.addEventListener('load', notifyHeight, true);
</script>
</body>
</html>`;

    iframe.srcdoc = doc;

    // Listen for resize messages from iframe
    function handleMessage(e) {
      if (e.data?.type === 'widget-resize' && e.data.height) {
        setHeight(e.data.height + 20);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [html]);

  return (
    <div className="widget-container">
      <iframe
        ref={iframeRef}
        className="widget-iframe"
        style={{ height: `${height}px` }}
        sandbox="allow-scripts allow-same-origin"
        title="TMC Widget"
      />
    </div>
  );
}
