import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ClientManagementTab from './admin/ClientManagementTab';
import LicensesTab from './admin/LicensesTab';
import TierManagementTab from './admin/TierManagementTab';
import ConfigTab from './admin/ConfigTab';
import WhatsAppTab from './admin/WhatsAppTab';

export default function AdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('clients');
  const [msg, setMsg] = useState('');

  if (!user?.isAdmin) {
    return <div className="settings-page"><div className="settings-container"><h1>Access Denied</h1></div></div>;
  }

  const tabs = [
    { key: 'clients', label: 'Client Management' },
    ...(user?.isSuperAdmin ? [{ key: 'licenses', label: 'Licenses' }] : []),
    { key: 'tiers', label: 'User Tiers' },
    { key: 'config', label: 'Application Configuration' },
    { key: 'whatsapp', label: 'WhatsApp' },
  ];

  return (
    <div className="settings-page">
      <div className="settings-container" style={{ maxWidth: 800 }}>
        <div className="settings-header">
          <button className="settings-back" onClick={() => navigate('/')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Chat
          </button>
          <h1>Admin Panel</h1>
        </div>

        <div className="config-tabs">
          {tabs.map(t => (
            <button key={t.key} className={`config-tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {msg && <div className={`settings-msg ${msg.includes('Failed') || msg.includes('failed') ? 'error' : ''}`}>{msg}</div>}

        {activeTab === 'clients' && <ClientManagementTab user={user} msg={msg} setMsg={setMsg} />}
        {activeTab === 'licenses' && user?.isSuperAdmin && <LicensesTab msg={msg} setMsg={setMsg} />}
        {activeTab === 'tiers' && <TierManagementTab msg={msg} setMsg={setMsg} />}
        {activeTab === 'config' && <ConfigTab user={user} />}
        {activeTab === 'whatsapp' && <WhatsAppTab user={user} msg={msg} setMsg={setMsg} />}
      </div>
    </div>
  );
}
