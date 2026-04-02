export const SYSTEM_SECTIONS = [
  { title: 'Application', icon: '\u2699\uFE0F', keys: ['app_name', 'session_hours', 'request_timeout_ms'] },
  { title: 'Password & Security', icon: '\uD83D\uDD10', keys: ['password_min_length', 'password_require_uppercase', 'password_require_number', 'password_require_special', 'max_login_attempts', 'lockout_minutes'] },
  { title: 'AI & RAG Pipeline', icon: '\uD83E\uDDE0', keys: ['rag_enabled', 'pii_enabled', 'rag_top_k', 'rag_min_score', 'intent_timeout_ms'] },
  { title: 'AI Context & Tokens', icon: '\uD83D\uDCCA', keys: ['context_limit_fast', 'context_limit_full', 'max_output_tokens_text', 'max_output_tokens_widget', 'max_output_tokens_quick', 'thinking_budget_text', 'thinking_budget_widget'] },
  { title: 'Response Control', icon: '\uD83D\uDCCF', keys: ['response_length', 'max_response_words'] },
  { title: 'Caching', icon: '\u26A1', keys: ['dedup_cache_ttl_ms', 'weather_cache_ttl_ms'] },
  { title: 'Google Cloud Platform', icon: '\u2601\uFE0F', keys: ['data_source', 'ai_provider', 'gcp_project_id', 'gcp_location', 'bq_dataset'] },
  { title: 'AI API Keys', icon: '\uD83D\uDD11', keys: ['gemini_api_key', 'anthropic_api_key', 'openai_api_key', 'groq_api_key', 'openrouter_api_key'] },
];

export const CLIENT_SECTIONS = [
  { title: 'Email / SMTP', icon: '\u2709\uFE0F', keys: ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure'] },
  { title: 'Google Drive', icon: '\uD83D\uDCC1', keys: ['google_client_id', 'google_client_secret', 'google_redirect_uri', 'google_drive_folder_id', 'google_index_file_name'] },
];
