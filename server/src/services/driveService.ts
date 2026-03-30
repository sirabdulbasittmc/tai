import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';

const TOKEN_PATH = path.resolve(__dirname, '../../.gdrive_token.json');
const LOCAL_INDEX_PATH = path.resolve(__dirname, '../../..', 'TMC_Drive_Index.md');

let oauth2Client: any = null;

function getOAuth2Client() {
  if (oauth2Client) return oauth2Client;

  oauth2Client = new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
    env.googleRedirectUri
  );

  // Load saved token if exists
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oauth2Client.setCredentials(token);

    // Auto-refresh token on expiry
    oauth2Client.on('tokens', (newTokens: any) => {
      const existing = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
      const merged = { ...existing, ...newTokens };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
      console.log('✓ Google Drive token refreshed');
    });
  }

  return oauth2Client;
}

export function isAuthorized(): boolean {
  return fs.existsSync(TOKEN_PATH);
}

export function getAuthUrl(): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

export async function handleAuthCallback(code: string): Promise<void> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log('✓ Google Drive authorized and token saved');
}

async function fetchFromDrive(): Promise<string> {
  const client = getOAuth2Client();
  const drive = google.drive({ version: 'v3', auth: client });
  const folderId = env.googleDriveFolderId;
  const fileName = env.googleIndexFileName;

  const listRes = await drive.files.list({
    q: `'${folderId}' in parents and name = '${fileName}' and trashed = false`,
    fields: 'files(id, name, modifiedTime)',
  });

  const files = listRes.data.files;
  if (!files || files.length === 0) {
    throw new Error(`File "${fileName}" not found in folder ${folderId}`);
  }

  const fileId = files[0].id;
  const contentRes = await drive.files.get(
    { fileId: fileId!, alt: 'media' },
    { responseType: 'text' }
  );

  return contentRes.data as string;
}

function fetchFromLocal(): string {
  if (!fs.existsSync(LOCAL_INDEX_PATH)) {
    throw new Error(`Local index file not found at ${LOCAL_INDEX_PATH}`);
  }
  console.log(`Reading local index: ${LOCAL_INDEX_PATH}`);
  return fs.readFileSync(LOCAL_INDEX_PATH, 'utf-8');
}

// Drive status tracking — exposed via health endpoint
export interface DriveStatus {
  source: 'google_drive' | 'local_file' | 'none';
  authorized: boolean;
  lastError: string | null;
  lastErrorTime: string | null;
  lastSuccessTime: string | null;
}

let driveStatus: DriveStatus = {
  source: 'none',
  authorized: false,
  lastError: null,
  lastErrorTime: null,
  lastSuccessTime: null,
};

export function getDriveStatus(): DriveStatus {
  return { ...driveStatus, authorized: isAuthorized() };
}

export async function fetchIndexFileContent(): Promise<string> {
  if (isAuthorized()) {
    try {
      const content = await fetchFromDrive();
      driveStatus = {
        source: 'google_drive',
        authorized: true,
        lastError: null,
        lastErrorTime: null,
        lastSuccessTime: new Date().toISOString(),
      };
      console.log('✓ Index loaded from Google Drive');
      return content;
    } catch (err: any) {
      const errorMsg = err.message || String(err);
      driveStatus = {
        ...driveStatus,
        source: 'local_file',
        authorized: true,
        lastError: errorMsg,
        lastErrorTime: new Date().toISOString(),
      };
      console.error('✗ Google Drive fetch failed:', errorMsg);
      console.error('  Reason:', categorizeError(errorMsg));
      console.log('  Falling back to local file...');
    }
  } else {
    driveStatus = {
      ...driveStatus,
      source: 'local_file',
      authorized: false,
      lastError: 'Not authorized. Visit http://localhost:4002/api/auth/google to connect.',
      lastErrorTime: new Date().toISOString(),
    };
    console.log('⚠ Google Drive not authorized — using local TMC_Drive_Index.md');
    console.log('  → To connect: open http://localhost:4002/api/auth/google in your browser');
  }
  return fetchFromLocal();
}

function categorizeError(msg: string): string {
  if (msg.includes('invalid_grant') || msg.includes('Token has been expired'))
    return 'Token expired. Re-authorize at http://localhost:4002/api/auth/google';
  if (msg.includes('insufficient') || msg.includes('403'))
    return 'Permission denied. Make sure the Drive folder is shared with your Google account.';
  if (msg.includes('not found') || msg.includes('404'))
    return `File "${env.googleIndexFileName}" not found in folder ${env.googleDriveFolderId}. Check GOOGLE_DRIVE_FOLDER_ID in .env`;
  if (msg.includes('ENOTFOUND') || msg.includes('network'))
    return 'Network error. Check your internet connection.';
  if (msg.includes('quota'))
    return 'Google API quota exceeded. Wait a few minutes and try again.';
  return 'Unknown error: ' + msg;
}
