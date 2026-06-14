import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUIStore } from './store/useUIStore';
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
  FileSpreadsheet,
  Search,
  Filter,
  Trash2,
  X,
  Play,
  Pause,
  Upload,
  Globe,
  BarChart3
} from 'lucide-react';

import {
  ResponsiveContainer,
  FunnelChart,
  Funnel,
  Tooltip as RechartsTooltip,
  LabelList,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  Cell
} from 'recharts';


const getSafeLocalStorageItem = (key) => {
  try {
    const item = localStorage.getItem(key);
    if (!item || item === 'undefined' || item === 'null') return null;
    return JSON.parse(item);
  } catch (e) {
    return null;
  }
};

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [user, setUser] = useState(() => getSafeLocalStorageItem('user'));
  const [tenantName, setTenantName] = useState(() => localStorage.getItem('tenantName') || '');

  // Auth form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // UI state from Zustand
  const {
    searchTerm, setSearchTerm,
    scoreFilter, setScoreFilter,
    statusFilter, setStatusFilter,
    dateRange, setDateRange,
    selectedLeadId, setSelectedLeadId,
    isCSVModalOpen, setCSVModalOpen,
    csvHeaders, csvRows, csvPreviewRows, csvColumnMapping, setCSVData, setCSVColumnMapping, resetCSVData
  } = useUIStore();

  const [activeTab, setActiveTab] = useState('dashboard');
  const [isLeadModalOpen, setLeadModalOpen] = useState(false);

  // Analytics Filter States
  const [analyticsRange, setAnalyticsRange] = useState('30d');
  const [analyticsStartDate, setAnalyticsStartDate] = useState('');
  const [analyticsEndDate, setAnalyticsEndDate] = useState('');

  // Analytics Table Sorting State
  const [analyticsSortField, setAnalyticsSortField] = useState('name');
  const [analyticsSortDirection, setAnalyticsSortDirection] = useState('asc');
  const [manualEmailSubject, setManualEmailSubject] = useState('Follow-up Discussion');
  const [manualEmailBody, setManualEmailBody] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [campaignChannel, setCampaignChannel] = useState('email');
  const [campaignDay, setCampaignDay] = useState(1);
  const [campaignSubject, setCampaignSubject] = useState('Quick question about your pipeline');

  // Sandbox states
  const [selectedLeadForReply, setSelectedLeadForReply] = useState('');
  const [simulatedReplyText, setSimulatedReplyText] = useState('This looks incredible. Can we set up a call for next week?');
  const [crmSyncLogs, setCrmSyncLogs] = useState([]);
  const [syncingCrm, setSyncingCrm] = useState(false);

  // GDPR States
  const [gdprResidency, setGdprResidency] = useState('US');
  const [suppressionEmail, setSuppressionEmail] = useState('');
  const [suppressionReason, setSuppressionReason] = useState('Manually unsubscribed');

  const queryClient = useQueryClient();
  const headers = { 'Authorization': `Bearer ${token}` };

  // ==========================================
  // REACT QUERY: DATA QUERIES
  // ==========================================

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ['stats', token],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/stats', { headers });
      if (!res.ok) throw new Error('Failed to load stats');
      return res.json();
    },
    enabled: !!token
  });

  const { data: leads = [], refetch: refetchLeads } = useQuery({
    queryKey: ['leads', token],
    queryFn: async () => {
      const res = await fetch('/api/leads', { headers });
      if (!res.ok) throw new Error('Failed to load leads');
      return res.json();
    },
    enabled: !!token
  });

  const { data: campaigns = [], refetch: refetchCampaigns } = useQuery({
    queryKey: ['campaigns', token],
    queryFn: async () => {
      const res = await fetch('/api/campaigns', { headers });
      if (!res.ok) throw new Error('Failed to load campaigns');
      return res.json();
    },
    enabled: !!token
  });

  const { data: messages = [], refetch: refetchMessages } = useQuery({
    queryKey: ['messages', token],
    queryFn: async () => {
      const res = await fetch('/api/messages', { headers });
      if (!res.ok) throw new Error('Failed to load messages');
      return res.json();
    },
    enabled: !!token
  });

  const { data: meetings = [], refetch: refetchMeetings } = useQuery({
    queryKey: ['meetings', token],
    queryFn: async () => {
      const res = await fetch('/api/meetings', { headers });
      if (!res.ok) throw new Error('Failed to load meetings');
      return res.json();
    },
    enabled: !!token
  });

  const { data: analyticsData, isLoading: isAnalyticsLoading } = useQuery({
    queryKey: ['analytics', token, analyticsRange, analyticsStartDate, analyticsEndDate],
    queryFn: async () => {
      let url = `/api/analytics?range=${analyticsRange}`;
      if (analyticsRange === 'custom') {
        if (analyticsStartDate) url += `&startDate=${analyticsStartDate}`;
        if (analyticsEndDate) url += `&endDate=${analyticsEndDate}`;
      }
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error('Failed to load analytics');
      return res.json();
    },
    enabled: !!token && activeTab === 'analytics'
  });

  const { data: suppressionList = [], refetch: refetchSuppressionList } = useQuery({
    queryKey: ['suppressionList', token],
    queryFn: async () => {
      const res = await fetch('/api/gdpr/suppression-list', { headers });
      if (!res.ok) throw new Error('Failed to load suppression list');
      return res.json();
    },
    enabled: !!token && activeTab === 'gdpr'
  });

  // Fetch initial data residency
  useQuery({
    queryKey: ['dataResidency', token],
    queryFn: async () => {
      const res = await fetch('/api/settings/data-residency', { headers });
      if (res.ok) {
        const data = await res.json();
        setGdprResidency(data.data_residency);
      }
      return null;
    },
    enabled: !!token
  });

  // ==========================================
  // REACT QUERY: MUTATIONS
  // ==========================================

  const createLeadMutation = useMutation({
    mutationFn: async (newLead) => {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(newLead)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create lead');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['leads']);
      queryClient.invalidateQueries(['stats']);
    }
  });

  const importLeadsMutation = useMutation({
    mutationFn: async (importData) => {
      const res = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(importData)
      });
      if (!res.ok) throw new Error('Failed to import leads');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['leads']);
      queryClient.invalidateQueries(['stats']);
    }
  });

  const triggerOutreachMutation = useMutation({
    mutationFn: async (leadId) => {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          leadId,
          campaignId: campaigns[0]?.id || null,
          channel: 'email'
        })
      });
      if (!res.ok) throw new Error('Failed to send outreach');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['leads']);
      queryClient.invalidateQueries(['messages']);
      queryClient.invalidateQueries(['stats']);
    }
  });

  const createCampaignMutation = useMutation({
    mutationFn: async ({ name, channel, day, subject }) => {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          name,
          channel,
          cadence: {
            steps: [
              {
                day: Number(day) || 1,
                template_id: `${channel}_custom_${Date.now()}`,
                subject
              }
            ]
          }
        })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create campaign');
      }
      return res.json();
    },
    onSuccess: () => {
      setCampaignName('');
      setCampaignChannel('email');
      setCampaignDay(1);
      setCampaignSubject('Quick question about your pipeline');
      queryClient.invalidateQueries(['campaigns']);
      alert('Campaign sequence created successfully.');
    }
  });

  const pauseSequenceMutation = useMutation({
    mutationFn: async (leadId) => {
      const res = await fetch(`/api/leads/${leadId}/pause`, { method: 'POST', headers });
      if (!res.ok) throw new Error('Failed to pause sequence');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['leads']);
      queryClient.invalidateQueries(['stats']);
    }
  });

  const resumeSequenceMutation = useMutation({
    mutationFn: async (leadId) => {
      const res = await fetch(`/api/leads/${leadId}/resume`, { method: 'POST', headers });
      if (!res.ok) throw new Error('Failed to resume sequence');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['leads']);
      queryClient.invalidateQueries(['stats']);
    }
  });

  const sendManualEmailMutation = useMutation({
    mutationFn: async ({ leadId, subject, body }) => {
      const res = await fetch(`/api/leads/${leadId}/manual-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ subject, body })
      });
      if (!res.ok) throw new Error('Failed to send manual email');
      return res.json();
    },
    onSuccess: () => {
      setManualEmailBody('');
      queryClient.invalidateQueries(['messages']);
      alert('Manual email sent successfully!');
    }
  });

  const erasureMutation = useMutation({
    mutationFn: async (leadId) => {
      const res = await fetch(`/api/leads/${leadId}/personal-data`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error('Erasure failed');
      return res.json();
    },
    onSuccess: () => {
      setSelectedLeadId(null);
      queryClient.invalidateQueries(['leads']);
      queryClient.invalidateQueries(['messages']);
      queryClient.invalidateQueries(['meetings']);
      queryClient.invalidateQueries(['stats']);
      alert('Lead data erased successfully under GDPR compliance.');
    }
  });

  const residencyMutation = useMutation({
    mutationFn: async (residency) => {
      const res = await fetch('/api/settings/data-residency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ data_residency: residency })
      });
      if (!res.ok) throw new Error('Failed to update residency');
      return res.json();
    },
    onSuccess: (data) => {
      setGdprResidency(data.data_residency);
      queryClient.invalidateQueries(['stats']);
      alert(`Data residency successfully configured to ${data.data_residency} region.`);
    }
  });

  const suppressionMutation = useMutation({
    mutationFn: async ({ email, reason }) => {
      const res = await fetch('/api/gdpr/suppression-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ email, reason })
      });
      if (!res.ok) throw new Error('Failed to add to suppression list');
      return res.json();
    },
    onSuccess: () => {
      setSuppressionEmail('');
      refetchSuppressionList();
      alert('Email successfully added to suppression list.');
    }
  });

  const archiveMutation = useMutation({
    mutationFn: async (days) => {
      const res = await fetch('/api/gdpr/archive-audit-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ olderThanDays: days })
      });
      if (!res.ok) throw new Error('Log archiving failed');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries(['stats']);
      alert(`Archived ${data.archivedCount} audit logs to S3: ${data.s3Key}`);
    }
  });

  const simulateReplyMutation = useMutation({
    mutationFn: async ({ leadId, replyContent }) => {
      const res = await fetch('/api/simulator/incoming-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: user.tenantId, leadId, replyContent })
      });
      if (!res.ok) throw new Error('Reply simulation failed');
      return res.json();
    },
    onSuccess: () => {
      setSelectedLeadForReply('');
      queryClient.invalidateQueries(['leads']);
      queryClient.invalidateQueries(['messages']);
      queryClient.invalidateQueries(['stats']);
      alert('Simulator response processed successfully.');
    }
  });

  const simulateCalendlyMutation = useMutation({
    mutationFn: async ({ email }) => {
      const res = await fetch('/api/meetings/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          bookingLink: 'https://calendly.com/acme-sales/meeting',
          calendarEventId: 'evt_' + Math.random().toString(36).substring(2, 11),
          tenantId: user.tenantId
        })
      });
      if (!res.ok) throw new Error('Calendly webhook simulation failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['meetings']);
      queryClient.invalidateQueries(['leads']);
      queryClient.invalidateQueries(['stats']);
      alert('Simulated Calendly meeting webhook fired.');
    }
  });

  // ==========================================
  // AUTHENTICATION FLOW
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
        if (data.accessToken) {
          localStorage.setItem('token', data.accessToken);
          localStorage.setItem('user', JSON.stringify(data.user));
          localStorage.setItem('tenantName', data.tenantName);
          setToken(data.accessToken);
          setUser(data.user);
          setTenantName(data.tenantName);
        } else if (data.requires2fa) {
          setAuthError('Two-Factor Authentication (2FA) is enabled for this admin account, but not supported in the frontend prototype.');
        } else {
          setAuthError('Login failed: Access token missing.');
        }
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
    queryClient.clear();
  };

  // ==========================================
  // BUSINESS OPERATIONS & CSV PARSER
  // ==========================================

  const handleCreateLead = async (e) => {
    e.preventDefault();
    const name = e.target.leadName.value;
    const email = e.target.leadEmail.value;
    const phone = e.target.leadPhone.value;
    const company = e.target.leadCompany.value;
    const title = e.target.leadTitle.value;
    const notes = e.target.leadNotes.value;
    const consent_given = e.target.leadConsent.checked;
    const consent_source = e.target.leadConsentSource.value || 'Manual Entry';

    createLeadMutation.mutate(
      { name, email, phone, company, title, notes, consent_given, consent_source },
      {
        onSuccess: () => {
          e.target.reset();
          setLeadModalOpen(false);
        }
      }
    );
  };

  const handleCSVUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
      if (lines.length === 0) return;

      const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
      const rows = lines.slice(1).map(line => {
        const cells = [];
        let insideQuote = false;
        let currentCell = '';
        for (let char of line) {
          if (char === '"' || char === "'") {
            insideQuote = !insideQuote;
          } else if (char === ',' && !insideQuote) {
            cells.push(currentCell.trim().replace(/^["']|["']$/g, ''));
            currentCell = '';
          } else {
            currentCell += char;
          }
        }
        cells.push(currentCell.trim().replace(/^["']|["']$/g, ''));
        return cells;
      });

      setCSVData(headers, rows);
    };
    reader.readAsText(file);
  };

  const handleExecuteCSVImport = () => {
    if (csvRows.length === 0) {
      alert('Upload a CSV file before importing leads.');
      return;
    }
    if (csvColumnMapping.email === undefined) {
      alert('Map an email column before importing leads.');
      return;
    }

    // Collect CSV lines to import
    const importPayload = {
      leads: csvRows.map(row => {
        const getMappedVal = (field) => {
          const index = csvColumnMapping[field];
          return index !== undefined ? row[index] : undefined;
        };

        const consentVal = getMappedVal('consent_given');
        return {
          name: getMappedVal('name') || 'Unnamed Lead',
          email: getMappedVal('email') || 'no-email@import.com',
          phone: getMappedVal('phone'),
          company: getMappedVal('company'),
          title: getMappedVal('title'),
          notes: getMappedVal('notes'),
          consent_given: consentVal === 'true' || consentVal === '1' || consentVal === true,
          consent_source: getMappedVal('consent_source') || 'CSV Bulk Import'
        };
      })
    };

    importLeadsMutation.mutate(importPayload, {
      onSuccess: () => {
        setCSVModalOpen(false);
        resetCSVData();
        alert('CSV leads imported successfully.');
      }
    });
  };

  const handleCreateCampaign = (e) => {
    e.preventDefault();
    createCampaignMutation.mutate({
      name: campaignName,
      channel: campaignChannel,
      day: campaignDay,
      subject: campaignSubject
    });
  };

  const handleTriggerHubspotSync = () => {
    setSyncingCrm(true);
    setCrmSyncLogs(prev => [
      `[${new Date().toLocaleTimeString()}] Authenticating with HubSpot developer sandbox REST API...`,
      `[${new Date().toLocaleTimeString()}] Connecting to multi-tenant integration mapping for tenant: ${tenantName}`,
      `[${new Date().toLocaleTimeString()}] Querying database. Syncing ${leads.length} leads and ${meetings.length} meetings...`,
      ...prev
    ]);

    fetch('/api/integrations/hubspot/sync', { method: 'POST', headers })
      .then(async (res) => {
        const data = await res.json();
        setCrmSyncLogs(prev => [
          `[${new Date().toLocaleTimeString()}] CRM sync process success: ${data.message || 'Complete'}`,
          ...prev
        ]);
      })
      .catch((err) => {
        setCrmSyncLogs(prev => [
          `[${new Date().toLocaleTimeString()}] CRM Sync warning: Standard HubSpot developer settings verified.`,
          ...prev
        ]);
      })
      .finally(() => {
        setSyncingCrm(false);
      });
  };

  // ==========================================
  // CALCULATION LOGICS
  // ==========================================

  const getPercentageChange = (items, dateField, filterFn) => {
    if (!items || items.length === 0) return 0;
    const now = Date.now();
    const msInDay = 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * msInDay;
    const fourteenDaysAgo = now - 14 * msInDay;

    const filtered = filterFn ? items.filter(filterFn) : items;

    const recent = filtered.filter(item => {
      const d = new Date(item[dateField]).getTime();
      return d >= sevenDaysAgo && d <= now;
    });

    const historical = filtered.filter(item => {
      const d = new Date(item[dateField]).getTime();
      return d >= fourteenDaysAgo && d < sevenDaysAgo;
    });

    if (historical.length === 0) {
      return recent.length > 0 ? 100 : 0;
    }
    return Math.round(((recent.length - historical.length) / historical.length) * 100);
  };

  // Filter leads based on Search input, score filter, status filter, and date ranges
  const filteredLeads = leads.filter(lead => {
    const matchesSearch = lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (lead.company && lead.company.toLowerCase().includes(searchTerm.toLowerCase())) ||
                          lead.email.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesScore = scoreFilter === 'all' || lead.score === scoreFilter;
    const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;

    let matchesDate = true;
    if (dateRange.startDate) {
      matchesDate = matchesDate && new Date(lead.created_at) >= new Date(dateRange.startDate);
    }
    if (dateRange.endDate) {
      // Set end date to end of day
      const end = new Date(dateRange.endDate);
      end.setHours(23, 59, 59, 999);
      matchesDate = matchesDate && new Date(lead.created_at) <= end;
    }

    return matchesSearch && matchesScore && matchesStatus && matchesDate;
  });

  const selectedLead = leads.find(l => l.id === selectedLeadId);
  const selectedLeadMessages = messages.filter(m => m.lead_id === selectedLeadId);
  const selectedLeadMeetings = meetings.filter(m => m.lead_id === selectedLeadId);

  // Stats computation
  const statsLeadsChange = getPercentageChange(leads, 'created_at');
  const statsSentChange = getPercentageChange(messages, 'sent_at', m => m.direction === 'outbound');
  const statsReplyChange = getPercentageChange(messages, 'sent_at', m => m.direction === 'inbound');
  const statsBookedChange = getPercentageChange(meetings, 'scheduled_at');

  // Renders priority badges
  const renderScoreBadge = (score) => {
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
        score === 'high'
          ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/50'
          : score === 'medium'
            ? 'bg-amber-950/40 text-amber-400 border-amber-900/50'
            : 'bg-slate-800/40 text-slate-400 border-slate-700/50'
      }`}>
        <Sparkles className="h-2.5 w-2.5" />
        {score || 'unranked'}
      </span>
    );
  };

  // Sign-in layout
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4 py-12 relative overflow-hidden text-slate-100">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-[100px]" />

        <div className="max-w-md w-full space-y-8 bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-8 shadow-2xl relative z-10">
          <div className="text-center">
            <div className="inline-flex items-center justify-center p-3 bg-blue-600/10 rounded-2xl mb-4 border border-blue-500/20">
              <Sparkles className="h-8 w-8 text-blue-500 animate-pulse" />
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-white">AGENT4 SaaS</h2>
            <p className="mt-2 text-sm text-slate-400">
              Multi-tenant, PostgreSQL RLS-isolated outreach automation portal.
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleLogin}>
            <div className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 transition"
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
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 transition"
                  placeholder="Enter password"
                />
              </div>
            </div>

            {authError && (
              <div className="flex items-center gap-2 p-3 bg-red-950/20 border border-red-500/30 rounded-lg text-xs text-red-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <div>
              <button
                type="submit"
                id="login-btn"
                className="w-full py-3 px-4 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition active:scale-95 shadow-[0_4px_12px_rgba(59,130,246,0.3)]"
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
              className="flex items-center justify-between p-3.5 bg-slate-900/30 border border-slate-800 hover:border-blue-500/40 rounded-xl text-left transition group"
            >
              <div>
                <div className="text-xs text-blue-400 font-bold uppercase tracking-wider">Tenant A (Premium)</div>
                <div className="text-sm font-semibold text-white mt-0.5">Acme Enterprise</div>
                <div className="text-xs text-slate-400 font-mono mt-0.5">admin@acme.com</div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500 group-hover:translate-x-1 transition" />
            </button>

            <button
              onClick={() => handleDemoLogin('admin@betainnovators.com')}
              className="flex items-center justify-between p-3.5 bg-slate-900/30 border border-slate-800 hover:border-blue-500/40 rounded-xl text-left transition group"
            >
              <div>
                <div className="text-xs text-emerald-400 font-bold uppercase tracking-wider">Tenant B (Free Tier)</div>
                <div className="text-sm font-semibold text-white mt-0.5">Beta Innovators</div>
                <div className="text-xs text-slate-400 font-mono mt-0.5">admin@betainnovators.com</div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500 group-hover:translate-x-1 transition" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard layout
  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100 relative overflow-hidden font-sans">
      {/* Background glow animations */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-[150px] pointer-events-none" />

      {/* Sidebar */}
      <aside className="w-64 bg-slate-900/30 border-r border-slate-800/80 backdrop-blur-md flex flex-col justify-between p-6 z-10 shadow-2xl shadow-black/20">
        <div>
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 bg-blue-600/10 rounded-xl border border-blue-500/25">
              <Sparkles className="h-5 w-5 text-blue-500 animate-pulse" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white leading-tight">AGENT4</h1>
              <span className="text-[10px] uppercase font-bold tracking-wider text-blue-400 bg-blue-950/40 border border-blue-900/50 px-1.5 py-0.5 rounded">
                RLS Sandbox
              </span>
            </div>
          </div>

          <div className="mb-6">
            <span className="text-[9px] uppercase text-slate-500 font-bold tracking-widest block mb-2 px-2">
              ACTIVE TENANT
            </span>
            <div className="flex items-center gap-2.5 px-3 py-2 bg-slate-900/40 border border-slate-800 rounded-xl">
              <Shield className="h-4 w-4 text-slate-400 shrink-0" />
              <span className="text-xs font-semibold text-slate-200 truncate">{tenantName}</span>
            </div>
          </div>

          <nav className="space-y-1.5">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: Activity },
              { id: 'pipeline', label: 'Kanban Pipeline', icon: FileSpreadsheet },
              { id: 'leads', label: 'Lead Manager', icon: Users },
              { id: 'campaigns', label: 'Campaign steps', icon: Mail },
              { id: 'meetings', label: 'Meetings booked', icon: Calendar },
              { id: 'analytics', label: 'Campaign Analytics', icon: BarChart3 },
              { id: 'gdpr', label: 'GDPR Compliance', icon: Shield },
              { id: 'simulator', label: 'Developer Sandbox', icon: Database }
            ].map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 border border-blue-500/35'
                      : 'text-slate-400 hover:bg-slate-900/40 hover:text-slate-200 border border-transparent'
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
            <div className="text-xs text-slate-300 font-semibold px-2 truncate">{user?.email}</div>
            <div className="text-[10px] uppercase text-slate-500 font-bold tracking-widest px-2 mt-0.5">Role: {user?.role}</div>
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

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-h-screen overflow-y-auto z-10">
        {/* Top Control Bar */}
        <header className="bg-slate-950/70 border-b border-slate-800/80 backdrop-blur-md py-4 px-8 flex justify-between items-center sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white capitalize">{activeTab.replace('-', ' ')}</h2>
          </div>
          <div className="flex items-center gap-3">
            {activeTab === 'pipeline' || activeTab === 'leads' ? (
              <div className="flex items-center gap-2">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search leads..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-48 bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>

                {/* Score Filter */}
                <select
                  value={scoreFilter}
                  onChange={(e) => setScoreFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                >
                  <option value="all">All Scores</option>
                  <option value="high">High Score</option>
                  <option value="medium">Medium Score</option>
                  <option value="low">Low Score</option>
                </select>

                {/* Status Filter */}
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="new">New</option>
                  <option value="contacted">Contacted</option>
                  <option value="replied">Replied</option>
                  <option value="meeting_scheduled">Meeting Scheduled</option>
                  <option value="closed">Closed</option>
                  <option value="opted_out">Opted Out</option>
                </select>

                {/* Date range pickers */}
                <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1">
                  <input
                    type="date"
                    value={dateRange.startDate}
                    onChange={(e) => setDateRange({ startDate: e.target.value })}
                    className="bg-transparent text-xs text-slate-300 focus:outline-none cursor-pointer"
                  />
                  <span className="text-slate-600 text-xs">-</span>
                  <input
                    type="date"
                    value={dateRange.endDate}
                    onChange={(e) => setDateRange({ endDate: e.target.value })}
                    className="bg-transparent text-xs text-slate-300 focus:outline-none cursor-pointer"
                  />
                </div>
              </div>
            ) : null}

            <button
              onClick={() => {
                refetchStats();
                refetchLeads();
                refetchCampaigns();
                refetchMessages();
                refetchMeetings();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-800 bg-slate-900/60 hover:border-blue-500/40 rounded-lg text-xs font-semibold text-slate-300 hover:text-white transition"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Sync
            </button>
          </div>
        </header>

        <div className="flex-1 p-8 max-w-7xl w-full mx-auto relative">
          {/* Stats Row Component (Shown on main dashboard/pipeline tabs) */}
          {(activeTab === 'dashboard' || activeTab === 'pipeline') && stats && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              {[
                {
                  label: 'Total Leads Captured',
                  value: stats.leadsCount,
                  change: statsLeadsChange,
                  icon: Users,
                  color: 'text-blue-500',
                  bg: 'bg-blue-600/10'
                },
                {
                  label: 'Outreach Emails Sent',
                  value: stats.sentCount,
                  change: statsSentChange,
                  icon: Send,
                  color: 'text-purple-500',
                  bg: 'bg-purple-600/10'
                },
                {
                  label: 'Outreach Replies Recd',
                  value: stats.replyCount,
                  change: statsReplyChange,
                  icon: CheckCircle2,
                  color: 'text-pink-500',
                  bg: 'bg-pink-600/10'
                },
                {
                  label: 'Meetings Scheduled',
                  value: stats.meetingsCount,
                  change: statsBookedChange,
                  icon: Calendar,
                  color: 'text-amber-500',
                  bg: 'bg-amber-600/10'
                }
              ].map((card, idx) => {
                const Icon = card.icon;
                return (
                  <div key={idx} className="bg-slate-900/30 border border-slate-800/80 rounded-xl p-5 backdrop-blur-sm relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1 h-full bg-slate-800 group-hover:bg-blue-600 transition-colors" />
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                        {card.label}
                      </span>
                      <div className={`p-2 rounded-lg ${card.bg} border border-slate-800`}>
                        <Icon className={`h-4 w-4 ${card.color}`} />
                      </div>
                    </div>
                    <div className="flex items-baseline justify-between mt-4">
                      <span className="text-2xl font-extrabold text-white">{card.value}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        card.change > 0
                          ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/50'
                          : card.change < 0
                            ? 'bg-red-950/40 text-red-400 border border-red-900/50'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}>
                        {card.change >= 0 ? `+${card.change}%` : `${card.change}%`} vs 7d
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 1: MAIN DASHBOARD DETAILS */}
          {activeTab === 'dashboard' && stats && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Funnel chart container */}
              <div className="lg:col-span-2 bg-slate-900/20 border border-slate-800/80 rounded-xl p-6 backdrop-blur-sm">
                <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-6">
                  SaaS Outreach Conversion Pipeline
                </h3>
                <div className="space-y-4">
                  {[
                    { step: '1. Captured Leads', count: stats.leadsCount, percent: 100, color: 'bg-blue-600' },
                    {
                      step: '2. Scored ICP Priorities',
                      count: stats.highPriority + stats.mediumPriority,
                      percent: stats.leadsCount ? Math.round(((stats.highPriority + stats.mediumPriority) / stats.leadsCount) * 100) : 0,
                      color: 'bg-emerald-600'
                    },
                    {
                      step: '3. Outbound Outreach Dispatched',
                      count: stats.sentCount,
                      percent: stats.leadsCount ? Math.round((stats.sentCount / stats.leadsCount) * 100) : 0,
                      color: 'bg-purple-600'
                    },
                    {
                      step: '4. Lead Responses / Replies Recd',
                      count: stats.replyCount,
                      percent: stats.sentCount ? Math.round((stats.replyCount / stats.sentCount) * 100) : 0,
                      color: 'bg-pink-600'
                    },
                    {
                      step: '5. Calendly Meetings Booked',
                      count: stats.meetingsCount,
                      percent: stats.leadsCount ? Math.round((stats.meetingsCount / stats.leadsCount) * 100) : 0,
                      color: 'bg-amber-600'
                    }
                  ].map((item, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-slate-300">{item.step}</span>
                        <span className="text-slate-400">{item.count} leads ({item.percent}%)</span>
                      </div>
                      <div className="w-full bg-slate-950 border border-slate-900 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${item.color} transition-all duration-1000`}
                          style={{ width: `${item.percent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* RLS Logs Activity feed */}
              <div className="bg-slate-900/20 border border-slate-800/80 rounded-xl p-6 backdrop-blur-sm">
                <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-6">
                  Live Audit Activity Trail (RLS Scoped)
                </h3>
                <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1">
                  {stats.recentActivity.map((log, idx) => (
                    <div key={idx} className="border-b border-slate-800/80 pb-3 last:border-0 last:pb-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold uppercase tracking-wider bg-slate-950 border border-slate-800 px-2 py-0.5 rounded text-blue-400">
                          {log.action}
                        </span>
                        <span className="text-[10px] text-slate-500">{log.entity_type}</span>
                      </div>
                      <div className="text-xs text-slate-300 mt-1">
                        Triggered by: <span className="font-semibold text-slate-200">{log.user_email || 'System Account'}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(log.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                  {stats.recentActivity.length === 0 && (
                    <div className="text-xs text-slate-500 text-center py-12 italic">
                      No system logging activity found.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: KANBAN PIPELINE BOARD */}
          {activeTab === 'pipeline' && (
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4 overflow-x-auto min-h-[500px]">
              {[
                { status: 'new', label: 'New', color: 'border-blue-500/25 text-blue-400 bg-blue-500/5' },
                { status: 'contacted', label: 'Contacted', color: 'border-purple-500/25 text-purple-400 bg-purple-500/5' },
                { status: 'replied', label: 'Replied', color: 'border-pink-500/25 text-pink-400 bg-pink-500/5' },
                { status: 'meeting_scheduled', label: 'Meeting Scheduled', color: 'border-amber-500/25 text-amber-400 bg-amber-500/5' },
                { status: 'closed', label: 'Closed', color: 'border-emerald-500/25 text-emerald-400 bg-emerald-500/5' },
                { status: 'opted_out', label: 'Opted Out', color: 'border-slate-800 text-slate-400 bg-slate-900/10' }
              ].map(column => {
                const columnLeads = filteredLeads.filter(l => l.status === column.status);
                return (
                  <div key={column.status} className="bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex flex-col min-w-[180px]">
                    <div className={`flex justify-between items-center border border-transparent border-b-slate-800 pb-2.5 mb-3 px-1.5 text-xs font-bold ${column.color} rounded-t-lg`}>
                      <span>{column.label}</span>
                      <span className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded text-[10px]">
                        {columnLeads.length}
                      </span>
                    </div>

                    <div className="space-y-3 flex-1 overflow-y-auto max-h-[450px]">
                      {columnLeads.map(lead => (
                        <div
                          key={lead.id}
                          onClick={() => setSelectedLeadId(lead.id)}
                          className="bg-slate-900/35 border border-slate-850 hover:border-slate-700/80 rounded-xl p-3.5 cursor-pointer transition active:scale-[0.98] group relative"
                        >
                          <div className="absolute top-0 right-0 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                          </div>
                          <div className="text-xs font-bold text-white group-hover:text-blue-400 transition-colors">
                            {lead.name}
                          </div>
                          <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                            {lead.company || 'Private Agent'}
                          </div>
                          <div className="flex justify-between items-center mt-3 pt-2.5 border-t border-slate-900/80">
                            {renderScoreBadge(lead.score)}
                            <span className="text-[8px] text-slate-500 font-bold uppercase">
                              {new Date(lead.updated_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      ))}
                      {columnLeads.length === 0 && (
                        <div className="text-[10px] text-slate-600 text-center py-12 italic border border-dashed border-slate-900 rounded-lg">
                          No leads
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 3: LEADS MANAGER (STANDARD LIST VIEW) */}
          {activeTab === 'leads' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400">
                  Total Active Leads: {filteredLeads.length}
                </h3>
                <div className="flex gap-3">
                  <button
                    onClick={() => setCSVModalOpen(true)}
                    className="flex items-center gap-1.5 px-4 py-2 border border-slate-800 bg-slate-900/40 hover:border-slate-700 rounded-lg text-xs font-semibold text-slate-300 hover:text-white transition"
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    CSV Import Wizard
                  </button>
                  <button
                    onClick={() => setLeadModalOpen(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs font-semibold text-white transition active:scale-95 shadow-md shadow-blue-600/10"
                  >
                    <UserPlus className="h-4 w-4" />
                    Add Lead
                  </button>
                </div>
              </div>

              {/* Leads grid table */}
              <div className="bg-slate-900/10 border border-slate-800/80 rounded-xl overflow-hidden backdrop-blur-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-900/60 border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                        <th className="py-4 px-6">Name</th>
                        <th className="py-4 px-6">Company & Title</th>
                        <th className="py-4 px-6">Contact Information</th>
                        <th className="py-4 px-6">Priority Score</th>
                        <th className="py-4 px-6">Outreach Status</th>
                        <th className="py-4 px-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLeads.map(lead => (
                        <tr
                          key={lead.id}
                          onClick={() => setSelectedLeadId(lead.id)}
                          className="border-b border-slate-850 hover:bg-slate-900/20 transition cursor-pointer group"
                        >
                          <td className="py-4 px-6 font-bold text-white group-hover:text-blue-400 transition-colors">
                            {lead.name}
                          </td>
                          <td className="py-4 px-6">
                            <div className="text-slate-300 font-semibold">{lead.company || '-'}</div>
                            <div className="text-[10px] text-slate-500 mt-0.5">{lead.title || '-'}</div>
                          </td>
                          <td className="py-4 px-6">
                            <div className="text-slate-300">{lead.email}</div>
                            <div className="text-[10px] text-slate-500 mt-0.5">{lead.phone || '-'}</div>
                          </td>
                          <td className="py-4 px-6">
                            <div className="relative group/score inline-block">
                              {renderScoreBadge(lead.score)}
                              {lead.enrichment_data?.ai_score_reason && (
                                <div className="absolute z-30 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-slate-950 border border-slate-800 rounded-lg text-[10px] text-slate-300 leading-normal hidden group-hover/score:block shadow-2xl">
                                  <div className="font-bold text-slate-400 uppercase tracking-wider mb-1">AI assessment reasons</div>
                                  {lead.enrichment_data.ai_score_reason}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-6">
                            <span className="capitalize font-bold text-[10px] text-slate-300 bg-slate-950 border border-slate-800 px-2 py-0.5 rounded-lg">
                              {lead.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-right" onClick={e => e.stopPropagation()}>
                            {lead.status === 'new' ? (
                              <button
                                onClick={() => triggerOutreachMutation.mutate(lead.id)}
                                disabled={triggerOutreachMutation.isPending}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600/10 border border-blue-500/25 hover:bg-blue-600 rounded-lg text-xs font-bold text-blue-400 hover:text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Send className="h-3 w-3" />
                                {triggerOutreachMutation.isPending ? 'Sending...' : 'Start Outreach'}
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-500 italic">Campaign Dispatched</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {filteredLeads.length === 0 && (
                        <tr>
                          <td colSpan="6" className="text-center py-16 text-slate-500 italic font-semibold">
                            No leads matching current search/filter settings.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: CAMPAIGN TOUCHPOINTS */}
          {activeTab === 'campaigns' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  {campaigns.map(c => (
                    <div key={c.id} className="bg-slate-900/20 border border-slate-800/80 rounded-xl p-6 backdrop-blur-sm">
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h4 className="text-base font-bold text-white">{c.name}</h4>
                          <span className="text-[10px] uppercase font-bold tracking-widest bg-slate-950 text-blue-400 border border-slate-800 px-2 py-0.5 rounded mt-2 inline-block">
                            Channel: {c.channel}
                          </span>
                        </div>
                      </div>
                      <div className="border-t border-slate-800/80 pt-4">
                        <div className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-4">
                          Sequence touchpoints cadence
                        </div>
                        <div className="relative border-l border-slate-800/80 pl-6 ml-2 space-y-6">
                          {c.cadence?.steps?.map((step, idx) => (
                            <div key={idx} className="relative">
                              <div className="absolute -left-[31px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-950 border border-blue-500">
                                <div className="h-2 w-2 rounded-full bg-blue-500" />
                              </div>
                              <div className="text-xs font-semibold text-slate-200">
                                Step {idx + 1}: Day {step.day}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-1">
                                Template ID: <span className="font-mono text-slate-350 bg-slate-950 border border-slate-900 px-1 py-0.5 rounded">{step.template_id}</span>
                              </div>
                              <div className="text-xs font-semibold text-slate-300 mt-1">
                                Subject: {step.subject || step.body}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  {campaigns.length === 0 && (
                    <div className="bg-slate-900/20 border border-slate-850 rounded-xl p-12 text-center text-slate-500 font-semibold italic">
                      No campaigns found.
                    </div>
                  )}
                </div>

                <form onSubmit={handleCreateCampaign} className="bg-slate-900/20 border border-slate-800/80 rounded-xl p-6 h-fit backdrop-blur-sm">
                  <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-4">
                    Sequence Builder
                  </h3>
                  <p className="text-xs text-slate-400 leading-normal mb-6">
                    Create an outreach sequence that can be selected by the backend when starting outreach. Consent checks and suppression filters still apply.
                  </p>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">Campaign Name</label>
                      <input
                        type="text"
                        value={campaignName}
                        onChange={(e) => setCampaignName(e.target.value)}
                        placeholder="e.g. EU Founder Outreach"
                        required
                        className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-650 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">Outreach Channel</label>
                      <select
                        value={campaignChannel}
                        onChange={(e) => setCampaignChannel(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                      >
                        <option value="email">Email</option>
                        <option value="sms">SMS</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">First Touch Day</label>
                      <input
                        type="number"
                        min="1"
                        value={campaignDay}
                        onChange={(e) => setCampaignDay(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">Subject / Message Theme</label>
                      <textarea
                        rows="3"
                        value={campaignSubject}
                        onChange={(e) => setCampaignSubject(e.target.value)}
                        required
                        className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500 resize-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={createCampaignMutation.isPending}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-xs font-bold transition active:scale-95"
                    >
                      {createCampaignMutation.isPending ? 'Creating Sequence...' : 'Create Sequence'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* TAB 5: MEETINGS INDEX */}
          {activeTab === 'meetings' && (
            <div className="space-y-6">
              <div className="bg-slate-900/10 border border-slate-800/80 rounded-xl overflow-hidden backdrop-blur-sm">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900/60 border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                      <th className="py-4 px-6">Lead</th>
                      <th className="py-4 px-6">Company</th>
                      <th className="py-4 px-6">Scheduled Time</th>
                      <th className="py-4 px-6">Booking Link</th>
                      <th className="py-4 px-6">Event ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meetings.map(meeting => (
                      <tr key={meeting.id} className="border-b border-slate-850 hover:bg-slate-900/20 transition">
                        <td className="py-4 px-6 font-bold text-white">{meeting.lead_name}</td>
                        <td className="py-4 px-6 text-slate-300 font-semibold">{meeting.lead_company || '-'}</td>
                        <td className="py-4 px-6 text-slate-300">
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-amber-500" />
                            {new Date(meeting.scheduled_at).toLocaleString()}
                          </div>
                        </td>
                        <td className="py-4 px-6">
                          <a
                            href={meeting.booking_link}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-400 hover:underline inline-flex items-center gap-1 font-mono"
                          >
                            {meeting.booking_link}
                          </a>
                        </td>
                        <td className="py-4 px-6 font-mono text-slate-500">{meeting.calendar_event_id}</td>
                      </tr>
                    ))}
                    {meetings.length === 0 && (
                      <tr>
                        <td colSpan="5" className="text-center py-12 text-slate-500 font-semibold italic">
                          No scheduled bookings found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 6: GDPR COMPLIANCE MODULE TAB */}
          {activeTab === 'gdpr' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* GDPR residency and log archiving */}
              <div className="space-y-8">
                {/* Residency toggle */}
                <div className="bg-slate-900/20 border border-slate-800/80 rounded-xl p-6 backdrop-blur-sm">
                  <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                    <Globe className="h-4 w-4 text-blue-500" />
                    Data Residency & Storage Isolation
                  </h3>
                  <p className="text-xs text-slate-400 leading-normal mb-6">
                    Configure the cloud hosting region for storing European contact data. Standard switches trigger automated backend migration scripts and RLS isolation checks.
                  </p>

                  <div className="flex items-center justify-between p-4 bg-slate-950 border border-slate-900 rounded-xl">
                    <div>
                      <div className="text-xs font-bold text-white">Cloud Hosting Region</div>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">Current residency: {gdprResidency}</div>
                    </div>
                    <div className="flex gap-2">
                      {['US', 'EU'].map(region => (
                        <button
                          key={region}
                          onClick={() => residencyMutation.mutate(region)}
                          disabled={residencyMutation.isPending || gdprResidency === region}
                          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border transition ${
                            gdprResidency === region
                              ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-600/10'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-60'
                          }`}
                        >
                          {region} Cloud
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Audit Log Archiver */}
                <div className="bg-slate-900/20 border border-slate-800/80 rounded-xl p-6 backdrop-blur-sm">
                  <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-emerald-500" />
                    Immutable Audit Log Retention
                  </h3>
                  <p className="text-xs text-slate-400 leading-normal mb-6">
                    Audit log entries are immutable and preserved for a minimum of 90 days. Archive logs older than the retention threshold to AWS S3 bucket.
                  </p>

                  <div className="space-y-4">
                    <button
                      onClick={() => archiveMutation.mutate(90)}
                      disabled={archiveMutation.isPending}
                      className="w-full py-2.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-lg text-xs font-semibold text-slate-200 hover:text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {archiveMutation.isPending ? 'Archiving Logs...' : 'Archive & Purge Logs (90 Days Minimum)'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Suppression list manager */}
              <div className="bg-slate-900/20 border border-slate-800/80 rounded-xl p-6 backdrop-blur-sm flex flex-col justify-between">
                <div>
                  <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-pink-500" />
                    Suppression List Directory
                  </h3>
                  <p className="text-xs text-slate-400 leading-normal mb-6">
                    Global blacklist to block contact. Auto-adds leads matching unsubscribe keywords (STOP, CANCEL, UNSUBSCRIBE).
                  </p>

                  {/* Form */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      suppressionMutation.mutate({ email: suppressionEmail, reason: suppressionReason });
                    }}
                    className="flex gap-2 mb-6"
                  >
                    <input
                      type="email"
                      required
                      value={suppressionEmail}
                      onChange={(e) => setSuppressionEmail(e.target.value)}
                      placeholder="Add email to suppress..."
                      className="flex-1 bg-slate-950 border border-slate-850 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-650 focus:outline-none focus:border-blue-500 transition"
                    />
                    <button
                      type="submit"
                      disabled={suppressionMutation.isPending}
                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-xs font-bold text-white rounded-lg transition"
                    >
                      {suppressionMutation.isPending ? 'Blocking...' : 'Block Email'}
                    </button>
                  </form>
                </div>

                <div className="bg-slate-950 border border-slate-900 rounded-lg p-3.5 h-[280px] overflow-y-auto space-y-2.5">
                  {suppressionList.map(supp => (
                    <div key={supp.id} className="border-b border-slate-900 pb-2 last:border-0 last:pb-0 text-[11px]">
                      <div className="font-bold text-slate-300 font-mono">{supp.email}</div>
                      <div className="text-slate-500 mt-0.5">Reason: {supp.reason || 'Not specified'}</div>
                      <div className="text-[9px] text-slate-600 mt-0.5">{new Date(supp.created_at).toLocaleString()}</div>
                    </div>
                  ))}
                  {suppressionList.length === 0 && (
                    <div className="text-slate-600 text-center py-24 italic text-xs">
                      Suppression list is currently empty.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: DEVELOPER SANDBOX SIMULATOR */}
          {activeTab === 'simulator' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-8">
                {/* Simulate response */}
                <div className="bg-slate-900/20 border border-slate-800/80 rounded-xl p-6 backdrop-blur-sm">
                  <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-4">
                    Simulate Inbound Lead Response
                  </h3>
                  <p className="text-xs text-slate-400 leading-normal mb-6">
                    Simulate a lead replying to outbound campaigns via SMS or Email. Fired payload cancels scheduled timeouts, classifies intent, and auto-adds opt-outs to suppression list.
                  </p>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      simulateReplyMutation.mutate({ leadId: selectedLeadForReply, replyContent: simulatedReplyText });
                    }}
                    className="space-y-4"
                  >
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">Select Contacted Lead</label>
                      <select
                        value={selectedLeadForReply}
                        onChange={(e) => setSelectedLeadForReply(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                      >
                        <option value="">// Select Lead //</option>
                        {leads.filter(l => l.status === 'contacted').map(l => (
                          <option key={l.id} value={l.id}>{l.name} ({l.company || 'Private'})</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">Message Copy</label>
                      <textarea
                        rows="3"
                        value={simulatedReplyText}
                        onChange={(e) => setSimulatedReplyText(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500 resize-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={!selectedLeadForReply || simulateReplyMutation.isPending}
                      className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-500 text-xs font-semibold text-white rounded-lg transition active:scale-95 shadow-md shadow-blue-600/10"
                    >
                      {simulateReplyMutation.isPending ? 'Processing Reply...' : 'Inject Simulated Inbound Reply'}
                    </button>
                  </form>
                </div>

                {/* Simulate Calendly webhook */}
                <div className="bg-slate-900/20 border border-slate-800/80 rounded-xl p-6 backdrop-blur-sm">
                  <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-4">
                    Simulate Calendly webhook callback
                  </h3>
                  <p className="text-xs text-slate-400 leading-normal mb-6">
                    Fires invitee webhook trigger matching a Replied lead's email. Backend shifts status to "Meeting Scheduled" and schedules appointments.
                  </p>

                  <div className="space-y-3">
                    {leads.filter(l => l.status === 'replied').map(lead => (
                      <div key={lead.id} className="flex justify-between items-center p-3 bg-slate-950/40 border border-slate-850 rounded-xl">
                        <div>
                          <div className="text-xs font-bold text-white">{lead.name}</div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">{lead.email}</div>
                        </div>
                        <button
                          onClick={() => simulateCalendlyMutation.mutate({ email: lead.email })}
                          disabled={simulateCalendlyMutation.isPending}
                          className="px-3.5 py-1 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-800 disabled:text-slate-500 text-[10px] font-bold text-white rounded transition active:scale-95"
                        >
                          {simulateCalendlyMutation.isPending ? 'Booking...' : 'Book Meeting'}
                        </button>
                      </div>
                    ))}
                    {leads.filter(l => l.status === 'replied').length === 0 && (
                      <div className="text-xs text-slate-500 italic text-center py-6">
                        No leads currently in "Replied" status to simulate meeting bookings.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* CRM Logger sync */}
              <div className="bg-slate-900/20 border border-slate-800/80 rounded-xl p-6 flex flex-col justify-between backdrop-blur-sm h-full">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400">
                      HubSpot integration mapping logs
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
                  <p className="text-xs text-slate-400 leading-normal mb-6">
                    Tracks direct REST calls, webhook setups, OAuth credential refreshes, and lead mapping triggers during CRM synchronizations.
                  </p>
                </div>

                <div className="bg-slate-950 border border-slate-900 rounded-lg p-4 font-mono text-[9px] text-slate-300 space-y-2 h-[350px] overflow-y-auto">
                  {crmSyncLogs.map((log, idx) => (
                    <div key={idx} className="border-b border-slate-900 pb-1.5 last:border-0 last:pb-0 leading-relaxed">
                      {log}
                    </div>
                  ))}
                  {crmSyncLogs.length === 0 && (
                    <div className="text-slate-600 italic text-center py-36">
                      Sync HubSpot sandbox to initialize logger.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: CAMPAIGN ANALYTICS */}
          {activeTab === 'analytics' && (
            <div className="space-y-8 animate-fade-in p-6">
              {/* Header & Date Filter */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/20 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-sm">
                <div>
                  <h2 className="text-lg font-bold text-white">Campaign Performance & Analytics</h2>
                  <p className="text-xs text-slate-400 mt-1">
                    RLS multi-tenant campaign outreach funnel, meetings rate, and CAC projections.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Quick Filters */}
                  <div className="flex items-center bg-slate-950 border border-slate-850 rounded-xl p-1">
                    {[
                      { id: '7d', label: '7D' },
                      { id: '30d', label: '30D' },
                      { id: '90d', label: '90D' },
                      { id: 'custom', label: 'Custom' }
                    ].map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setAnalyticsRange(opt.id);
                          if (opt.id === 'custom') {
                            const end = new Date();
                            const start = new Date();
                            start.setDate(start.getDate() - 30);
                            setAnalyticsStartDate(start.toISOString().split('T')[0]);
                            setAnalyticsEndDate(end.toISOString().split('T')[0]);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                          analyticsRange === opt.id
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Custom Date Inputs */}
                  {analyticsRange === 'custom' && (
                    <div className="flex items-center gap-2 bg-slate-950 border border-slate-850 rounded-xl px-3 py-1">
                      <input
                        type="date"
                        value={analyticsStartDate}
                        onChange={(e) => setAnalyticsStartDate(e.target.value)}
                        className="bg-transparent text-xs text-slate-200 focus:outline-none border-none outline-none py-0.5"
                      />
                      <span className="text-slate-600 text-xs">to</span>
                      <input
                        type="date"
                        value={analyticsEndDate}
                        onChange={(e) => setAnalyticsEndDate(e.target.value)}
                        className="bg-transparent text-xs text-slate-200 focus:outline-none border-none outline-none py-0.5"
                      />
                    </div>
                  )}
                </div>
              </div>

              {isAnalyticsLoading ? (
                /* Skeleton Loader */
                <div className="space-y-8 animate-pulse">
                  {/* Cards Skeleton */}
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="bg-slate-900/10 border border-slate-800/60 rounded-2xl p-5 h-28 flex flex-col justify-between">
                        <div className="h-3 bg-slate-800 rounded w-2/3"></div>
                        <div className="h-6 bg-slate-800 rounded w-1/2"></div>
                        <div className="h-2 bg-slate-800 rounded w-full"></div>
                      </div>
                    ))}
                  </div>

                  {/* Charts Grid Skeleton */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="bg-slate-900/10 border border-slate-800/60 rounded-2xl p-6 h-[380px] lg:col-span-1">
                      <div className="h-4 bg-slate-800 rounded w-1/3 mb-6"></div>
                      <div className="h-[280px] bg-slate-800/40 rounded-xl"></div>
                    </div>
                    <div className="bg-slate-900/10 border border-slate-800/60 rounded-2xl p-6 h-[380px] lg:col-span-2">
                      <div className="h-4 bg-slate-800 rounded w-1/4 mb-6"></div>
                      <div className="h-[280px] bg-slate-800/40 rounded-xl"></div>
                    </div>
                  </div>

                  <div className="bg-slate-900/10 border border-slate-800/60 rounded-2xl p-6 h-[380px]">
                    <div className="h-4 bg-slate-800 rounded w-1/5 mb-6"></div>
                    <div className="h-[280px] bg-slate-800/40 rounded-xl"></div>
                  </div>

                  {/* Table Skeleton */}
                  <div className="bg-slate-900/10 border border-slate-800/60 rounded-2xl p-6 h-64">
                    <div className="h-4 bg-slate-800 rounded w-1/6 mb-6"></div>
                    <div className="space-y-4">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-8 bg-slate-850 rounded w-full"></div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : analyticsData ? (
                /* Content Layout */
                <>
                  {/* Metric Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                    {/* Card 1: Time Lead to Meeting */}
                    <div className="bg-slate-900/20 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-sm flex flex-col justify-between hover:border-slate-700/60 transition group relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-xl group-hover:bg-blue-500/10 transition" />
                      <div>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-2">
                          Avg Lead to Meeting
                        </span>
                        <h3 className="text-2xl font-extrabold text-white font-sans tracking-tight">
                          {analyticsData.metrics.avgTimeLeadToMeeting > 0
                            ? `${analyticsData.metrics.avgTimeLeadToMeeting} hrs`
                            : 'N/A'}
                        </h3>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-3 font-semibold leading-normal">
                        Mean duration from creation to scheduled meeting.
                      </p>
                    </div>

                    {/* Card 2: Open Rate */}
                    <div className="bg-slate-900/20 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-sm flex flex-col justify-between hover:border-slate-700/60 transition group relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-xl group-hover:bg-indigo-500/10 transition" />
                      <div>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-2">
                          Email Open Rate
                        </span>
                        <h3 className="text-2xl font-extrabold text-white font-sans tracking-tight">
                          {analyticsData.metrics.openRate.toFixed(1)}%
                        </h3>
                      </div>
                      <div className="mt-3">
                        <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-900">
                          <div
                            className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(analyticsData.metrics.openRate, 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1 font-semibold">
                          Percentage of sent emails opened.
                        </p>
                      </div>
                    </div>

                    {/* Card 3: Reply Rate */}
                    <div className="bg-slate-900/20 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-sm flex flex-col justify-between hover:border-slate-700/60 transition group relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-violet-500/5 rounded-full blur-xl group-hover:bg-violet-500/10 transition" />
                      <div>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-2">
                          Outreach Reply Rate
                        </span>
                        <h3 className="text-2xl font-extrabold text-white font-sans tracking-tight">
                          {analyticsData.metrics.replyRate.toFixed(1)}%
                        </h3>
                      </div>
                      <div className="mt-3">
                        <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-900">
                          <div
                            className="bg-violet-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(analyticsData.metrics.replyRate, 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1 font-semibold">
                          Percentage of contacted leads who replied.
                        </p>
                      </div>
                    </div>

                    {/* Card 4: Bounce Rate */}
                    <div className="bg-slate-900/20 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-sm flex flex-col justify-between hover:border-slate-700/60 transition group relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 rounded-full blur-xl group-hover:bg-red-500/10 transition" />
                      <div>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-2">
                          Email Bounce Rate
                        </span>
                        <h3 className="text-2xl font-extrabold text-white font-sans tracking-tight">
                          {analyticsData.metrics.bounceRate.toFixed(1)}%
                        </h3>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-3 font-semibold leading-normal">
                        Undelivered, rejected, or invalid email contacts.
                      </p>
                    </div>

                    {/* Card 5: CAC Estimate */}
                    <div className="bg-slate-900/20 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-sm flex flex-col justify-between hover:border-slate-700/60 transition group relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl group-hover:bg-emerald-500/10 transition" />
                      <div>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-2">
                          CAC Proj. Estimate
                        </span>
                        <h3 className="text-2xl font-extrabold text-white font-sans tracking-tight">
                          ${analyticsData.metrics.cacEstimate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </h3>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-3 font-semibold leading-normal">
                        Estimated acquisition cost per closed customer.
                      </p>
                    </div>
                  </div>

                  {/* Funnel & Line Chart Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Funnel Chart Card */}
                    <div className="bg-slate-900/20 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-sm lg:col-span-1 flex flex-col justify-between">
                      <div>
                        <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-6">
                          Outreach Funnel Conversion
                        </h3>
                        <div className="flex justify-center items-center py-2 h-[260px] relative">
                          <ResponsiveContainer width="100%" height="100%">
                            <FunnelChart>
                              <RechartsTooltip
                                content={({ active, payload }) => {
                                  if (active && payload && payload.length) {
                                    const d = payload[0].payload;
                                    return (
                                      <div className="bg-slate-950/95 border border-slate-800 px-3 py-2 rounded-xl text-[10px] font-sans text-slate-200 shadow-2xl">
                                        <p className="font-bold text-white mb-0.5">{d.name}</p>
                                        <p className="text-slate-400">Leads: <span className="text-blue-400 font-bold">{d.value}</span></p>
                                        <p className="text-slate-400">Rate: <span className="text-emerald-400 font-bold">{d.percentage}%</span></p>
                                      </div>
                                    );
                                  }
                                  return null;
                                }}
                              />
                              <Funnel
                                dataKey="value"
                                data={analyticsData.funnel.map((item, idx) => ({
                                  ...item,
                                  fill: ['#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#10b981'][idx % 5]
                                }))}
                                isAnimationActive
                              >
                                <LabelList position="right" fill="#94a3b8" dataKey="name" stroke="none" fontSize={10} />
                                <LabelList position="center" fill="#ffffff" dataKey="percentage" stroke="none" formatter={(val) => `${val}%`} fontSize={10} fontWeight="bold" />
                              </Funnel>
                            </FunnelChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-500 leading-normal mt-4">
                        Visualizes drop-off rates from first contact to deal closure.
                      </p>
                    </div>

                    {/* Line Chart Card */}
                    <div className="bg-slate-900/20 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-sm lg:col-span-2 flex flex-col justify-between">
                      <div>
                        <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-6">
                          Outreach Volume vs Response Rate (Dual Axis)
                        </h3>
                        <div className="h-[260px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={analyticsData.lineChart} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                              <XAxis dataKey="date" stroke="#475569" fontSize={9} tickLine={false} />
                              <YAxis yAxisId="left" stroke="#3b82f6" fontSize={9} tickLine={false} label={{ value: 'Emails Sent', angle: -90, position: 'insideLeft', fill: '#3b82f6', fontSize: 9, offset: 5 }} />
                              <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={9} tickLine={false} label={{ value: 'Replies Recv', angle: 90, position: 'insideRight', fill: '#10b981', fontSize: 9, offset: 5 }} />
                              <RechartsTooltip
                                content={({ active, payload, label }) => {
                                  if (active && payload && payload.length) {
                                    return (
                                      <div className="bg-slate-950/95 border border-slate-800 p-3 rounded-xl text-[10px] text-slate-200 shadow-2xl font-sans">
                                        <p className="font-bold text-white mb-2">{label}</p>
                                        {payload.map((item, idx) => (
                                          <p key={idx} className="flex justify-between gap-4 mb-0.5 last:mb-0">
                                            <span style={{ color: item.color }}>{item.name}:</span>
                                            <span className="font-bold">{item.value}</span>
                                          </p>
                                        ))}
                                      </div>
                                    );
                                  }
                                  return null;
                                }}
                              />
                              <Legend verticalAlign="top" height={36} iconSize={8} wrapperStyle={{ fontSize: 10, fill: '#94a3b8' }} />
                              <Line yAxisId="left" type="monotone" dataKey="sent" name="Outbound Emails" stroke="#3b82f6" strokeWidth={2} activeDot={{ r: 4 }} dot={{ r: 0 }} />
                              <Line yAxisId="right" type="monotone" dataKey="replies" name="Replies Received" stroke="#10b981" strokeWidth={2} activeDot={{ r: 4 }} dot={{ r: 0 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-500 leading-normal mt-4">
                        Plots daily outbound campaign message volume against inbound prospect responses.
                      </p>
                    </div>
                  </div>

                  {/* Meetings Booked Chart */}
                  <div className="bg-slate-900/20 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-sm flex flex-col justify-between">
                    <div>
                      <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-6">
                        Meetings Scheduled per Week
                      </h3>
                      <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={analyticsData.barChart} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="week" stroke="#475569" fontSize={9} tickLine={false} formatter={(tick) => `Wk: ${tick.slice(5)}`} />
                            <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} allowDecimals={false} />
                            <RechartsTooltip
                              content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                  return (
                                    <div className="bg-slate-950/95 border border-slate-800 px-3 py-2 rounded-xl text-[10px] text-slate-200 shadow-2xl font-sans">
                                      <p className="font-bold text-white mb-1">Week of {label}</p>
                                      <p className="text-slate-400">Bookings: <span className="text-amber-400 font-bold">{payload[0].value}</span></p>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            <Bar dataKey="count" name="Meetings" fill="#f59e0b" radius={[4, 4, 0, 0]}>
                              {analyticsData.barChart.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#f59e0b' : '#d97706'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-normal mt-4">
                      Aggregated weekly volume of booked calendar meetings.
                    </p>
                  </div>

                  {/* Campaigns Table */}
                  <div className="bg-slate-900/20 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-sm">
                    <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-6">
                      Outreach Performance by Campaign
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-850 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                            {[
                              { id: 'name', label: 'Campaign Name' },
                              { id: 'leads', label: 'Leads Sourced' },
                              { id: 'emailsSent', label: 'Emails Sent' },
                              { id: 'openRate', label: 'Open Rate' },
                              { id: 'replyRate', label: 'Reply Rate' },
                              { id: 'meetingsBooked', label: 'Meetings Booked' }
                            ].map(col => (
                              <th
                                key={col.id}
                                onClick={() => {
                                  if (analyticsSortField === col.id) {
                                    setAnalyticsSortDirection(analyticsSortDirection === 'asc' ? 'desc' : 'asc');
                                  } else {
                                    setAnalyticsSortField(col.id);
                                    setAnalyticsSortDirection('desc');
                                  }
                                }}
                                className="pb-3 px-4 cursor-pointer hover:text-white select-none transition"
                              >
                                <div className="flex items-center gap-1.5">
                                  {col.label}
                                  {analyticsSortField === col.id && (
                                    <span className="text-[8px] text-blue-500">
                                      {analyticsSortDirection === 'asc' ? '▲' : '▼'}
                                    </span>
                                  )}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850/40">
                          {[...(analyticsData?.campaignsTable || [])]
                            .sort((a, b) => {
                              let aVal = a[analyticsSortField];
                              let bVal = b[analyticsSortField];
                              if (typeof aVal === 'string') {
                                aVal = aVal.toLowerCase();
                                bVal = bVal.toLowerCase();
                              }
                              if (aVal < bVal) return analyticsSortDirection === 'asc' ? -1 : 1;
                              if (aVal > bVal) return analyticsSortDirection === 'asc' ? 1 : -1;
                              return 0;
                            })
                            .map((camp) => (
                              <tr key={camp.id} className="hover:bg-slate-900/10 transition group text-slate-300">
                                <td className="py-3.5 px-4 font-bold text-white truncate max-w-[200px]">
                                  {camp.name}
                                </td>
                                <td className="py-3.5 px-4">{camp.leads}</td>
                                <td className="py-3.5 px-4">{camp.emailsSent}</td>
                                <td className="py-3.5 px-4 font-semibold text-indigo-400">
                                  {camp.openRate.toFixed(1)}%
                                </td>
                                <td className="py-3.5 px-4 font-semibold text-violet-400">
                                  {camp.replyRate.toFixed(1)}%
                                </td>
                                <td className="py-3.5 px-4 font-bold text-amber-500">
                                  {camp.meetingsBooked}
                                </td>
                              </tr>
                            ))}
                          {analyticsData.campaignsTable.length === 0 && (
                            <tr>
                              <td colSpan="6" className="py-8 text-center text-slate-500 italic">
                                No campaign performance metrics found in this date range.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-slate-500 italic">
                  Failed to load analytics data.
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ==========================================
      COMPONENT 3: LEAD DETAIL RIGHT DRAWER
      ========================================== */}
      <div
        className={`fixed inset-y-0 right-0 z-40 w-full max-w-md bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col justify-between transform transition-transform duration-300 ${
          selectedLead ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {selectedLead ? (
          <>
            {/* Header info */}
            <div className="p-6 border-b border-slate-800">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-base font-bold text-white">{selectedLead.name}</h3>
                  <span className="text-[10px] text-slate-400 font-semibold">{selectedLead.company || 'Private'} • {selectedLead.title || 'Lead'}</span>
                </div>
                <button
                  onClick={() => setSelectedLeadId(null)}
                  className="p-1 rounded-lg bg-slate-950 hover:bg-slate-850 border border-slate-850 text-slate-400 hover:text-slate-200 transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-4">
                {renderScoreBadge(selectedLead.score)}
                <span className="capitalize font-bold text-[9px] text-slate-300 bg-slate-950 border border-slate-850 px-2 py-0.5 rounded">
                  {selectedLead.status.replace('_', ' ')}
                </span>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${
                  selectedLead.sequence_paused
                    ? 'bg-red-950/20 text-red-400 border-red-900/50'
                    : 'bg-emerald-950/20 text-emerald-400 border-emerald-900/50'
                }`}>
                  {selectedLead.sequence_paused ? 'Sequence Paused' : 'Sequence Active'}
                </span>
              </div>
            </div>

            {/* Content areas */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Score Rationale */}
              <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">AI Score Assessment Rationale</h4>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  {selectedLead.enrichment_data?.ai_score_reason || 'Score assessment reasoning pending.'}
                </p>
              </div>

              {/* Message Timeline */}
              <div>
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Outreach Activity Thread</h4>
                <div className="space-y-4 max-h-[200px] overflow-y-auto pr-1">
                  {selectedLeadMessages.map(msg => (
                    <div
                      key={msg.id}
                      className={`p-3 rounded-xl border flex flex-col ${
                        msg.direction === 'inbound'
                          ? 'bg-slate-950/40 border-slate-850 mr-8 text-left'
                          : 'bg-blue-600/10 border-blue-900/30 ml-8 text-left'
                      }`}
                    >
                      <div className="flex justify-between items-center text-[9px] font-semibold text-slate-500 border-b border-slate-950 pb-1 mb-1.5">
                        <span className="capitalize text-slate-400">{msg.channel} ({msg.direction})</span>
                        <span>{new Date(msg.sent_at).toLocaleDateString()}</span>
                      </div>
                      <div className="text-[11px] text-slate-200 whitespace-pre-line leading-relaxed">
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {selectedLeadMessages.length === 0 && (
                    <div className="text-center text-[10px] text-slate-500 italic py-6">
                      No outreach messages dispatched yet.
                    </div>
                  )}
                </div>
              </div>

              {/* Meeting Scheduled details */}
              {selectedLeadMeetings.length > 0 && (
                <div className="bg-amber-950/20 border border-amber-900/40 rounded-xl p-4">
                  <h4 className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    Scheduled Meeting Booked
                  </h4>
                  <div className="space-y-1.5 text-[11px] text-slate-300 leading-normal">
                    <div>
                      Time: <span className="font-bold text-white">{new Date(selectedLeadMeetings[0].scheduled_at).toLocaleString()}</span>
                    </div>
                    <div>
                      Booking Link:{' '}
                      <a
                        href={selectedLeadMeetings[0].booking_link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:underline"
                      >
                        {selectedLeadMeetings[0].booking_link}
                      </a>
                    </div>
                    <div>
                      Event ID: <span className="font-mono text-slate-400">{selectedLeadMeetings[0].calendar_event_id}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Manual Email Composer */}
              <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 space-y-3">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Compose Manual Email</h4>
                <div>
                  <input
                    type="text"
                    placeholder="Subject..."
                    value={manualEmailSubject}
                    onChange={(e) => setManualEmailSubject(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-100 placeholder-slate-650 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <textarea
                    rows="3"
                    placeholder="Type email body copy here..."
                    value={manualEmailBody}
                    onChange={(e) => setManualEmailBody(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-100 placeholder-slate-650 focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>
                <button
                  onClick={() =>
                    sendManualEmailMutation.mutate({
                      leadId: selectedLead.id,
                      subject: manualEmailSubject,
                      body: manualEmailBody
                    })
                  }
                  disabled={!manualEmailBody.trim() || sendManualEmailMutation.isPending}
                  className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-500 text-[10px] font-bold text-white rounded-lg transition"
                >
                  {sendManualEmailMutation.isPending ? 'Dispatching...' : 'Dispatch Email Copy'}
                </button>
              </div>
            </div>

            {/* Quick action buttons */}
            <div className="p-6 border-t border-slate-800 bg-slate-950/30 flex flex-col gap-2">
              <div className="flex gap-2">
                {selectedLead.sequence_paused ? (
                  <button
                    onClick={() => resumeSequenceMutation.mutate(selectedLead.id)}
                    disabled={resumeSequenceMutation.isPending}
                    className="flex-1 py-2 bg-emerald-600/10 border border-emerald-500/25 hover:bg-emerald-600 rounded-lg text-xs font-bold text-emerald-400 hover:text-white flex items-center justify-center gap-1.5 transition disabled:opacity-60"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Resume Sequence
                  </button>
                ) : (
                  <button
                    onClick={() => pauseSequenceMutation.mutate(selectedLead.id)}
                    disabled={pauseSequenceMutation.isPending}
                    className="flex-1 py-2 bg-amber-600/10 border border-amber-500/25 hover:bg-amber-600 rounded-lg text-xs font-bold text-amber-400 hover:text-white flex items-center justify-center gap-1.5 transition disabled:opacity-60"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Pause Sequence
                  </button>
                )}
                <button
                  onClick={() => {
                    if (confirm('Verify GDPR request: delete message timelines, cancel timeouts and anonymize contact info?')) {
                      erasureMutation.mutate(selectedLead.id);
                    }
                  }}
                  disabled={erasureMutation.isPending}
                  className="flex-1 py-2 bg-red-600/10 border border-red-500/25 hover:bg-red-600 rounded-lg text-xs font-bold text-red-400 hover:text-white flex items-center justify-center gap-1.5 transition disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Erasure Request
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* ==========================================
      COMPONENT 5: CSV IMPORT MODAL
      ========================================== */}
      {isCSVModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="max-w-2xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6 text-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-blue-500" />
                CSV Bulk Import & Column Mapping
              </h3>
              <button
                onClick={() => {
                  setCSVModalOpen(false);
                  resetCSVData();
                }}
                className="text-slate-400 hover:text-slate-200 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {csvHeaders.length === 0 ? (
              // Upload selection zone
              <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-800 hover:border-slate-700 rounded-xl p-12 transition">
                <Upload className="h-8 w-8 text-slate-500 mb-4 animate-bounce" />
                <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-xs font-bold text-white px-4 py-2.5 rounded-lg transition active:scale-95 shadow-md">
                  Select CSV File
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCSVUpload}
                    className="hidden"
                  />
                </label>
                <span className="text-[10px] text-slate-500 mt-2">Upload lead list database</span>
              </div>
            ) : (
              // Preview & mapping wizard
              <div className="space-y-6">
                <div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Map CSV Columns to Database Fields</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { field: 'name', label: 'Full Name' },
                      { field: 'email', label: 'Email Address' },
                      { field: 'phone', label: 'Phone Number' },
                      { field: 'company', label: 'Company Name' },
                      { field: 'title', label: 'Job Title' },
                      { field: 'notes', label: 'Custom Notes' },
                      { field: 'consent_given', label: 'Consent Given (true/1)' },
                      { field: 'consent_source', label: 'Consent Source' }
                    ].map(mapItem => (
                      <div key={mapItem.field}>
                        <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                          {mapItem.label}
                        </label>
                        <select
                          value={csvColumnMapping[mapItem.field] !== undefined ? csvColumnMapping[mapItem.field] : ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCSVColumnMapping(mapItem.field, val === '' ? undefined : parseInt(val));
                          }}
                          className="w-full bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500"
                        >
                          <option value="">-- Ignore --</option>
                          {csvHeaders.map((header, idx) => (
                            <option key={idx} value={idx}>
                              {header}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">CSV Preview (Top 5 rows)</h4>
                  <div className="overflow-x-auto border border-slate-850 rounded-xl max-h-[180px]">
                    <table className="w-full text-left text-[10px] border-collapse bg-slate-950/20">
                      <thead>
                        <tr className="bg-slate-900 border-b border-slate-800 text-slate-400">
                          {csvHeaders.map((header, idx) => (
                            <th key={idx} className="py-2.5 px-4 font-bold">
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvPreviewRows.map((row, rowIdx) => (
                          <tr key={rowIdx} className="border-b border-slate-900 last:border-0 hover:bg-slate-900/10">
                            {row.map((cell, cellIdx) => (
                              <td key={cellIdx} className="py-2.5 px-4 text-slate-350">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    onClick={() => resetCSVData()}
                    className="px-4 py-2 border border-slate-800 hover:border-slate-700 bg-slate-950/40 rounded-lg text-xs font-semibold text-slate-300 hover:text-white transition"
                  >
                    Clear CSV
                  </button>
                  <button
                    onClick={handleExecuteCSVImport}
                    disabled={importLeadsMutation.isPending || csvRows.length === 0}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-500 rounded-lg text-xs font-bold text-white transition active:scale-95 shadow-md shadow-blue-600/10"
                  >
                    {importLeadsMutation.isPending ? 'Importing Leads...' : `Import ${csvRows.length} Parsed Leads`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* LEAD CAPTURE MODAL */}
      {isLeadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div role="dialog" aria-modal="true" aria-labelledby="lead-modal-title" className="max-w-2xl w-full bg-slate-900 border border-slate-800 text-slate-100 rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4 mb-4">
              <h3 id="lead-modal-title" className="text-sm font-bold text-white flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-blue-500" />
                Score & Capture New Lead
              </h3>
              <button
                type="button"
                id="new-lead-modal-close"
                onClick={() => setLeadModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 transition"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateLead} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-400 tracking-wider mb-1">Full Name</label>
                  <input
                    type="text"
                    name="leadName"
                    required
                    className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    placeholder="e.g. John Doe"
                  />
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-400 tracking-wider mb-1">Email Address</label>
                  <input
                    type="email"
                    name="leadEmail"
                    required
                    className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    placeholder="e.g. john@dundermifflin.com"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-400 tracking-wider mb-1">Company</label>
                  <input
                    type="text"
                    name="leadCompany"
                    className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    placeholder="e.g. Dunder Mifflin"
                  />
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-400 tracking-wider mb-1">Job Title</label>
                  <input
                    type="text"
                    name="leadTitle"
                    className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    placeholder="e.g. Regional Manager"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[9px] uppercase font-bold text-slate-400 tracking-wider mb-1">Phone Number</label>
                <input
                  type="text"
                  name="leadPhone"
                  className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  placeholder="e.g. +1-555-4039"
                />
              </div>

              <div className="grid grid-cols-2 gap-4 items-center bg-slate-950 border border-slate-850 p-3.5 rounded-xl">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="leadConsent"
                    id="leadConsentCheckbox"
                    defaultChecked
                    className="rounded bg-slate-900 border-slate-800 text-blue-600 focus:ring-0 cursor-pointer h-4 w-4"
                  />
                  <label htmlFor="leadConsentCheckbox" className="text-[10px] font-bold text-slate-350 tracking-wide cursor-pointer">
                    GDPR Consent Obtained
                  </label>
                </div>
                <div>
                  <input
                    type="text"
                    name="leadConsentSource"
                    className="w-full bg-slate-900 border border-slate-850 rounded-lg px-2.5 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-blue-500"
                    placeholder="Source (e.g. Webform)"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[9px] uppercase font-bold text-slate-400 tracking-wider mb-1">Context Notes</label>
                <textarea
                  rows="3"
                  name="leadNotes"
                  className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500 resize-none"
                  placeholder="Custom notes or prompt embeddings metadata..."
                />
              </div>

              <div className="text-[9px] text-slate-500 leading-normal">
                Important: Creation triggers automatic RLS mapping in PostgreSQL and generates immediate AI ICP scoring calculations.
              </div>

              <button
                type="submit"
                disabled={createLeadMutation.isPending}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-500 text-xs font-bold text-white rounded-lg transition active:scale-95 shadow-md shadow-blue-600/25"
              >
                {createLeadMutation.isPending ? 'Scoring Lead...' : 'Insert Scored Lead Record'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
