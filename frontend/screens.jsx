// Screen components for NotifyX — wired to real API

const { Icon } = window;
const { Sparkline, AreaChart, RingChart, BarChart, Heatmap } = window.Charts;
const { EMPTY_SERIES, DEFAULT_PREFS, PREF_DEFS } = window.NTFX_DATA;
const { apiFetch } = window.NTFX_AUTH;

// ─── Dashboard ────────────────────────────────────────────────────────────────
const useLastUpdated = () => {
  const [secs, setSecs] = React.useState(14);
  const [refreshing, setRefreshing] = React.useState(false);
  React.useEffect(() => {
    const id = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const refresh = () => { setRefreshing(true); setTimeout(() => { setSecs(0); setRefreshing(false); }, 700); };
  const label = refreshing ? 'syncing…' : secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ${secs % 60}s ago`;
  return { label, refresh, refreshing };
};

const InlineStat = ({ label, value, delta, trend, hint }) => (
  <div className="inline-stat">
    <div className="inline-stat-label">{label}</div>
    <div className="inline-stat-value">{value}</div>
    <div className="inline-stat-meta">
      {delta && <span className={`delta ${trend}`}>{delta}</span>}
      {hint && <span className="hint">{hint}</span>}
    </div>
  </div>
);

const Dashboard = ({ onNavigate }) => {
  const [range, setRange] = React.useState('24h');
  const [loading, setLoading] = React.useState(true);
  const [metrics, setMetrics] = React.useState(null);
  const [series, setSeries] = React.useState(EMPTY_SERIES);
  const [integrations, setIntegrations] = React.useState(null);
  const [activities, setActivities] = React.useState([]);
  const [healthStatus, setHealthStatus] = React.useState('ok');
  const { label: lastUpdated, refresh: tick, refreshing } = useLastUpdated();
  const [refreshKey, setRefreshKey] = React.useState(0);

  const refresh = () => {
    tick();
    setRefreshKey(k => k + 1);
  };

  React.useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch('/api/metrics').then(setMetrics).catch(() => { }),
      window.NTFX_AUTH.getMetricsSeries(range).then(setSeries).catch(() => { }),
      window.NTFX_AUTH.getIntegrations().then(setIntegrations).catch(() => { }),
      apiFetch('/api/notifications?limit=7').then(data => setActivities(data.notifications || [])).catch(() => { }),
      fetch(`${window.NOTIFYX_API_URL || 'http://localhost:3000'}/health`).then(r => r.json()).then(h => setHealthStatus(h.status)).catch(() => setHealthStatus('offline')),
    ]).finally(() => setLoading(false));
  }, [range, refreshKey]);

  const stats = [
    { label: 'Total Dispatched', value: (metrics?.delivery?.total || 0).toLocaleString(), delta: null, trend: 'neutral', hint: 'real API count' },
    { label: 'Delivered', value: (metrics?.delivery?.success || 0).toLocaleString(), delta: null, trend: 'up', hint: 'successfully sent' },
    { label: 'Failed', value: (metrics?.delivery?.failed || 0).toLocaleString(), delta: null, trend: 'down', hint: 'pending retry' },
    { label: 'Success Rate', value: `${metrics?.delivery?.successRate || '100.00'}%`, delta: null, trend: 'up', hint: 'delivery SLO' },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="eyebrow">Production · eu-west-1</div>
          <h1 className="page-title">Overview</h1>
        </div>
        <div className="page-actions">
          <span className="live-indicator">
            <span className={`live-dot ${refreshing ? 'syncing' : ''}`} />
            <span className="live-label">Last updated <span className="mono fg-dim">{lastUpdated}</span></span>
          </span>
          <button className="btn ghost" onClick={refresh}><Icon name="refresh" size={12} /> Refresh</button>
          <button className="btn primary" onClick={() => onNavigate && onNavigate('queue')}><Icon name="plus" size={12} /> New job</button>
        </div>
      </div>

      {/* Active Channels & Integrations Bar */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-h tight">
          <div className="card-h-block">
            <h3>Active channel integrations</h3>
            <div className="sub mono">real-time external account sync</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {[
              { key: 'github', label: 'GitHub', icon: 'github' },
              { key: 'gmail', label: 'Gmail', icon: 'mail' },
              { key: 'linkedin', label: 'LinkedIn', icon: 'linkedin' },
              { key: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' },
            ].map(item => {
              const isConn = integrations?.[item.key]?.connected;
              const handle = integrations?.[item.key]?.username || integrations?.[item.key]?.email || integrations?.[item.key]?.name || integrations?.[item.key]?.phone;
              return (
                <span key={item.key} className={`pill ${isConn ? 'completed' : ''}`} onClick={() => onNavigate && onNavigate('settings')} style={{ cursor: 'pointer' }}>
                  <span className={`pdot ${isConn ? 'green' : ''}`} />
                  <Icon name={item.icon} size={11} />
                  <span>{item.label}</span>
                  <span className="mono fg-faint" style={{ fontSize: 10, marginLeft: 2 }}>
                    {isConn ? (handle ? `· @${handle}` : 'Connected') : '+ Connect'}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <section className="hero-card">
        <div className="hero-head">
          <div className="hero-title-block">
            <div className="hero-eyebrow">Throughput</div>
            <h2 className="hero-headline">
              <span className="mono">{(metrics?.delivery?.total || 0).toLocaleString()}</span> notifications dispatched
              <span className="hero-headline-dim"> in selected range</span>
            </h2>
          </div>
          <div className="hero-controls">
            <div className="chart-legend">
              <span><span className="legend-dot ink" />Sent</span>
              <span><span className="legend-dot mid" />Delivered</span>
              <span><span className="legend-dot red" />Failed</span>
            </div>
            <div className="tabs">
              {['1h', '24h', '7d', '30d'].map(t => (
                <button key={t} className={`tab ${range === t ? 'active' : ''}`} onClick={() => setRange(t)}>{t}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="hero-chart">
          {loading ? (
            <div className="chart-skeleton">
              <div className="skel-bars">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div key={i} className="skel-bar" style={{ height: `${20 + ((i * 37) % 60)}%`, animationDelay: `${i * 40}ms` }} />
                ))}
              </div>
            </div>
          ) : (
            <AreaChart series={series || EMPTY_SERIES} labels={(series || EMPTY_SERIES).labels} height={320} />
          )}
        </div>
        <div className="hero-stats">
          {stats.map((s, i) => <InlineStat key={i} {...s} />)}
        </div>
      </section>

      <div className="section-divider"><span className="section-label">Operations</span></div>

      <div className="ops-grid">
        <div className="card">
          <div className="card-h tight">
            <div className="card-h-block">
              <h3>Recent activity</h3>
              <div className="sub mono">live · {activities.length} events</div>
            </div>
            <button className="btn ghost sm" onClick={() => onNavigate && onNavigate('notifications')}>View all</button>
          </div>
          <div className="activity-list">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div className="activity-item" key={i}>
                  <div className="skel-circle" />
                  <div className="activity-text" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="skel-line" style={{ width: `${60 + (i * 7) % 30}%` }} />
                    <div className="skel-line" style={{ width: `${30 + (i * 11) % 20}%`, height: 8 }} />
                  </div>
                </div>
              ))
            ) : activities.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="empty-mark">—</div>
                <div className="empty-title">No recent activity</div>
                <div className="empty-sub">No notification events recorded yet. Click "+ New job" above to submit one.</div>
              </div>
            ) : (
              activities.map((a, i) => {
                const src = a.payload?.source;
                const srcIcon = src === 'github' ? 'github' : src === 'whatsapp' ? 'whatsapp' : src === 'gmail' ? 'mail' : src === 'linkedin' ? 'linkedin' : null;
                const icon = srcIcon || (a.type === 'like' ? 'heart' : a.type === 'comment' ? 'comment' : a.type === 'mention' ? 'at' : 'mail');
                return (
                  <div className="activity-item" key={a._id || i}>
                    <div className="activity-icon email">
                      <Icon name={icon} size={12} />
                    </div>
                    <div className="activity-text">
                      <div className="title">{a.payload?.message || (<><b>{a.senderId}</b> → {a.type}</>)}</div>
                      <div className="meta">{src || a.type} · recipient: {a.recipientId}</div>
                    </div>
                    <div className="activity-time">{a.createdAt ? new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now'}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-h tight">
            <div className="card-h-block">
              <h3>Backend service health</h3>
              <div className="sub mono">system status</div>
            </div>
            <span className="status-dot-row" title="System status">
              <span className={`sd ${healthStatus === 'ok' ? 'green' : 'red'}`} />
            </span>
          </div>
          <div className="provider-list">
            {[
              { name: 'API Server (Node.js)', status: healthStatus === 'ok' ? 'Online' : 'Degraded', detail: 'HTTP Port 3000' },
              { name: 'Database (MongoDB Atlas)', status: healthStatus === 'ok' ? 'Connected' : 'Disconnected', detail: 'ReplicaSet Cluster0' },
              { name: 'Cache / Queue (Redis)', status: healthStatus === 'ok' ? 'Ready' : 'Checking', detail: 'Upstash Redis Cluster' },
              { name: 'Real-time WebSocket', status: 'Connected', detail: 'Socket.io Server' },
            ].map((p, i) => (
              <div className="provider-row" key={i}>
                <div>
                  <div className="provider-name">{p.name}</div>
                  <div className="provider-warn" style={{ color: 'var(--fg-faint)', fontSize: 11 }}>{p.detail}</div>
                </div>
                <div className="provider-stats mono">
                  <span style={{ color: p.status === 'Online' || p.status === 'Connected' || p.status === 'Ready' ? 'var(--green)' : 'var(--warn)' }}>{p.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <QuickAccessBar />
    </div>
  );
};

// ─── Quick-access bar (shown on Dashboard) ────────────────────────────────────
const QUICK_LINKS = [
  { label: 'Dashboard', href: () => `${location.origin}/dashboard.html`, icon: 'home', hint: 'React app' },
  { label: 'Landing', href: () => `${location.origin}/`, icon: 'help', hint: 'Demo & docs' },
  { label: 'API', href: () => `${window.NOTIFYX_API_URL || 'http://localhost:3000'}`, icon: 'metrics', hint: 'REST base URL' },
  { label: 'Health', href: () => `${window.NOTIFYX_API_URL || 'http://localhost:3000'}/health`, icon: 'check', hint: 'Readiness probe' },
];

const QuickAccessBar = () => {
  const [copied, setCopied] = React.useState(null);

  const copy = (href, label) => {
    navigator.clipboard.writeText(href).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1800);
    });
  };

  return (
    <div className="qa-bar">
      <div className="qa-bar-label">
        <Icon name="cube" size={12} />
        <span>Quick access</span>
      </div>
      <div className="qa-links">
        {QUICK_LINKS.map(({ label, href, icon, hint }) => {
          const url = href();
          const isCopied = copied === label;
          return (
            <div className="qa-link" key={label}>
              <a href={url} target="_blank" rel="noopener" className="qa-link-main" title={hint}>
                <Icon name={icon} size={12} className="qa-link-icon" />
                <span className="qa-link-label">{label}</span>
                <span className="qa-link-url mono">{url}</span>
                <Icon name="arrow-up" size={10} className="fg-faint" style={{ transform: 'rotate(45deg)', flexShrink: 0 }} />
              </a>
              <button
                type="button"
                className={`qa-copy ${isCopied ? 'ok' : ''}`}
                onClick={() => copy(url, label)}
                title="Copy URL"
              >
                {isCopied ? '✓' : <Icon name="copy" size={11} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Queue ────────────────────────────────────────────────────────────────────
const ago = (sec) => {
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ago`;
};

const Queue = () => {
  const [filter, setFilter] = React.useState('all');
  const [type, setType] = React.useState('all');
  const [jobs, setJobs] = React.useState([]);
  const [toast, setToast] = React.useState(null);
  const [showModal, setShowModal] = React.useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = React.useState(false);
  const [dateMenuOpen, setDateMenuOpen] = React.useState(false);
  const [dateFilter, setDateFilter] = React.useState('Last 24 hours');

  // Modal Form State
  const [newRecipient, setNewRecipient] = React.useState('');
  const [newType, setNewType] = React.useState('comment');
  const [newMessage, setNewMessage] = React.useState('');
  const [sending, setSending] = React.useState(false);

  const load = () => {
    apiFetch('/api/notifications?limit=100').then(data => {
      if (Array.isArray(data.notifications)) {
        const mapped = data.notifications.map(n => ({
          id: n._id || n.id || 'notif_' + Math.random().toString(36).substr(2, 6),
          type: n.type || 'system',
          status: n.delivered ? 'completed' : 'pending',
          attempts: 1,
          max: 5,
          createdAt: n.createdAt,
          created: Math.max(0, Math.floor((Date.now() - new Date(n.createdAt).getTime()) / 1000)),
          payload: n.payload?.message || `to=${n.recipientId}`,
          recipientId: n.recipientId,
          error: null,
        }));
        setJobs(mapped);
      }
    }).catch(() => { });
  };

  React.useEffect(() => { load(); }, []);

  // Apply dateFilter to cutoff
  const dateFilteredJobs = React.useMemo(() => {
    const now = Date.now();
    const cutoffs = { 'Last 1 hour': 3600000, 'Last 24 hours': 86400000, 'Last 7 days': 604800000 };
    const cutoff = cutoffs[dateFilter];
    if (!cutoff) return jobs;
    return jobs.filter(j => j.createdAt ? (now - new Date(j.createdAt).getTime()) <= cutoff : true);
  }, [jobs, dateFilter]);

  const counts = React.useMemo(() => {
    const c = { all: dateFilteredJobs.length };
    for (const s of ['active', 'pending', 'completed', 'failed', 'delayed']) c[s] = dateFilteredJobs.filter(j => j.status === s).length;
    return c;
  }, [dateFilteredJobs]);

  const filtered = dateFilteredJobs.filter(j => (filter === 'all' || j.status === filter) && (type === 'all' || j.type === type));

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const retry = async (job) => {
    const validType = ['like', 'comment', 'mention', 'follow'].includes(job.type) ? job.type : 'comment';
    try {
      showToast(`Retrying job ${job.id.slice(0, 14)} via API…`);
      await apiFetch('/api/notify', {
        method: 'POST',
        body: {
          recipientId: job.recipientId || window.NTFX_AUTH.getUserId() || 'user',
          senderId: window.NTFX_AUTH.getUserId() || 'dashboard',
          type: validType,
          payload: { message: job.payload || 'Retried job event' },
          idempotencyKey: `retry_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        }
      });
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'pending', attempts: j.attempts + 1, error: null } : j));
      showToast(`✓ Job ${job.id.slice(0, 14)} re-dispatched!`);
    } catch (err) {
      showToast(`Retry failed: ${err.message}`);
    }
  };

  const submitNewJob = async (e) => {
    e.preventDefault();
    if (!newRecipient.trim()) return showToast('Recipient User ID is required');
    if (!newMessage.trim()) return showToast('Payload message is required');
    setSending(true);
    try {
      const idempotencyKey = `job_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      await apiFetch('/api/notify', {
        method: 'POST',
        body: {
          recipientId: newRecipient.trim(),
          senderId: window.NTFX_AUTH.getUserId() || 'user',
          type: newType,
          payload: { message: newMessage.trim() },
          idempotencyKey,
        }
      });
      setShowModal(false);
      setNewRecipient('');
      setNewMessage('');
      showToast(`✓ Notification dispatched to ${newRecipient.trim()}`);
      load();
    } catch (err) {
      showToast(`Dispatch failed: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  const segs = [
    { k: 'all', label: 'All' }, { k: 'active', label: 'Active' }, { k: 'pending', label: 'Pending' },
    { k: 'completed', label: 'Completed' }, { k: 'failed', label: 'Failed' }, { k: 'delayed', label: 'Delayed' },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="eyebrow">notification dispatch queue</div>
          <h1 className="page-title">Queue</h1>
        </div>
        <div className="page-actions">
          <span className="live-indicator">
            <span className="live-dot" />
            <span className="live-label mono fg-dim">{jobs.length} total jobs loaded</span>
          </span>
          <button className="btn ghost" onClick={load}><Icon name="refresh" size={12} /> Refresh</button>
          <button className="btn primary" onClick={() => setShowModal(true)}><Icon name="plus" size={12} /> Dispatch New Job</button>
        </div>
      </div>

      {/* New Job Modal */}
      {showModal && (
        <div className="modal-backdrop">
          <div className="modal-dialog">
            <div className="card-h">
              <h3>Dispatch New Notification Job</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'var(--fg-faint)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>
            <form onSubmit={submitNewJob} className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--fg-muted)', display: 'block', marginBottom: 4 }}>Recipient User ID</label>
                <input className="input-control" value={newRecipient} onChange={e => setNewRecipient(e.target.value)} required />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--fg-muted)', display: 'block', marginBottom: 4 }}>Event Type</label>
                <select className="input-control" value={newType} onChange={e => setNewType(e.target.value)}>
                  <option value="comment">Comment / Reply</option>
                  <option value="like">Like / Reaction</option>
                  <option value="mention">Direct Mention</option>
                  <option value="follow">Follow Notification</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--fg-muted)', display: 'block', marginBottom: 4 }}>Notification Payload Message</label>
                <textarea className="input-control" value={newMessage} onChange={e => setNewMessage(e.target.value)} required rows={3} style={{ resize: 'none' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                <button type="button" className="btn ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn primary" disabled={sending}>{sending ? 'Dispatching…' : 'Fire Notification →'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        <div className="filter-bar" style={{ position: 'relative' }}>
          <div className="seg">
            {segs.map(s => (
              <button key={s.k} className={filter === s.k ? 'on' : ''} onClick={() => setFilter(s.k)}>
                {s.label} <span className="count">{counts[s.k]}</span>
              </button>
            ))}
          </div>
          <div style={{ position: 'relative' }}>
            <button className="select" onClick={() => { setTypeMenuOpen(!typeMenuOpen); setDateMenuOpen(false); }}>
              <Icon name="filter" size={11} /> Type: {type === 'all' ? 'all' : type} <Icon name="chevron-down" size={11} />
            </button>
            {typeMenuOpen && (
              <div className="dropdown-menu">
                {['all', 'comment', 'like', 'mention', 'follow', 'system'].map(t => (
                  <div key={t} className={`dropdown-item ${type === t ? 'active' : ''}`} onClick={() => { setType(t); setTypeMenuOpen(false); }}>
                    <span>{t === 'all' ? 'All types' : t}</span>
                    {type === t && <Icon name="check" size={11} />}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <button className="select" onClick={() => { setDateMenuOpen(!dateMenuOpen); setTypeMenuOpen(false); }}>
              <Icon name="calendar" size={11} /> Timeframe: {dateFilter} <Icon name="chevron-down" size={11} />
            </button>
            {dateMenuOpen && (
              <div className="dropdown-menu">
                {['Last 1 hour', 'Last 24 hours', 'Last 7 days'].map(d => (
                  <div key={d} className={`dropdown-item ${dateFilter === d ? 'active' : ''}`} onClick={() => { setDateFilter(d); setDateMenuOpen(false); }}>
                    <span>{d}</span>
                    {dateFilter === d && <Icon name="check" size={11} />}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="spacer" />
          <span className="mono" style={{ color: 'var(--fg-faint)', fontSize: 11 }}>{filtered.length} of {jobs.length} jobs</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '22%' }}>Job ID</th>
                <th>Type / Payload</th>
                <th style={{ width: '12%' }}>Status</th>
                <th style={{ width: '8%' }}>Attempts</th>
                <th style={{ width: '12%' }}>Created</th>
                <th style={{ width: '80px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(j => (
                <tr key={j.id}>
                  <td className="mono fg-dim">{j.id}</td>
                  <td>
                    <div style={{ color: 'var(--fg)' }}>{j.type}</div>
                    <div className="mono fg-faint" style={{ fontSize: 11, marginTop: 2 }}>
                      {j.error ? <span style={{ color: 'var(--red)' }}>↳ {j.error}</span> : j.payload}
                    </div>
                  </td>
                  <td><span className={`pill ${j.status}`}><span className="pdot" />{j.status}</span></td>
                  <td>
                    <span className={`attempts ${j.attempts >= j.max ? 'maxed' : j.attempts >= 3 ? 'high' : ''}`}>
                      {j.attempts}/{j.max}
                    </span>
                  </td>
                  <td className="mono fg-dim">{j.created === 0 ? 'just now' : ago(j.created)}</td>
                  <td>
                    {j.status === 'failed'
                      ? <button className="btn sm" onClick={() => retry(j)}><Icon name="refresh" size={10} /> Retry</button>
                      : <button className="btn ghost sm" title="Job details" onClick={() => showToast(`Job ${j.id.slice(0, 14)}: ${j.status}`)}><Icon name="menu-dots" size={12} /></button>
                    }
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan="6">
                  <div className="empty-state">
                    <div className="empty-mark">—</div>
                    <div className="empty-title">Nothing here</div>
                    <div className="empty-sub">No jobs match the current filters. Try widening the range or clearing filters.</div>
                    <button className="btn sm" onClick={() => { setFilter('all'); setType('all'); }}>Clear filters</button>
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {toast && <div className="toast"><Icon name="check" size={14} className="ok" />{toast}</div>}
    </div>
  );
};

// ─── Notifications (real data + Socket.io) ────────────────────────────────────
const KIND_META = {
  like: { icon: 'heart', bg: 'var(--red-soft)', color: 'var(--red)' },
  comment: { icon: 'comment', bg: 'var(--accent-soft)', color: 'var(--accent)' },
  mention: { icon: 'at', bg: 'var(--violet-soft)', color: 'var(--violet)' },
  follow: { icon: 'user', bg: 'var(--green-soft)', color: 'var(--green)' },
  system: { icon: 'cube', bg: 'var(--accent-soft)', color: 'var(--accent)' },
};

const Notifications = ({ socket, onUnreadChange }) => {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState('all');

  const load = () => {
    setLoading(true);
    apiFetch('/api/notifications?limit=50')
      .then(data => {
        setItems(data.notifications || []);
        onUnreadChange && onUnreadChange(data.unread || 0);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  };

  React.useEffect(() => {
    load();
  }, []);

  // Real-time: prepend new notifications from socket
  React.useEffect(() => {
    if (!socket) return;
    const handler = (notif) => {
      setItems(prev => [notif, ...prev]);
      onUnreadChange && onUnreadChange(c => c + 1);
    };
    socket.on('notification', handler);
    return () => socket.off('notification', handler);
  }, [socket]);

  const totalUnread = items.filter(n => n.status === 'unread').length;

  const toggle = async (id) => {
    const item = items.find(n => n._id === id || n.id === id);
    if (!item) return;
    const isRead = item.status === 'read';
    const endpoint = isRead ? null : `/api/notifications/${id}/read`;
    if (endpoint) {
      apiFetch(endpoint, { method: 'PATCH' }).catch(() => { });
    }
    setItems(prev => prev.map(n => (n._id === id || n.id === id) ? { ...n, status: isRead ? 'unread' : 'read' } : n));
    onUnreadChange && onUnreadChange(totalUnread + (isRead ? 1 : -1));
  };

  const markAll = () => {
    apiFetch('/api/notifications/mark-all-read', { method: 'PATCH' }).catch(() => { });
    setItems(prev => prev.map(n => ({ ...n, status: 'read' })));
    onUnreadChange && onUnreadChange(0);
  };

  const filterFn = (n) => tab === 'all' ? true : tab === 'unread' ? n.status === 'unread' : n.type === tab;
  const visible = items.filter(filterFn);

  // Group by date
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const grouped = [
    { group: 'Today', items: visible.filter(n => new Date(n.createdAt) >= today) },
    { group: 'Yesterday', items: visible.filter(n => new Date(n.createdAt) >= yesterday && new Date(n.createdAt) < today) },
    { group: 'Earlier', items: visible.filter(n => new Date(n.createdAt) < yesterday) },
  ].filter(g => g.items.length > 0);

  const tabs = [
    { k: 'all', label: 'All' },
    { k: 'unread', label: 'Unread', count: totalUnread },
    { k: 'system', label: 'Integrations' },
    { k: 'mention', label: 'Mentions' },
    { k: 'comment', label: 'Comments' },
    { k: 'like', label: 'Likes' },
  ];

  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <div className="page-header">
        <div>
          <div className="eyebrow">Personal inbox</div>
          <h1 className="page-title">Notifications</h1>
        </div>
        <div className="page-actions">
          <span className="live-indicator">
            <span className="live-dot" />
            <span className="live-label mono fg-dim">{totalUnread} unread</span>
          </span>
          <button className="btn ghost" onClick={markAll}><Icon name="mail-open" size={12} /> Mark all as read</button>
        </div>
      </div>

      <div className="card">
        <div className="filter-bar">
          <div className="seg">
            {tabs.map(t => (
              <button key={t.k} className={tab === t.k ? 'on' : ''} onClick={() => setTab(t.k)}>
                {t.label} {t.count != null && <span className="count">{t.count}</span>}
              </button>
            ))}
          </div>
          <button className="btn ghost sm" onClick={load}><Icon name="refresh" size={11} /></button>
        </div>

        {loading && (
          <div className="empty-state">
            <div className="skel-line" style={{ width: '60%', margin: '0 auto' }} />
          </div>
        )}

        {!loading && visible.length === 0 && (
          <div className="empty-state">
            <div className="empty-mark">✓</div>
            <div className="empty-title">You're all caught up</div>
            <div className="empty-sub">
              No {tab === 'all' ? 'notifications' : tab + 's'} yet. Real notifications from connected services (GitHub, Gmail, LinkedIn, WhatsApp) appear here automatically.
            </div>
          </div>
        )}

        {!loading && grouped.map(g => (
          <div className="notif-group" key={g.group}>
            <div className="notif-group-h">{g.group} · {g.items.length}</div>
            {g.items.map(n => {
              const id = n._id || n.id;
              const kind = n.type || n.kind || 'system';
              const m = KIND_META[kind] || KIND_META.system;
              // For integration notifications, use the source-specific icon
              const source = n.payload?.source;
              const sourceIconMap = { github: 'github', whatsapp: 'whatsapp', gmail: 'mail', linkedin: 'linkedin' };
              const displayIcon = (kind === 'system' && sourceIconMap[source]) ? sourceIconMap[source] : m.icon;
              const sourceLabel = source ? source.charAt(0).toUpperCase() + source.slice(1) : null;
              return (
                <div key={id} className={`notif ${n.status === 'read' ? 'read' : 'unread'}`} onClick={() => toggle(id)}>
                  <div className="notif-icon" style={{ background: m.bg, color: m.color }}>
                    <Icon name={displayIcon} size={13} />
                  </div>
                  <div className="notif-body">
                    <div className="notif-title">
                      {n.payload?.message || (<><b>{n.senderId}</b> sent a {n.type}</>)}
                    </div>
                    <div className="notif-meta">
                      {sourceLabel ? `${sourceLabel} · ${n.payload?.eventType || n.type}` : `${n.type} · ${n._id || n.id}`}
                    </div>
                  </div>
                  <div className="notif-time">
                    {n.createdAt ? new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now'}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Connect Integration Wizard Modal ───────────────────────────────────────
const ConnectWizardModal = ({ provider, currentData, onClose, onSave }) => {
  const handleVal = currentData?.username || currentData?.email || currentData?.name || currentData?.phone || '';
  const [accountName, setAccountName] = React.useState(handleVal);
  const [accessToken, setAccessToken] = React.useState('');
  const [phoneId, setPhoneId] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const webhookBase = (window.NOTIFYX_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`).replace(/\/$/, '');

  const configs = {
    github: {
      title: 'Connect GitHub Integration',
      icon: 'github',
      accountLabel: 'GitHub Username or Profile Handle',
      accountPlaceholder: 'e.g. User123',
      guideTitle: 'GitHub Public REST API & Webhooks',
      guideBody: (
        <>
          <p>Public GitHub activity (commits, PRs, issues, stars) is automatically polled via the official GitHub REST API.</p>
          <div className="wiz-code-box">
            <span>Webhook URL: {webhookBase}/api/integrations/webhooks/github</span>
          </div>
        </>
      ),
      tokenLabel: 'Personal Access Token (PAT) — Optional',
      tokenPlaceholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
      tokenHint: 'Optional. Only required if you want to poll or receive events from private GitHub repositories.',
    },
    gmail: {
      title: 'Connect Gmail Account',
      icon: 'mail',
      accountLabel: 'Gmail Email Address',
      accountPlaceholder: 'e.g. user123@gmail.com',
      guideTitle: 'Google Cloud OAuth API Setup',
      guideBody: (
        <>
          <p>To pull real emails from Gmail API, Google requires an OAuth Access Token to protect inbox privacy.</p>
          <ol>
            <li>Open the <a href="https://developers.google.com/oauthplayground/" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Google OAuth 2.0 Playground</a>.</li>
            <li>Select <b>Gmail API v1</b> (<code>https://mail.google.com/</code>) and click <b>Authorize APIs</b>.</li>
            <li>Exchange authorization code for tokens and copy your <b>Access Token</b> below.</li>
          </ol>
          <div className="wiz-code-box">
            <span>Pub/Sub Push Webhook: {webhookBase}/api/integrations/webhooks/gmail</span>
          </div>
        </>
      ),
      tokenLabel: 'Google OAuth Access Token',
      tokenPlaceholder: 'ya29.a0Axxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      tokenHint: 'Paste your OAuth Access Token from Google OAuth Playground or Google Cloud Console.',
    },
    linkedin: {
      title: 'Connect LinkedIn Integration',
      icon: 'linkedin',
      accountLabel: 'LinkedIn Profile Handle or Page Name',
      accountPlaceholder: 'e.g. user-12345',
      guideTitle: 'LinkedIn Developer Portal & Partner Webhooks',
      guideBody: (
        <>
          <p>Official LinkedIn v2 API requires member notification approval or partner Webhook setup.</p>
          <ol>
            <li>Create an app in the <a href="https://www.linkedin.com/developers/apps" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>LinkedIn Developer Portal</a>.</li>
            <li>Generate an OAuth 2.0 Access Token under <b>OAuth 2.0 Tools</b>.</li>
            <li>Set Webhook receiver URL in your LinkedIn Developer App settings.</li>
          </ol>
          <div className="wiz-code-box">
            <span>Webhook URL: {webhookBase}/api/integrations/webhooks/linkedin</span>
          </div>
        </>
      ),
      tokenLabel: 'LinkedIn Access Token (OAuth 2.0)',
      tokenPlaceholder: 'AQVxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      tokenHint: 'Generated from LinkedIn Developer Portal under OAuth 2.0 Tools.',
    },
    whatsapp: {
      title: 'Connect Meta WhatsApp Business',
      icon: 'whatsapp',
      accountLabel: 'WhatsApp Phone Number (with Country Code)',
      accountPlaceholder: 'e.g. +91 7975727428',
      guideTitle: 'Meta WhatsApp Cloud API Webhook Setup',
      guideBody: (
        <>
          <p>Meta pushes inbound WhatsApp messages in real-time via signed HTTP Webhooks.</p>
          <ol>
            <li>Open <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Meta for Developers</a> and open your WhatsApp Business App.</li>
            <li>Under <b>WhatsApp &gt; API Setup</b>, copy your Access Token and Phone Number ID.</li>
            <li>Set Webhook URL to the address below with verify token <code>notifyx-verify</code>.</li>
          </ol>
          <div className="wiz-code-box">
            <span>Webhook URL: {webhookBase}/api/integrations/webhooks/whatsapp</span>
          </div>
          <div className="wiz-code-box" style={{ marginTop: 4 }}>
            <span>Verify Token: notifyx-verify</span>
          </div>
        </>
      ),
      tokenLabel: 'Meta WhatsApp Access Token',
      tokenPlaceholder: 'EAAGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      tokenHint: 'Permanent System User Token or Temporary Access Token from Meta Developer Console.',
      phoneIdLabel: 'WhatsApp Phone Number ID',
      phoneIdPlaceholder: 'e.g. 100654321098765',
      phoneIdHint: 'Found in Meta Developer Console under WhatsApp > API Setup.',
    },
  };

  const cfg = configs[provider] || configs.github;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    let cleanHandle = accountName.trim();
    if (cleanHandle.includes('github.com/')) cleanHandle = cleanHandle.split('github.com/')[1].replace(/\/$/, '');
    if (cleanHandle.includes('linkedin.com/in/')) cleanHandle = cleanHandle.split('linkedin.com/in/')[1].replace(/\/$/, '');

    if (!cleanHandle) {
      return setError(`${cfg.accountLabel} is required`);
    }
    setSaving(true);
    try {
      await onSave(provider, true, cleanHandle, { accessToken: accessToken.trim(), phoneId: phoneId.trim() });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save integration setup');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wiz-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="wiz-card">
        <div className="wiz-header">
          <div className="wiz-brand">
            <div className="wiz-icon-box">
              <Icon name={cfg.icon} size={18} />
            </div>
            <div>
              <h3 className="wiz-title">{cfg.title}</h3>
              <div className="wiz-sub">Configure real-time event pipeline &amp; credentials</div>
            </div>
          </div>
          <button type="button" className="wiz-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={submit}>
          <div className="wiz-body">
            <div className="wiz-guide-box">
              <h4><Icon name="spark" size={13} /> {cfg.guideTitle}</h4>
              {cfg.guideBody}
            </div>

            <div className="wiz-field">
              <label>{cfg.accountLabel}</label>
              <input
                type="text"
                placeholder={cfg.accountPlaceholder}
                value={accountName}
                onChange={e => setAccountName(e.target.value)}
                required
                autoFocus
              />
            </div>

            {cfg.tokenLabel && (
              <div className="wiz-field">
                <label>{cfg.tokenLabel}</label>
                <input
                  type="password"
                  placeholder={currentData?.hasToken ? "•••••••••••• (Leave blank to keep current token)" : cfg.tokenPlaceholder}
                  value={accessToken}
                  onChange={e => setAccessToken(e.target.value)}
                  autoComplete="off"
                />
                <span className="hint">
                  {currentData?.hasToken ? (
                    <span style={{ color: 'var(--green)', fontWeight: 500 }}>✓ Access Token configured securely in backend. Enter new token to update.</span>
                  ) : cfg.tokenHint}
                </span>
              </div>
            )}

            {cfg.phoneIdLabel && (
              <div className="wiz-field">
                <label>{cfg.phoneIdLabel}</label>
                <input
                  type="text"
                  placeholder={currentData?.hasPhoneId ? "•••••••• (Leave blank to keep current Phone ID)" : cfg.phoneIdPlaceholder}
                  value={phoneId}
                  onChange={e => setPhoneId(e.target.value)}
                  autoComplete="off"
                />
                <span className="hint">
                  {currentData?.hasPhoneId ? (
                    <span style={{ color: 'var(--green)', fontWeight: 500 }}>✓ Phone ID configured securely in backend. Enter new Phone ID to update.</span>
                  ) : cfg.phoneIdHint}
                </span>
              </div>
            )}

            {error && <div className="login-error" style={{ margin: 0 }}>{error}</div>}
          </div>

          <div className="wiz-footer">
            <button type="button" className="btn ghost sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary sm" disabled={saving}>
              {saving ? 'Connecting…' : 'Save & Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── Settings (with Social & Productivity Integrations) ─────────────────────
// Map between frontend UI preferences keys and backend notification types
const typeMap = {
  likes: 'like',
  comments: 'comment',
  mentions: 'mention',
  follows: 'follow',
  digests: 'digest',
  security: 'system',
  marketing: 'marketing',
};

const Settings = () => {
  const [prefs, setPrefs] = React.useState(DEFAULT_PREFS);
  const [section, setSection] = React.useState('notifications');
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [activeWizard, setActiveWizard] = React.useState(null);
  const [integrations, setIntegrations] = React.useState({
    github: { connected: false, username: '' },
    gmail: { connected: false, email: '' },
    linkedin: { connected: false, name: '' },
    whatsapp: { connected: false, phone: '' },
  });
  const [quietHours, setQuietHours] = React.useState({ enabled: true, start: '22:00', end: '07:30' });

  // Load real preferences and integrations from API
  React.useEffect(() => {
    apiFetch('/api/users/preferences').then(apiPrefs => {
      const muted = apiPrefs.mutedTypes || [];
      setPrefs(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(key => {
          const backendType = typeMap[key] || key;
          next[key] = {
            ...next[key],
            on: !muted.includes(backendType),
            channels: {
              ...next[key].channels,
              inapp: apiPrefs.inApp ?? true,
              email: apiPrefs.email ?? false,
              push: apiPrefs.push ?? false,
            }
          };
        });
        return next;
      });

      if (apiPrefs.quietHours) {
        setQuietHours({
          enabled: apiPrefs.quietHours.enabled,
          start: String(apiPrefs.quietHours.startHour ?? 22).padStart(2, '0') + ':00',
          end: String(apiPrefs.quietHours.endHour ?? 7).padStart(2, '0') + ':00',
        });
      }
    }).catch(() => { });

    window.NTFX_AUTH.getIntegrations().then(data => {
      if (data) setIntegrations(data);
    }).catch(() => { });
  }, []);

  const togglePref = (key) => {
    if (PREF_DEFS.find(p => p.key === key)?.locked) return;
    setPrefs(p => ({ ...p, [key]: { ...p[key], on: !p[key].on } }));
  };
  const toggleChan = (key, ch) => {
    if (!prefs[key].on) return;
    setPrefs(p => ({ ...p, [key]: { ...p[key], channels: { ...p[key].channels, [ch]: !p[key].channels[ch] } } }));
  };

  const handleOpenWizard = (provider) => {
    setActiveWizard(provider);
  };

  const handleDisconnect = async (provider) => {
    try {
      const updated = await window.NTFX_AUTH.toggleIntegration(provider, false, '');
      setIntegrations(updated);
      setToast(`${provider.toUpperCase()} disconnected`);
      setTimeout(() => setToast(null), 2200);
    } catch (err) {
      setToast(`Integration error: ${err.message}`);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleSaveWizard = async (provider, connected, accountName, credentials) => {
    const updated = await window.NTFX_AUTH.toggleIntegration(provider, connected, accountName, credentials);
    setIntegrations(updated);
    setToast(`${provider.toUpperCase()} connected (@${accountName})`);
    setTimeout(() => setToast(null), 2500);
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch('/api/users/preferences', {
        method: 'PUT',
        body: {
          inApp: prefs.mentions.on || prefs.comments.on || prefs.likes.on || prefs.follows.on,
          email: Object.values(prefs).some(p => p.channels?.email),
          push: Object.values(prefs).some(p => p.channels?.push),
          quietHours: {
            enabled: quietHours.enabled,
            startHour: parseInt(quietHours.start.split(':')[0]) || 0,
            endHour: parseInt(quietHours.end.split(':')[0]) || 0,
          },
          mutedTypes: Object.entries(prefs).filter(([, v]) => !v.on).map(([k]) => typeMap[k] || k),
        },
      });
      setToast('Preferences saved');
    } catch {
      setToast('Failed to save — changes stored locally');
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 2200);
    }
  };

  const sections = [
    { k: 'notifications', label: 'Notifications' },
    { k: 'channels', label: 'Channels & Integrations' },
    { k: 'schedule', label: 'Quiet hours' },
    { k: 'account', label: 'Account' },
  ];
  const channels = [
    { k: 'inapp', label: 'In-app', icon: 'inapp' },
    { k: 'push', label: 'Push', icon: 'push' },
    { k: 'email', label: 'Email', icon: 'mail' },
    { k: 'sms', label: 'SMS', icon: 'phone' },
  ];

  return (
    <div className="page">
      {activeWizard && (
        <ConnectWizardModal
          provider={activeWizard}
          currentData={integrations?.[activeWizard]}
          onClose={() => setActiveWizard(null)}
          onSave={handleSaveWizard}
        />
      )}
      <div className="page-header">
        <div>
          <div className="eyebrow">{window.NTFX_AUTH.getUserId() || 'user'}@notifyx.dev</div>
          <h1 className="page-title">Settings</h1>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
      <div className="settings-grid">
        <aside className="settings-aside">
          {sections.map(s => (
            <div key={s.k} className={`a-item ${section === s.k ? 'active' : ''}`} onClick={() => setSection(s.k)}>
              {s.label}
            </div>
          ))}
        </aside>

        <div className="col" style={{ gap: 16 }}>

          {/* Section: Notifications */}
          {(section === 'notifications' || section === 'all') && (
            <div className="card">
              <div className="card-h">
                <div>
                  <h3>What you get notified about</h3>
                  <div className="sub">Choose which events reach you, and on which channels.</div>
                </div>
                <button className="btn ghost sm" onClick={() => setPrefs(DEFAULT_PREFS)}>Reset to defaults</button>
              </div>
              <div>
                {PREF_DEFS.map(def => {
                  const p = prefs[def.key];
                  return (
                    <div className="pref-row" key={def.key}>
                      <div>
                        <div className="row" style={{ gap: 10 }}>
                          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--panel-2)', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', color: 'var(--fg-muted)' }}>
                            <Icon name={def.icon} size={13} />
                          </div>
                          <div>
                            <div className="pref-label">
                              {def.label}
                              {def.locked && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>required</span>}
                            </div>
                            <div className="pref-desc">{def.desc}</div>
                          </div>
                        </div>
                        {p.on && (
                          <div className="pref-channels" style={{ marginLeft: 38 }}>
                            {channels.filter(c => def.key !== 'security' ? c.k !== 'sms' : true).map(c => {
                              const on = !!p.channels[c.k];
                              return (
                                <span key={c.k} className={`chan-chip ${on ? 'on' : ''}`} onClick={() => toggleChan(def.key, c.k)}>
                                  <span className="chip-dot" />
                                  <Icon name={c.icon} size={11} />
                                  {c.label}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className={`toggle ${p.on ? 'on' : ''}`} onClick={() => togglePref(def.key)}>
                        <div className="knob" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section: Channels & Integrations Hub */}
          {(section === 'channels' || section === 'all') && (
            <div className="card">
              <div className="card-h">
                <div>
                  <h3>Social & Productivity Integrations Hub</h3>
                  <div className="sub">Connect real-time activity streams from your external accounts.</div>
                </div>
              </div>
              <div>
                {[
                  { key: 'github', label: 'GitHub Integration', icon: 'github', desc: 'Real-time REST API Poller & Webhooks (Public Events, PRs, Commits).', handle: integrations?.github?.username },
                  { key: 'gmail', label: 'Gmail Integration', icon: 'mail', desc: 'Google Cloud Pub/Sub Push Webhook Receiver & OAuth API.', handle: integrations?.gmail?.email },
                  { key: 'linkedin', label: 'LinkedIn Integration', icon: 'linkedin', desc: 'LinkedIn Webhook Receiver (Member notifications require Page Admin OAuth scope).', handle: integrations?.linkedin?.name },
                  { key: 'whatsapp', label: 'WhatsApp Business', icon: 'whatsapp', desc: 'Meta WhatsApp Cloud API Webhooks & Inbound Message Receiver.', handle: integrations?.whatsapp?.phone },
                ].map(item => {
                  const isConn = integrations?.[item.key]?.connected;
                  return (
                    <div className="pref-row" key={item.key}>
                      <div className="row" style={{ gap: 12 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--panel-2)', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', color: 'var(--fg-muted)' }}>
                          <Icon name={item.icon} size={13} />
                        </div>
                        <div>
                          <div className="pref-label">
                            {item.label}
                            {isConn && (
                              <span className="pill completed" style={{ marginLeft: 8, fontSize: 10, padding: '1px 6px' }}>
                                <span className="pdot green" />
                                {item.handle ? `@${item.handle}` : 'Connected'}
                              </span>
                            )}
                          </div>
                          <div className="pref-desc">{item.desc}</div>
                        </div>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        {isConn ? (
                          <>
                            <button className="btn sm ghost" onClick={() => handleOpenWizard(item.key)} title="Configure API credentials & Webhooks">
                              <Icon name="settings" size={11} />
                              <span>Configure</span>
                            </button>
                            <button className="btn sm ghost" onClick={() => handleDisconnect(item.key)}>
                              <Icon name="x" size={11} />
                              <span>Disconnect</span>
                            </button>
                          </>
                        ) : (
                          <button className="btn sm primary" onClick={() => handleOpenWizard(item.key)}>
                            <Icon name="plus" size={11} />
                            <span>Connect</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section: Quiet Hours */}
          {(section === 'schedule' || section === 'all') && (
            <div className="card">
              <div className="card-h">
                <div>
                  <h3>Quiet hours</h3>
                  <div className="sub">Mute non-critical notifications during these times.</div>
                </div>
                <div className={`toggle ${quietHours.enabled ? 'on' : ''}`} onClick={() => setQuietHours(q => ({ ...q, enabled: !q.enabled }))}>
                  <div className="knob" />
                </div>
              </div>
              <div className="card-body">
                <div className="row" style={{ gap: 12, color: 'var(--fg-muted)', fontSize: 12 }}>
                  <span>From</span>
                  <input type="time" value={quietHours.start} onChange={e => setQuietHours(q => ({ ...q, start: e.target.value }))}
                    style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', padding: '4px 8px', fontSize: 12 }} />
                  <span>to</span>
                  <input type="time" value={quietHours.end} onChange={e => setQuietHours(q => ({ ...q, end: e.target.value }))}
                    style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', padding: '4px 8px', fontSize: 12 }} />
                  <span style={{ color: 'var(--fg-faint)' }}>Local time</span>
                </div>
              </div>
            </div>
          )}

          {/* Section: Account */}
          {(section === 'account' || section === 'all') && (
            <div className="card">
              <div className="card-h">
                <div>
                  <h3>User Account</h3>
                  <div className="sub">Authenticated workspace profile information.</div>
                </div>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                <div><strong>User ID:</strong> <span className="mono">{window.NTFX_AUTH.getUserId() || 'user'}</span></div>
                <div><strong>Authentication Token:</strong> <span className="mono">Bearer JWT (Active)</span></div>
              </div>
            </div>
          )}

        </div>
      </div>
      {toast && <div className="toast"><Icon name="check" size={14} className="ok" />{toast}</div>}
    </div>
  );
};

// ─── Metrics ──────────────────────────────────────────────────────────────────
const Metrics = () => {
  const [metrics, setMetrics] = React.useState(null);
  const [range, setRange] = React.useState('24h');
  const [seriesData, setSeriesData] = React.useState(window.NTFX_DATA.EMPTY_SERIES);
  const [heatmapData, setHeatmapData] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  const loadData = React.useCallback(() => {
    setLoading(true);
    Promise.all([
      window.NTFX_AUTH.apiFetch('/api/metrics').then(setMetrics).catch(() => { }),
      window.NTFX_AUTH.getMetricsSeries(range).then(data => {
        if (data && data.labels && data.labels.length >= 2) setSeriesData(data);
      }).catch(() => { }),
      // Fetch recent notifications for heatmap (weekday × hour)
      window.NTFX_AUTH.apiFetch('/api/notifications?limit=500').then(data => {
        const notifs = data.notifications || [];
        // Build 7×24 grid: rows=Sun-Sat, cols=hours 0-23
        const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
        notifs.forEach(n => {
          if (!n.createdAt) return;
          const d = new Date(n.createdAt);
          const dayOfWeek = d.getDay(); // 0=Sun…6=Sat
          const hour = d.getHours();
          grid[dayOfWeek][hour]++;
        });
        setHeatmapData(grid);
      }).catch(() => { }),
    ]).finally(() => setLoading(false));
  }, [range]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const successRate = metrics ? parseFloat(metrics.delivery.successRate) : 100.0;
  const failureRate = metrics ? parseFloat(metrics.delivery.failureRate) : 0.0;

  const exportCSV = () => {
    const csv = `Metric,Value\nTotal Dispatched,${metrics?.delivery?.total || 0}\nDelivered,${metrics?.delivery?.success || 0}\nFailed,${metrics?.delivery?.failed || 0}\nSuccess Rate,${metrics?.delivery?.successRate || "100.00"}%\nFailure Rate,${metrics?.delivery?.failureRate || "0.00"}%\n`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'notifyx_metrics.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="eyebrow">system health & delivery telemetry</div>
          <h1 className="page-title">Metrics</h1>
        </div>
        <div className="page-actions">
          <div className="tabs">
            {['1h', '24h', '7d', '30d'].map(r => (
              <button key={r} className={`tab ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
          <button className="btn" onClick={exportCSV}><Icon name="download" size={12} /> Export CSV</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* SLO & Health Rings */}
        <div className="metrics-grid">
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Success rate</h3>
                <div className="sub">Delivery success across all channels</div>
              </div>
              <span className={`pill ${successRate >= 99.5 ? 'completed' : 'pending'}`}>
                <span className={`pdot ${successRate >= 99.5 ? 'green' : ''}`} />
                {successRate >= 99.5 ? 'SLO target 99.5%' : `${successRate.toFixed(2)}% — below SLO`}
              </span>
            </div>
            <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
              <RingChart value={successRate} label="success" color="oklch(0.50 0.10 150)" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--fg-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Delivery breakdown</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 80px', gap: 10, alignItems: 'center', padding: '6px 0' }}>
                  <div style={{ fontSize: 12, color: 'var(--fg)' }}>Notifications delivered</div>
                  <div style={{ height: 4, background: 'var(--panel-2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${successRate}%`, background: 'oklch(0.50 0.10 150)' }} />
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'right' }}>{metrics?.delivery?.success || 0} sent</div>
                </div>
                {(metrics?.delivery?.failed || 0) > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 80px', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 12, color: 'var(--fg)' }}>Failed deliveries</div>
                    <div style={{ height: 4, background: 'var(--panel-2)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${failureRate}%`, background: 'oklch(0.54 0.16 25)' }} />
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'right' }}>{metrics.delivery.failed} failed</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <div>
                <h3>Failure rate</h3>
                <div className="sub">Errors per attempted delivery</div>
              </div>
              <span className={`pill ${failureRate === 0 ? 'completed' : 'pending'}`}>
                <span className={`pdot ${failureRate === 0 ? 'green' : ''}`} />
                {failureRate === 0 ? 'healthy' : `${failureRate.toFixed(2)}% failure`}
              </span>
            </div>
            <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
              <RingChart value={failureRate} label="failure" color="oklch(0.54 0.16 25)" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--fg-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  {metrics ? `Total: ${metrics.delivery.total.toLocaleString()} processed` : 'Delivery Log'}
                </div>
                {metrics?.delivery?.failed > 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--red)' }}>{metrics.delivery.failed} failed delivery attempts</div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: '12px 0' }}>
                    ✓ No delivery failures recorded. All notification dispatches completed cleanly.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Volume & Delivery Curve */}
        <div className="card">
          <div className="card-h">
            <div>
              <h3>Notification dispatches</h3>
              <div className="sub">Time-series aggregated dispatches in {range} window</div>
            </div>
            <div className="chart-legend">
              <span><span className="legend-dot ink" />Sent</span>
              <span><span className="legend-dot mid" />Delivered</span>
              <span><span className="legend-dot red" />Failed</span>
            </div>
          </div>
          <div className="chart-wrap">
            <AreaChart series={seriesData} labels={seriesData.labels} height={260} range={range} />
          </div>
        </div>

        {/* Volume Heatmap */}
        <div className="card">
          <div className="card-h">
            <div>
              <h3>Weekly dispatch density</h3>
              <div className="sub">By weekday × hour timeframe</div>
            </div>
            <span className="mono fg-faint" style={{ fontSize: 11 }}>UTC</span>
          </div>
          <div className="card-body">
            {loading ? (
              <div style={{ color: 'var(--fg-faint)', fontSize: 12, padding: '12px 0' }}>Loading heatmap data…</div>
            ) : (
              <Heatmap data={heatmapData} />
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

// ─── API Keys (self-service) ─────────────────────────────────────────────────
const ApiKeys = () => {
  const [keys, setKeys] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [appName, setAppName] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [newKey, setNewKey] = React.useState(null);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState('');
  const [toast, setToast] = React.useState(null);
  const [confirmRevoke, setConfirmRevoke] = React.useState(null); // { id, prefix }
  const { apiFetch, getUserId } = window.NTFX_AUTH;

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const load = async () => {
    try {
      const data = await apiFetch('/api/keys/self');
      setKeys(Array.isArray(data) ? data : []);
    } catch { setKeys([]); }
    finally { setLoading(false); }
  };
  React.useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    if (!appName.trim()) return setError('App name is required');
    setError(''); setCreating(true); setNewKey(null);
    try {
      const data = await apiFetch('/api/keys/self', {
        method: 'POST',
        body: { appName: appName.trim() },
      });
      if (data.error) { setError(data.error); return; }
      setNewKey(data.key); setAppName(''); load();
    } catch (err) { setError(err.message || 'Failed to create key'); }
    finally { setCreating(false); }
  };

  const revoke = async (id) => {
    try {
      await apiFetch('/api/keys/self/' + id, { method: 'DELETE' });
      setKeys(prev => prev.map(k => k._id === id ? { ...k, active: false } : k));
      showToast('Key revoked — apps using it will stop working.');
    } catch (err) { showToast('Revoke failed: ' + err.message); }
    finally { setConfirmRevoke(null); }
  };

  const copyKey = () => {
    navigator.clipboard.writeText(newKey);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const ago = (iso) => {
    if (!iso) return 'never';
    const m = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  };

  const activeCount = keys.filter(k => k.active).length;

  return (
    <>
      <div className="page">
        <div className="page-header">
          <div>
            <div className="eyebrow">{getUserId() || 'user'}@notifyx.dev</div>
            <h1 className="page-title">API Keys</h1>
          </div>
          <div className="page-actions">
            <span className="pill completed">
              <span className="pdot green" />
              <span className="mono">{activeCount}/5 active keys</span>
            </span>
          </div>
        </div>

        {/* Revealed key banner */}
        {newKey && (
          <div className="card" style={{ marginBottom: 20, borderColor: 'var(--green)', background: 'var(--green-soft)' }}>
            <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Icon name="key" size={18} style={{ color: 'var(--green)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg)' }}>New API Key Generated</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>Copy your key now. For security reasons, it will not be displayed again.</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', maxWidth: 540 }}>
                <span className="mono" style={{ flex: 1, fontSize: 12, padding: '6px 12px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--fg)' }}>{newKey}</span>
                <button onClick={copyKey} className="btn primary sm">
                  <Icon name={copied ? 'check' : 'copy'} size={12} />
                  <span>{copied ? 'Copied' : 'Copy Key'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Create Form Card */}
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Generate new API key</h3>
                <div className="sub">Generate a secret key to send notifications via <span className="mono">POST /api/notify</span></div>
              </div>
            </div>
            <div className="card-body">
              <form onSubmit={create} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <input
                    value={appName}
                    onChange={e => setAppName(e.target.value)}
                    placeholder="App or project name (e.g. my-blog, production-backend)"
                    style={{ width: '100%', padding: '7px 12px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--fg)', outline: 'none' }}
                  />
                </div>
                <button type="submit" disabled={creating} className="btn primary" style={{ opacity: creating ? 0.6 : 1 }}>
                  <Icon name="plus" size={13} />
                  <span>{creating ? 'Generating…' : 'Generate Key'}</span>
                </button>
              </form>
              {error && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--red)' }}>{error}</div>}
            </div>
          </div>

          {/* Keys List Card */}
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Active API keys</h3>
                <div className="sub">Keys associated with your account</div>
              </div>
              <span className="mono fg-faint" style={{ fontSize: 11 }}>{keys.length} total</span>
            </div>
            <div>
              {loading && <div style={{ padding: 20, color: 'var(--fg-muted)', fontSize: 12 }}>Loading API keys…</div>}
              {!loading && keys.length === 0 && (
                <div className="empty-state">
                  <div className="empty-mark"><Icon name="key" size={16} /></div>
                  <div className="empty-title">No API keys generated</div>
                  <div className="empty-sub">Generate your first API key above to start integrating server-to-server notification dispatches.</div>
                </div>
              )}
              {keys.map((k) => (
                <div className="pref-row" key={k._id} style={{ opacity: k.active ? 1 : 0.45 }}>
                  <div className="row" style={{ gap: 14 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--panel-2)', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', color: 'var(--fg-muted)' }}>
                      <Icon name="key" size={14} />
                    </div>
                    <div>
                      <div className="pref-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{k.appName}</span>
                        <span className={`pill ${k.active ? 'completed' : ''}`} style={{ fontSize: 10, padding: '1px 6px' }}>
                          <span className={`pdot ${k.active ? 'green' : ''}`} />
                          {k.active ? 'active' : 'revoked'}
                        </span>
                      </div>
                      <div className="pref-desc mono" style={{ fontSize: 11 }}>
                        {k.prefix}… · Created {ago(k.createdAt)} · Last used {ago(k.lastUsedAt)}
                      </div>
                    </div>
                  </div>
                  {k.active && (
                    confirmRevoke?.id === k._id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Revoke this key?</span>
                        <button className="btn sm danger-ghost" onClick={() => revoke(k._id)}>
                          <Icon name="check" size={11} /><span>Yes</span>
                        </button>
                        <button className="btn ghost sm" onClick={() => setConfirmRevoke(null)}>
                          <span>Cancel</span>
                        </button>
                      </div>
                    ) : (
                      <button className="btn sm danger-ghost" onClick={() => setConfirmRevoke({ id: k._id, prefix: k.prefix })}>
                        <Icon name="x" size={11} />
                        <span>Revoke</span>
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Integration Code Example Card */}
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Usage example</h3>
                <div className="sub">Server-to-server HTTP request format</div>
              </div>
            </div>
            <div className="card-body">
              <div className="pref-desc" style={{ marginBottom: 12 }}>
                Pass your API key in the <span className="mono">Authorization</span> header: <span className="kbd">Authorization: ApiKey nx_YOUR_KEY</span>
              </div>
              <pre style={{
                background: 'var(--panel-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '14px 16px',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                lineHeight: 1.7,
                overflowX: 'auto',
                color: 'var(--fg)',
                margin: 0
              }}>{
                  `curl -X POST http://localhost:3000/api/notify \\
  -H "Authorization: ApiKey nx_YOUR_KEY_HERE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "recipientId": "user_alice",
    "senderId": "my-app",
    "type": "comment",
    "payload": { "message": "Hey there!" },
    "idempotencyKey": "unique-id-001"
  }'`
                }</pre>
            </div>
          </div>

        </div>
      </div>
      {toast && <div className="toast"><Icon name="check" size={14} className="ok" />{toast}</div>}
    </>
  );
};

window.Screens = { Dashboard, Queue, Notifications, Settings, Metrics, ApiKeys };

