import { Router } from 'express';
import { getAuthUrl, handleAuthCallback, isAuthorized } from '../services/driveService';

const router = Router();

// Check if Google Drive is connected
router.get('/status', (_req, res) => {
  res.json({ authorized: isAuthorized() });
});

// Start OAuth flow — redirects to Google
router.get('/', (_req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

// OAuth callback — Google redirects here with code
router.get('/callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).send('Missing authorization code');
    return;
  }

  try {
    await handleAuthCallback(code);
    res.send(`
      <html>
      <body style="background:#1a1a1a;color:#e8e8e0;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;">
        <div>
          <h1 style="color:#4ade80;">Google Drive Connected!</h1>
          <p style="color:#888;">TMC AI can now read your Drive data directly.</p>
          <p style="color:#888;">You can close this window.</p>
        </div>
      </body>
      </html>
    `);
  } catch (err: any) {
    res.status(500).send('Authorization failed: ' + err.message);
  }
});

export default router;
