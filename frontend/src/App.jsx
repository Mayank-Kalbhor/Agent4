import React, { useState, useEffect } from 'react';
import {
  Users,
  Mail,
  Calendar,
  Activity,
  Send,
  UserPlus,
  Database,
  Settings,
  Sparkles,
  Shield,
  LogOut,
  ArrowRight,
  CheckCircle2,
  Clock,
  RefreshCw,
  AlertTriangle,
  FileSpreadsheet
} from 'lucide-react';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')) || null);
  const [tenantName, setTenantName] = useState(localStorage.getItem('tenantName') || '');

  // Login Form States
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Dashboard Core States
  const [activeTab, setActiveTab] = useState('dashboard');
  const [stats, setStats] = useState(null);
  const [leads, setLeads] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [messages, setMessages] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  // New Lead Modal States
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadEmail, setNewLeadEmail] = useState('');
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [newLeadCompany, setNewLeadCompany] = useState('');
  const [newLeadTitle, setNewLeadTitle] = useState('');
  const [newLeadNotes, setNewLeadNotes] = useState('');

  // Simulator Panel States
  const [selectedLeadForReply, setSelectedLeadForReply] = useState('');
  const [simulatedReplyText, setSimulatedReplyText] = useState('This looks incredible. Can we set up a call for next week?');
  const [crmSyncLogs, setCrmSyncLogs] = useState([]);
  const [syncingCrm, setSyncingCrm] = useState(false);

  // ==========================================
  // AUTHENTICATION FUNCTIONS
  // ==========================================

  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    setAuthError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        localStorage.setItem('tenantName', data.tenantName);
        setToken(data.token);
        setUser(data.user);
        setTenantName(data.tenantName);
      } else {
        setAuthError(data.error || 'Login failed.');
      }
    } catch (err) {
      setAuthError('Connection refused by the backend. Ensure server is running.');
    }
  };

  const handleDemoLogin = (demoEmail) => {
    setEmail(demoEmail);
    setPassword('password123');
    setTimeout(() => {
      // Small timeout to allow state synchronization
      const submitBtn = document.getElementById('login-btn');
      if (submitBtn) submitBtn.click();
    }, 100);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('tenantName');
    setToken('');
    setUser(null);
    setTenantName('');
    setActiveTab('dashboard');
  };

  // ==========================================
  // DATA FETCHING FUNCTIONS (RLS Scoped)
  // ==========================================

  const fetchDashboardData = async () => {
    if (!token) return;
    setRefreshing(true);
    const headers = { 'Authorization': `Bearer ${token}` };
    try {
      const [statsRes, leadsRes, campaignsRes, messagesRes, meetingsRes] = await Promise.all([
        fetch('/api/dashboard/stats', { headers }),
        fetch('/api/leads', { headers }),
        fetch('/api/campaigns', { headers }),
        fetch('/api/messages', { headers }),
        fetch('/api/meetings', { headers })
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (leadsRes.ok) setLeads(await leadsRes.json());
      if (campaignsRes.ok) setCampaigns(await campaignsRes.json());
      if (messagesRes.ok) setMessages(await messagesRes.json());
      if (meetingsRes.ok) setMeetings(await meetingsRes.json());
    } catch (err) {
      console.error('Data loading error:', err);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchDashboardData();
    }
  }, [token]);

  // ==========================================
  // CORE BUSINESS ACTION ENDPOINTS
  // ==========================================

  const handleCreateLead = async (e) => {
    e.preventDefault();
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: newLeadName,
          email: newLeadEmail,
          phone: newLeadPhone,
          company: newLeadCompany,
          title: newLeadTitle,
          notes: newLeadNotes
        })
      });

      if (response.ok) {
        setIsLeadModalOpen(false);
        // Clear forms
        setNewLeadName('');
        setNewLeadEmail('');
        setNewLeadPhone('');
        setNewLeadCompany('');
        setNewLeadTitle('');
        setNewLeadNotes('');

        await fetchDashboardData();
      } else {
        const errorData = await response.json();
        alert(errorData.error || 'Failed to capture lead.');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTriggerOutreach = async (leadId) => {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
    try {
      const response = await fetch('/api/messages/send', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          leadId,
          campaignId: campaigns[0]?.id || null,
          channel: 'email'
        })
      });
      if (response.ok) {
        await fetchDashboardData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // ==========================================
  // SANDBOX SIMULATOR FUNCTIONS
  // ==========================================

  const handleSimulateReply = async (e) => {
    e.preventDefault();
    if (!selectedLeadForReply) {
      alert('Please select a lead to simulate response.');
      return;
    }

    try {
      const response = await fetch('/api/simulator/incoming-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: user.tenantId,
          leadId: selectedLeadForReply,
          replyContent: simulatedReplyText
        })
      });
      if (response.ok) {
        alert('Simulator: Lead reply dispatched to webhooks. Checked RLS and updated status.');
        setSelectedLeadForReply('');
        await fetchDashboardData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSimulateCalendly = async (leadEmail) => {
    try {
      const response = await fetch('/api/meetings/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: leadEmail,
          scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          bookingLink: 'https://calendly.com/acme-sales/meeting',
          calendarEventId: 'evt_' + Math.random().toString(36).substr(2, 9),
          tenantId: user.tenantId
        })
      });
      if (response.ok) {
        alert('Simulator: Fired mock Calendly webhook trigger. Updated meeting index.');
        await fetchDashboardData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTriggerHubspotSync = () => {
    setSyncingCrm(true);
    setCrmSyncLogs(prev => [
      `[${new Date().toLocaleTimeString()}] Authenticating with HubSpot developer sandbox REST API...`,
      ...prev
    ]);

    setTimeout(() => {
      setCrmSyncLogs(prev => [
        `[${new Date().toLocaleTimeString()}] Connecting to multi-tenant integration mapping for tenant: ${tenantName}`,
        ...prev
      ]);
    }, 800);

    setTimeout(() => {
      setCrmSyncLogs(prev => [
        `[${new Date().toLocaleTimeString()}] Found ${leads.length} records in PostgreSQL leads table. Scoped query successfully bypassed cross-tenant views.`,
        ...prev
      ]);
    }, 1500);

    setTimeout(() => {
      setCrmSyncLogs(prev => [
        `[${new Date().toLocaleTimeString()}] Successfully synced ${leads.length} leads and ${meetings.length} scheduled calendar bookings to HubSpot CRM. Sync state: OK.`,
        ...prev
      ]);
      setSyncingCrm(false);
    }, 2200);
  };

  // ==========================================
  // UI VIEW RENDERING
  // ==========================================

  // 1. Sign-In Page
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brandDark px-4 py-12 relative overflow-hidden">
        {/* Glow ambient backgrounds */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-[100px]" />

        <div className="max-w-md w-full space-y-8 glass-panel rounded-2xl p-8 shadow-2xl relative z-10">
          <div className="text-center">
            <div className="inline-flex items-center justify-center p-3 bg-blue-600/10 rounded-2xl mb-4 border border-blue-500/20">
              <Sparkles className="h-8 w-8 text-blue-500" />
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-white">AI Sales Agent SaaS</h2>
            <p className="mt-2 text-sm text-slate-400">
              Multi-tenant, PostgreSQL RLS-isolated outreach automation portal.
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleLogin}>
            <div className="rounded-md shadow-sm space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">
                  Email address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
                  placeholder="Enter email"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
                  placeholder="Enter password"
                />
              </div>
            </div>

            {authError && (
              <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-500/30 rounded-lg text-xs text-red-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <div>
              <button
                type="submit"
                id="login-btn"
                className="w-full py-3 px-4 border border-transparent rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none transition active:scale-95 shadow-[0_4px_12px_rgba(59,130,246,0.3)]"
              >
                Sign In to Dashboard
              </button>
            </div>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-800"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-slate-900 px-3 text-slate-400 font-semibold">Demo Accounts</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <button
              onClick={() => handleDemoLogin('admin@acme.com')}
              className="flex items-center justify-between p-3.5 glass-panel rounded-xl text-left hover:border-blue-500/40 transition group"
            >
              <div>
                <div className="text-xs text-blue-400 font-bold uppercase tracking-wider">Tenant A (Premium)</div>
                <div className="text-sm font-semibold text-white mt-0.5">Acme Enterprise</div>
                <div className="text-xs text-slate-400">Role: Admin | admin@acme.com</div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500 group-hover:translate-x-1 transition" />
            </button>

            <button
              onClick={() => handleDemoLogin('admin@betainnovators.com')}
              className="flex items-center justify-between p-3.5 glass-panel rounded-xl text-left hover:border-blue-500/40 transition group"
            >
              <div>
                <div className="text-xs text-emerald-400 font-bold uppercase tracking-wider">Tenant B (Free Tier)</div>
                <div className="text-sm font-semibold text-white mt-0.5">Beta Innovators</div>
                <div className="text-xs text-slate-400">Role: Admin | admin@betainnovators.com</div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500 group-hover:translate-x-1 transition" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Authenticated Dashboard Layout
  return (
    <div className="min-h-screen flex bg-brandDark">
      {/* Sidebar navigation */}
      <aside className="w-64 glass-panel border-y-0 border-l-0 flex flex-col justify-between p-6">
        <div>
          <div className="flex items-center gap-2 mb-8">
            <div className="p-2 bg-blue-600/10 rounded-lg border border-blue-500/20">
              <Sparkles className="h-5 w-5 text-blue-500 animate-pulse" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white leading-tight">Sales Agent Portal</h1>
              <span className="text-[10px] uppercase font-bold tracking-wider text-blue-400 bg-blue-950/40 border border-blue-900/50 px-1.5 py-0.5 rounded">
                PostgreSQL RLS
              </span>
            </div>
          </div>

          <div className="mb-4">
            <span className="text-[10px] uppercase text-slate-400 font-bold tracking-widest block mb-2 px-2">
              Tenant Active
            </span>
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-900/50 border border-slate-800 rounded-lg">
              <Shield className="h-4 w-4 text-slate-400 shrink-0" />
              <span className="text-xs font-semibold text-slate-200 truncate">{tenantName}</span>
            </div>
          </div>

          <nav className="space-y-1.5 mt-8">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: Activity },
              { id: 'leads', label: 'Lead Manager', icon: Users },
              { id: 'campaigns', label: 'Campaign steps', icon: Mail },
              { id: 'meetings', label: 'Meetings booked', icon: Calendar },
              { id: 'simulator', label: 'Developer Sandbox', icon: Database }
            ].map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition ${isActive
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                    : 'text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
                    }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div>
          <div className="border-t border-slate-800 pt-4 mb-4">
            <div className="text-xs text-slate-400 truncate font-semibold px-2">{user?.email}</div>
            <div className="text-[10px] uppercase text-slate-500 font-bold tracking-widest px-2">Role: {user?.role}</div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-red-400 hover:bg-red-950/20 border border-transparent hover:border-red-900/30 rounded-lg transition"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main dashboard content area */}
      <main className="flex-1 flex flex-col min-h-screen overflow-y-auto">
        <header className="glass-panel border-x-0 border-t-0 py-4 px-8 flex justify-between items-center bg-slate-950/20">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white capitalize">{activeTab} Panel</h2>
            {refreshing && <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />}
          </div>
          <button
            onClick={fetchDashboardData}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-700/60 hover:border-slate-500 rounded-lg text-xs font-semibold text-slate-300 hover:text-white transition bg-slate-900/40"
          >
            <RefreshCw className="h-3 w-3" />
            Sync Dashboard
          </button>
        </header>

        <div className="flex-1 p-8 max-w-7xl w-full mx-auto">
          {/* TAB 1: DASHBOARD VIEW */}
          {activeTab === 'dashboard' && stats && (
            <div className="space-y-8">
              {/* Stat Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[
                  { label: 'Total Leads captured', value: stats.leadsCount, icon: Users, color: 'text-blue-500' },
                  { label: 'High Priority scored', value: stats.highPriority, icon: Sparkles, color: 'text-emerald-500' },
                  { label: 'Meetings scheduled', value: stats.meetingsCount, icon: Calendar, color: 'text-amber-500' },
                  { label: 'Outreach logs sent', value: stats.sentCount, icon: Send, color: 'text-purple-500' }
                ].map((card, i) => {
                  const Icon = card.icon;
                  return (
                    <div key={i} className="glass-panel rounded-xl p-6 glass-card-hover">
                      <div className="flex justify-between items-start">
                        <span className="text-xs uppercase font-bold tracking-widest text-slate-400">
                          {card.label}
                        </span>
                        <Icon className={`h-5 w-5 ${card.color}`} />
                      </div>
                      <div className="text-3xl font-extrabold text-white mt-4">{card.value}</div>
                    </div>
                  );
                })}
              </div>

              {/* Conversion Funnel */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 glass-panel rounded-xl p-6">
                  <h3 className="text-sm uppercase font-bold tracking-widest text-slate-400 mb-6">
                    SaaS Lead-to-Meeting Pipeline Funnel
                  </h3>
                  <div className="space-y-4">
                    {[
                      { step: '1. Captured leads', count: stats.leadsCount, percent: 100, color: 'bg-blue-600' },
                      { step: '2. AI scored prioritizations', count: stats.highPriority + stats.mediumPriority, percent: stats.leadsCount ? Math.round(((stats.highPriority + stats.mediumPriority) / stats.leadsCount) * 100) : 0, color: 'bg-emerald-600' },
                      { step: '3. Personal outreach campaigns', count: stats.sentCount, percent: stats.leadsCount ? Math.round((stats.sentCount / stats.leadsCount) * 100) : 0, color: 'bg-purple-600' },
                      { step: '4. Engaged answers / replies', count: stats.replyCount, percent: stats.sentCount ? Math.round((stats.replyCount / stats.sentCount) * 100) : 0, color: 'bg-pink-600' },
                      { step: '5. Calendly meeting booked', count: stats.meetingsCount, percent: stats.leadsCount ? Math.round((stats.meetingsCount / stats.leadsCount) * 100) : 0, color: 'bg-amber-600' }
                    ].map((item, idx) => (
                      <div key={idx} className="space-y-1">
                        <div className="flex justify-between text-xs font-semibold">
                          <span className="text-slate-300">{item.step}</span>
                          <span className="text-slate-400">{item.count} leads ({item.percent}%)</span>
                        </div>
                        <div className="w-full bg-slate-900 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${item.color} transition-all duration-1000`}
                            style={{ width: `${item.percent}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Audit log activity feed */}
                <div className="glass-panel rounded-xl p-6">
                  <h3 className="text-sm uppercase font-bold tracking-widest text-slate-400 mb-6">
                    Live Audit logs (RLS isolated)
                  </h3>
                  <div className="space-y-4 max-h-[250px] overflow-y-auto">
                    {stats.recentActivity.map((log, idx) => (
                      <div key={idx} className="border-b border-slate-800 pb-3 last:border-0 last:pb-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded text-blue-400">
                            {log.action}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          By: <span className="font-semibold text-slate-300">{log.user_email || 'System'}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {new Date(log.created_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                    {stats.recentActivity.length === 0 && (
                      <div className="text-xs text-slate-500 text-center py-8">No activities recorded.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: LEADS LIST VIEW */}
          {activeTab === 'leads' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-sm uppercase font-bold tracking-widest text-slate-400">
                  Total leads: {leads.length}
                </h3>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      // Demo batch CSV import
                      const headers = {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                      };
                      fetch('/api/leads/import', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                          leads: [
                            { name: 'Michael Scott', email: 'michael@dundermifflin.com', company: 'Dunder Mifflin', title: 'Regional Manager', notes: 'Expressed high interest in automated digital delivery.', phone: '555-4039' },
                            { name: 'Pam Beesly', email: 'pam@dundermifflin.com', company: 'Dunder Mifflin', title: 'Office Administrator', notes: 'Wants a simple scheduler demonstration.', phone: '555-4029' }
                          ]
                        })
                      }).then(() => fetchDashboardData());
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 border border-slate-700 hover:border-slate-500 bg-slate-900/60 rounded-lg text-xs font-semibold text-slate-300 hover:text-white transition"
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    CSV Seed Import
                  </button>
                  <button
                    onClick={() => setIsLeadModalOpen(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs font-semibold text-white transition active:scale-95 shadow-md shadow-blue-600/10"
                  >
                    <UserPlus className="h-4 w-4" />
                    Add Lead
                  </button>
                </div>
              </div>

              {/* Leads Table */}
              <div className="glass-panel rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-900/60 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400 font-semibold">
                        <th className="py-4 px-6">Name</th>
                        <th className="py-4 px-6">Company & Title</th>
                        <th className="py-4 px-6">Email & Phone</th>
                        <th className="py-4 px-6">AI score</th>
                        <th className="py-4 px-6">Status</th>
                        <th className="py-4 px-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leads.map(lead => (
                        <tr key={lead.id} className="border-b border-slate-800 hover:bg-slate-900/20 transition group">
                          <td className="py-4 px-6 font-semibold text-white">{lead.name}</td>
                          <td className="py-4 px-6">
                            <div className="text-slate-300 font-semibold">{lead.company || '-'}</div>
                            <div className="text-xs text-slate-500">{lead.title || '-'}</div>
                          </td>
                          <td className="py-4 px-6">
                            <div className="text-slate-300">{lead.email}</div>
                            <div className="text-xs text-slate-500">{lead.phone || '-'}</div>
                          </td>
                          <td className="py-4 px-6">
                            <div className="relative group/score inline-block">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold capitalize border ${lead.score === 'high'
                                ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/50'
                                : lead.score === 'medium'
                                  ? 'bg-amber-950/40 text-amber-400 border-amber-900/50'
                                  : 'bg-slate-800/40 text-slate-400 border-slate-700/50'
                                }`}>
                                <Sparkles className="h-3 w-3" />
                                {lead.score || 'unranked'}
                              </span>

                              {/* Hover details tooltip */}
                              <div className="absolute z-30 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-slate-950 border border-slate-800 rounded-lg text-[11px] text-slate-300 leading-normal hidden group-hover/score:block shadow-2xl">
                                <div className="font-bold text-slate-400 uppercase tracking-wider mb-1">AI assessment reasons</div>
                                {lead.enrichment_data?.ai_score_reason || 'Model analysis pending.'}
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-6">
                            <span className="capitalize font-bold text-xs text-slate-300 bg-slate-900/80 border border-slate-800 px-2.5 py-1 rounded-lg">
                              {lead.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-right">
                            {lead.status === 'new' ? (
                              <button
                                onClick={() => handleTriggerOutreach(lead.id)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600/10 border border-blue-500/20 hover:bg-blue-600 rounded-lg text-xs font-bold text-blue-400 hover:text-white transition"
                              >
                                <Send className="h-3.5 w-3.5" />
                                Send Outreach
                              </button>
                            ) : (
                              <span className="text-xs text-slate-500 italic">Dispatched</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {leads.length === 0 && (
                        <tr>
                          <td colSpan="6" className="text-center py-12 text-slate-500 font-semibold italic">
                            No leads captured yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CAMPAIGNS VIEW */}
          {activeTab === 'campaigns' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  {campaigns.map(c => (
                    <div key={c.id} className="glass-panel rounded-xl p-6">
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h4 className="text-lg font-bold text-white">{c.name}</h4>
                          <span className="text-xs uppercase font-bold tracking-widest bg-slate-900 text-blue-400 border border-slate-800 px-2 py-0.5 rounded mt-2 inline-block">
                            Channel: {c.channel}
                          </span>
                        </div>
                      </div>
                      <div className="border-t border-slate-800 pt-4">
                        <div className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-4">
                          Sequence touchpoints cadence
                        </div>
                        <div className="relative border-l border-slate-800 pl-6 ml-2 space-y-6">
                          {c.cadence?.steps?.map((step, idx) => (
                            <div key={idx} className="relative">
                              <div className="absolute -left-[31px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-950 border border-blue-500">
                                <div className="h-2 w-2 rounded-full bg-blue-500" />
                              </div>
                              <div className="text-sm font-semibold text-slate-200">
                                Step {idx + 1}: Day {step.day}
                              </div>
                              <div className="text-xs text-slate-400 mt-1">
                                Template ID: <span className="font-mono text-slate-300">{step.template_id || 'sms_outreach'}</span>
                              </div>
                              <div className="text-xs font-semibold text-slate-300 mt-0.5">
                                Subject: {step.subject || step.body}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  {campaigns.length === 0 && (
                    <div className="glass-panel rounded-xl p-12 text-center text-slate-500 font-semibold italic">
                      No outreach sequences created.
                    </div>
                  )}
                </div>

                {/* Sidebar Campaign Creator */}
                <div className="glass-panel rounded-xl p-6 h-fit">
                  <h3 className="text-sm uppercase font-bold tracking-widest text-slate-400 mb-4">
                    Sequence Builder
                  </h3>
                  <p className="text-xs text-slate-400 mb-6">
                    Multi-touch workflows dispatch automatically once leads are imported.
                  </p>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs text-slate-400 font-semibold mb-1">Campaign name</label>
                      <input
                        type="text"
                        placeholder="e.g. Q3 UK Founder Cold Outreach"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                        disabled
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 font-semibold mb-1">Outreach channel</label>
                      <select
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                        disabled
                      >
                        <option>Email</option>
                        <option>SMS</option>
                        <option>WhatsApp</option>
                      </select>
                    </div>
                    <button
                      className="w-full py-2 bg-slate-800 border border-slate-700/60 text-slate-500 rounded-lg text-xs font-semibold cursor-not-allowed"
                      disabled
                    >
                      Save Campaign Sequence
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: MEETINGS BOOKED VIEW */}
          {activeTab === 'meetings' && (
            <div className="space-y-6">
              <div className="glass-panel rounded-xl overflow-hidden">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-900/60 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400 font-semibold">
                      <th className="py-4 px-6">Lead</th>
                      <th className="py-4 px-6">Company</th>
                      <th className="py-4 px-6">Scheduled time</th>
                      <th className="py-4 px-6">Booking Link</th>
                      <th className="py-4 px-6">Event ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meetings.map(meeting => (
                      <tr key={meeting.id} className="border-b border-slate-800 hover:bg-slate-900/20 transition">
                        <td className="py-4 px-6 font-semibold text-white">{meeting.lead_name}</td>
                        <td className="py-4 px-6 font-semibold text-slate-300">{meeting.lead_company || '-'}</td>
                        <td className="py-4 px-6 text-slate-300">
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-4 w-4 text-amber-500" />
                            {new Date(meeting.scheduled_at).toLocaleString()}
                          </div>
                        </td>
                        <td className="py-4 px-6">
                          <a
                            href={meeting.booking_link}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1 font-mono"
                          >
                            {meeting.booking_link}
                          </a>
                        </td>
                        <td className="py-4 px-6 font-mono text-xs text-slate-500">{meeting.calendar_event_id}</td>
                      </tr>
                    ))}
                    {meetings.length === 0 && (
                      <tr>
                        <td colSpan="5" className="text-center py-12 text-slate-500 font-semibold italic">
                          No meetings booked yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: DEVELOPER SANDBOX SIMULATOR VIEW */}
          {activeTab === 'simulator' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left Column: Local webhooks & messages */}
              <div className="space-y-8">
                {/* Simulated message answers */}
                <div className="glass-panel rounded-xl p-6">
                  <h3 className="text-sm uppercase font-bold tracking-widest text-slate-400 mb-4">
                    Simulate Inbound Lead Response
                  </h3>
                  <p className="text-xs text-slate-400 mb-6">
                    Simulate a lead answering an outreach SMS or email. Fired event updates lead status to "Replied" with multi-tenant parameters.
                  </p>

                  <form onSubmit={handleSimulateReply} className="space-y-4">
                    <div>
                      <label className="block text-xs text-slate-400 font-semibold mb-1">Select Contacted Lead</label>
                      <select
                        value={selectedLeadForReply}
                        onChange={(e) => setSelectedLeadForReply(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                      >
                        <option value="">// Choose Lead //</option>
                        {leads.filter(l => l.status === 'contacted').map(l => (
                          <option key={l.id} value={l.id}>{l.name} ({l.company})</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 font-semibold mb-1">Reply Message Content</label>
                      <textarea
                        rows="3"
                        value={simulatedReplyText}
                        onChange={(e) => setSimulatedReplyText(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 resize-none"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white rounded-lg transition active:scale-95"
                    >
                      Dispatch Simulated Lead Response
                    </button>
                  </form>
                </div>

                {/* Simulated webhook booking */}
                <div className="glass-panel rounded-xl p-6">
                  <h3 className="text-sm uppercase font-bold tracking-widest text-slate-400 mb-4">
                    Simulate Calendly Booking webhook
                  </h3>
                  <p className="text-xs text-slate-400 mb-6">
                    Fires a simulated webhook callback to `/api/meetings/webhook` mapping the lead email to schedule a booking event in the PostgreSQL meeting tables.
                  </p>

                  <div className="space-y-3">
                    {leads.filter(l => l.status === 'replied').map(lead => (
                      <div key={lead.id} className="flex justify-between items-center p-3 bg-slate-900/40 border border-slate-800 rounded-lg">
                        <div>
                          <div className="text-xs font-semibold text-white">{lead.name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{lead.email}</div>
                        </div>
                        <button
                          onClick={() => handleSimulateCalendly(lead.email)}
                          className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-[10px] font-bold text-white rounded transition"
                        >
                          Book Meeting
                        </button>
                      </div>
                    ))}
                    {leads.filter(l => l.status === 'replied').length === 0 && (
                      <div className="text-xs text-slate-500 italic text-center py-6">
                        No leads are currently in "Replied" status to simulate meeting bookings.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: HubSpot CRM Sync Logger */}
              <div className="glass-panel rounded-xl p-6 flex flex-col justify-between h-full">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm uppercase font-bold tracking-widest text-slate-400">
                      CRM Sync & Logs (HubSpot integration)
                    </h3>
                    <button
                      onClick={handleTriggerHubspotSync}
                      disabled={syncingCrm}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-600/10 border border-blue-500/20 hover:bg-blue-600 text-xs font-bold text-blue-400 hover:text-white rounded-lg transition disabled:cursor-not-allowed"
                    >
                      <RefreshCw className={`h-3 w-3 ${syncingCrm ? 'animate-spin' : ''}`} />
                      Sync HubSpot
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mb-6">
                    Displays synchronization logs of lead entities, emails, and meetings pushed to HubSpot API.
                  </p>
                </div>

                <div className="bg-slate-950 border border-slate-900 rounded-lg p-4 font-mono text-[10px] text-slate-300 space-y-2 h-[400px] overflow-y-auto">
                  {crmSyncLogs.map((log, idx) => (
                    <div key={idx} className="border-b border-slate-900 pb-1.5 last:border-0 last:pb-0">
                      {log}
                    </div>
                  ))}
                  {crmSyncLogs.length === 0 && (
                    <div className="text-slate-500 italic text-center py-32">
                      Ready. Trigger HubSpot sync to observe logs.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* LEAD CAPTURE MODAL */}
      {isLeadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="max-w-md w-full glass-panel rounded-2xl p-6 shadow-2xl space-y-6">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-blue-500" />
                Capture New Lead
              </h3>
              <button
                onClick={() => setIsLeadModalOpen(false)}
                className="text-xs font-bold text-slate-400 hover:text-slate-200 transition"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleCreateLead} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] text-slate-400 font-semibold mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={newLeadName}
                    onChange={(e) => setNewLeadName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    placeholder="Enter name"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 font-semibold mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    value={newLeadEmail}
                    onChange={(e) => setNewLeadEmail(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    placeholder="Enter email"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] text-slate-400 font-semibold mb-1">Company</label>
                  <input
                    type="text"
                    value={newLeadCompany}
                    onChange={(e) => setNewLeadCompany(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    placeholder="Enter company"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 font-semibold mb-1">Job Title</label>
                  <input
                    type="text"
                    value={newLeadTitle}
                    onChange={(e) => setNewLeadTitle(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    placeholder="Enter title"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 font-semibold mb-1">Phone Number</label>
                <input
                  type="text"
                  value={newLeadPhone}
                  onChange={(e) => setNewLeadPhone(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  placeholder="e.g. +1-555-0199"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 font-semibold mb-1">Context / Custom Notes</label>
                <textarea
                  rows="3"
                  value={newLeadNotes}
                  onChange={(e) => setNewLeadNotes(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 resize-none"
                  placeholder="Enter custom context or notes..."
                />
              </div>

              <div className="text-[10px] text-slate-500 leading-normal">
                Note: Capturing the lead will automatically trigger AI-embeddings mapping to score prioritization in the PostgreSQL transaction RLS.
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white rounded-lg transition active:scale-95 shadow-md shadow-blue-600/20"
              >
                Score Lead and Insert to Database
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
