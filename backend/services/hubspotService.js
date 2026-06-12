const crypto = require('crypto');
const cron = require('node-cron');
const { query, tenantStorage } = require('../db/db');
const { encrypt, decrypt } = require('../utils/encryption');

// Mappings for lead status values between HubSpot and internal
function mapHubSpotStatusToInternal(hsStatus) {
  const s = (hsStatus || '').toLowerCase();
  if (s === 'new') return 'new';
  if (s === 'contacted') return 'contacted';
  if (s === 'in_progress' || s === 'replied') return 'replied';
  if (s === 'meeting_scheduled') return 'meeting_scheduled';
  if (s === 'closed') return 'closed';
  if (s === 'opted_out' || s === 'unsubscribed') return 'opted_out';
  return 'new';
}

function mapInternalStatusToHubSpot(status) {
  if (status === 'new') return 'NEW';
  if (status === 'contacted') return 'CONTACTED';
  if (status === 'replied') return 'IN_PROGRESS';
  if (status === 'meeting_scheduled') return 'MEETING_SCHEDULED';
  if (status === 'closed') return 'CLOSED';
  if (status === 'opted_out') return 'OPTED_OUT';
  return 'NEW';
}

/**
 * Returns HubSpot OAuth consent URL.
 */
function getOAuthUrl(tenantId) {
  const redirectUri = process.env.HUBSPOT_REDIRECT_URI || 'http://localhost:5000/api/integrations/hubspot/callback';
  const state = JSON.stringify({ tenantId });
  const scopes = ['oauth', 'crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.deals.write'].join(' ');

  const clientId = process.env.HUBSPOT_CLIENT_ID;
  if (!clientId) {
    // Return simulated OAuth url for offline/test mode
    return `https://app.hubspot.com/oauth/authorize/mock?client_id=mock_id&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`;
  }

  return `https://app.hubspot.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`;
}

/**
 * Handles OAuth authorization code callback exchange.
 */
async function handleCallback(code, tenantId) {
  let tokens = {
    access_token: 'mock_hubspot_access_token_123',
    refresh_token: 'mock_hubspot_refresh_token_123',
    expires_in: 1800
  };

  if (process.env.HUBSPOT_CLIENT_ID && process.env.HUBSPOT_CLIENT_SECRET) {
    const redirectUri = process.env.HUBSPOT_REDIRECT_URI || 'http://localhost:5000/api/integrations/hubspot/callback';
    const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: process.env.HUBSPOT_CLIENT_ID,
        client_secret: process.env.HUBSPOT_CLIENT_SECRET,
        redirect_uri: redirectUri
      }).toString()
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HubSpot OAuth code exchange failed: ${errText}`);
    }

    tokens = await response.json();
  }

  const encrypted = encrypt(tokens.refresh_token);
  const hubspotSettings = {
    access_token: tokens.access_token,
    expires_at: Date.now() + (tokens.expires_in * 1000),
    encrypted_refresh_token: encrypted.encryptedData,
    iv: encrypted.iv,
    status: 'active',
    last_sync_at: 0,
    updated_at: Date.now()
  };

  // Update tenant settings (global query since active RLS context isn't set yet)
  const tenantRes = await query('SELECT settings FROM tenants WHERE id = $1', [tenantId], false);
  const currentSettings = tenantRes.rows[0]?.settings || {};
  const updatedSettings = {
    ...currentSettings,
    hubspot: hubspotSettings
  };

  await query('UPDATE tenants SET settings = $1 WHERE id = $2', [JSON.stringify(updatedSettings), tenantId], false);

  // Log Audit Log
  await query(`
    INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
    VALUES ($1, NULL, 'CONNECT_HUBSPOT_INTEGRATION', 'tenants', $1, $2)
  `, [tenantId, JSON.stringify({ success: true })], false);

  return { success: true };
}

/**
 * Disables HubSpot integration when token refresh fails.
 */
async function handleDeactivatedIntegration(tenantId, reason) {
  console.warn(`Deactivating HubSpot integration for tenant ${tenantId}. Reason: ${reason}`);
  
  const tenantRes = await query('SELECT settings FROM tenants WHERE id = $1', [tenantId], false);
  const currentSettings = tenantRes.rows[0]?.settings || {};
  if (currentSettings.hubspot) {
    currentSettings.hubspot.status = 'inactive';
  }

  await query('UPDATE tenants SET settings = $1 WHERE id = $2', [JSON.stringify(currentSettings), tenantId], false);

  await query(`
    INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
    VALUES ($1, NULL, 'HUBSPOT_INTEGRATION_DEACTIVATED', 'tenants', $1, $2)
  `, [tenantId, JSON.stringify({ reason })], false);
}

/**
 * Returns a fresh access token for HubSpot integration.
 */
async function getFreshAccessToken(tenantId) {
  const tenantRes = await query('SELECT settings FROM tenants WHERE id = $1', [tenantId], false);
  if (tenantRes.rows.length === 0) {
    throw new Error('Tenant not found.');
  }

  const settings = tenantRes.rows[0].settings?.hubspot;
  if (!settings || settings.status !== 'active') {
    throw new Error('HubSpot integration is not connected or is inactive.');
  }

  if (settings.access_token && settings.expires_at > Date.now() + 60000) {
    return settings.access_token;
  }

  if (!settings.encrypted_refresh_token || !settings.iv) {
    throw new Error('No refresh token found for HubSpot integration.');
  }

  // Decrypt refresh token
  let refreshToken;
  try {
    refreshToken = decrypt(settings.encrypted_refresh_token, settings.iv);
  } catch (err) {
    throw new Error(`Failed to decrypt HubSpot refresh token: ${err.message}`);
  }

  let access_token = 'mock_hubspot_access_token_refreshed_123';
  let expires_in = 1800;

  if (process.env.HUBSPOT_CLIENT_ID && process.env.HUBSPOT_CLIENT_SECRET) {
    try {
      const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: process.env.HUBSPOT_CLIENT_ID,
          client_secret: process.env.HUBSPOT_CLIENT_SECRET,
          refresh_token: refreshToken
        }).toString()
      });

      if (!response.ok) {
        const errText = await response.text();
        const errJson = JSON.parse(errText || '{}');

        if (errJson.error === 'invalid_grant' || response.status === 400 || response.status === 401) {
          await handleDeactivatedIntegration(tenantId, `OAuth refresh failed: ${errJson.error_description || errJson.error}`);
        }
        throw new Error(`HubSpot token refresh failed: ${errText}`);
      }

      const refreshData = await response.json();
      access_token = refreshData.access_token;
      expires_in = refreshData.expires_in;
    } catch (err) {
      console.error('Failed to auto-refresh HubSpot access token:', err.message);
      throw err;
    }
  }

  // Save refreshed token
  const updatedHubspot = {
    ...settings,
    access_token,
    expires_at: Date.now() + (expires_in * 1000),
    updated_at: Date.now()
  };

  const updatedSettings = {
    ...tenantRes.rows[0].settings,
    hubspot: updatedHubspot
  };

  await query('UPDATE tenants SET settings = $1 WHERE id = $2', [JSON.stringify(updatedSettings), tenantId], false);

  return access_token;
}

/**
 * Logs a conflict for admin review in audit logs.
 */
async function logConflict(tenantId, entityId, localValue, hubspotValue, resolutionChosen) {
  await query(`
    INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
    VALUES ($1, NULL, 'HUBSPOT_SYNC_CONFLICT', 'leads', $2, $3)
  `, [
    tenantId,
    entityId,
    JSON.stringify({
      local: localValue,
      hubspot: hubspotValue,
      resolution: resolutionChosen,
      resolved_at: new Date().toISOString()
    })
  ], false);
}

/**
 * Imports new or updated contacts from HubSpot and maps to local lead records.
 */
async function importFromHubSpot(tenantId, accessToken, sinceTime) {
  let contacts = [];

  if (process.env.HUBSPOT_CLIENT_ID) {
    const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'lastmodifieddate',
                operator: 'GTE',
                value: new Date(sinceTime).toISOString()
              }
            ]
          }
        ],
        properties: ['firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle', 'hs_lead_status', 'lastmodifieddate'],
        sorts: ['lastmodifieddate']
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch HubSpot contacts: ${await response.text()}`);
    }

    const data = await response.json();
    contacts = data.results || [];
  } else {
    // MOCK IMPORT MODE
    contacts = [
      {
        id: 'hs_contact_mock_001',
        properties: {
          firstname: 'HubSpot',
          lastname: 'Import',
          email: 'hs.import@acme.com',
          phone: '+15550001',
          company: 'Acme CRM Corp',
          jobtitle: 'Integration Manager',
          hs_lead_status: 'NEW',
          lastmodifieddate: new Date(Date.now() + 1000).toISOString()
        }
      }
    ];
  }

  for (const contact of contacts) {
    const hsId = contact.id;
    const props = contact.properties;
    const email = props.email;
    if (!email) continue;

    const fullName = `${props.firstname || ''} ${props.lastname || ''}`.trim() || 'Unknown Contact';
    const status = mapHubSpotStatusToInternal(props.hs_lead_status);
    const hsModifiedTime = new Date(props.lastmodifieddate).getTime();

    await tenantStorage.run({ tenantId }, async () => {
      // 1. Deduplicate by email
      const leadRes = await query('SELECT * FROM leads WHERE email = $1', [email]);
      
      if (leadRes.rows.length > 0) {
        const lead = leadRes.rows[0];
        const localModifiedTime = new Date(lead.updated_at).getTime();

        // Check if HubSpot is newer (Conflict resolution: prefer most recent)
        if (hsModifiedTime > localModifiedTime) {
          // If local was also modified since last sync, log a conflict
          if (localModifiedTime > sinceTime) {
            await logConflict(tenantId, lead.id, { status: lead.status, name: lead.name }, { status, name: fullName }, 'hubspot_preferred_newer');
          }

          // Update local lead
          await query(`
            UPDATE leads 
            SET name = $1, phone = $2, company = $3, title = $4, status = $5, enrichment_data = enrichment_data || $6::jsonb, updated_at = NOW()
            WHERE id = $7
          `, [fullName, props.phone, props.company, props.jobtitle, status, JSON.stringify({ hubspot_contact_id: hsId }), lead.id]);
        }
      } else {
        // Create new lead
        const insertRes = await query(`
          INSERT INTO leads (tenant_id, name, email, phone, company, title, status, enrichment_data)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *;
        `, [tenantId, fullName, email, props.phone, props.company, props.jobtitle, status, JSON.stringify({ hubspot_contact_id: hsId })]);

        await query(`
          INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
          VALUES ($1, NULL, 'IMPORT_HUBSPOT_CONTACT', 'leads', $2, $3)
        `, [tenantId, insertRes.rows[0].id, JSON.stringify({ hubspot_contact_id: hsId })]);
      }
    });
  }
}

/**
 * Exports new or updated local leads since last sync to HubSpot.
 */
async function exportToHubSpot(tenantId, accessToken, sinceTime) {
  let leadsToExport = [];
  
  await tenantStorage.run({ tenantId }, async () => {
    const leadsRes = await query('SELECT * FROM leads WHERE updated_at >= $1', [new Date(sinceTime).toISOString()]);
    leadsToExport = leadsRes.rows;
  });

  for (const lead of leadsToExport) {
    const hsId = lead.enrichment_data?.hubspot_contact_id;
    const names = (lead.name || '').split(' ');
    const firstname = names[0] || '';
    const lastname = names.slice(1).join(' ') || '';
    const hsStatus = mapInternalStatusToHubSpot(lead.status);

    const properties = {
      firstname,
      lastname,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
      jobtitle: lead.title,
      hs_lead_status: hsStatus
    };

    if (hsId) {
      if (process.env.HUBSPOT_CLIENT_ID) {
        // Fetch contact to compare timestamps
        const fetchRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${hsId}?properties=lastmodifieddate`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        if (fetchRes.ok) {
          const contactData = await fetchRes.json();
          const hsModifiedTime = new Date(contactData.properties.lastmodifieddate).getTime();
          const localModifiedTime = new Date(lead.updated_at).getTime();

          if (localModifiedTime > hsModifiedTime) {
            // Log conflict if HubSpot was also modified since last sync
            if (hsModifiedTime > sinceTime) {
              await logConflict(tenantId, lead.id, { status: lead.status }, { status: mapHubSpotStatusToInternal(contactData.properties.hs_lead_status) }, 'local_preferred_newer');
            }

            // Push updates to HubSpot
            await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${hsId}`, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ properties })
            });
          }
        }
      }
    } else {
      // Find by email or create new contact
      let newHsId = null;

      if (process.env.HUBSPOT_CLIENT_ID) {
        const searchRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [{ propertyName: 'email', operator: 'EQ', value: lead.email }]
              }
            ],
            properties: ['lastmodifieddate']
          })
        });

        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (searchData.results && searchData.results.length > 0) {
            newHsId = searchData.results[0].id;
          }
        }

        if (!newHsId) {
          // Create new contact in HubSpot
          const createRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ properties })
          });

          if (createRes.ok) {
            const createData = await createRes.json();
            newHsId = createData.id;
          }
        }
      } else {
        newHsId = 'mock_hs_id_' + Date.now();
      }

      if (newHsId) {
        // Link to local lead
        await tenantStorage.run({ tenantId }, async () => {
          await query(
            "UPDATE leads SET enrichment_data = enrichment_data || $1::jsonb WHERE id = $2",
            [JSON.stringify({ hubspot_contact_id: newHsId }), lead.id]
          );
        });
      }
    }
  }
}

/**
 * Triggers bidirectional synchronization manually or via cron.
 */
async function syncHubSpot(tenantId) {
  const accessToken = await getFreshAccessToken(tenantId);

  const tenantRes = await query('SELECT settings FROM tenants WHERE id = $1', [tenantId], false);
  const settings = tenantRes.rows[0]?.settings || {};
  const hubspotSettings = settings.hubspot || {};
  const sinceTime = hubspotSettings.last_sync_at || 0;
  const now = Date.now();

  try {
    // 1. Import new updates from HubSpot
    await importFromHubSpot(tenantId, accessToken, sinceTime);

    // 2. Export local updates to HubSpot
    await exportToHubSpot(tenantId, accessToken, sinceTime);

    // Update last sync timestamp
    hubspotSettings.last_sync_at = now;
    settings.hubspot = hubspotSettings;
    await query('UPDATE tenants SET settings = $1 WHERE id = $2', [JSON.stringify(settings), tenantId], false);

    // Log sync audit activity
    await query(`
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, NULL, 'HUBSPOT_SYNC_SUCCESS', 'tenants', $1, $2)
    `, [tenantId, JSON.stringify({ duration: Date.now() - now })], false);

    return { success: true };
  } catch (err) {
    console.error(`HubSpot Sync Error for tenant ${tenantId}:`, err.message);
    throw err;
  }
}

/**
 * Real-time push: Update HubSpot Contact when lead status changes.
 */
async function pushLeadUpdate(tenantId, leadId) {
  let lead = null;
  await tenantStorage.run({ tenantId }, async () => {
    const res = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
    lead = res.rows[0];
  });

  if (!lead) return;

  const accessToken = await getFreshAccessToken(tenantId);
  const hsId = lead.enrichment_data?.hubspot_contact_id;
  const hsStatus = mapInternalStatusToHubSpot(lead.status);

  if (hsId && process.env.HUBSPOT_CLIENT_ID) {
    const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${hsId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: { hs_lead_status: hsStatus }
      })
    });
    
    if (!response.ok) {
      console.error(`Failed to patch HubSpot contact status: ${await response.text()}`);
    }
  }
}

/**
 * Real-time push: Create HubSpot Deal and associate it with HubSpot Contact when meeting is booked.
 */
async function createHubSpotDeal(tenantId, meetingId) {
  let meeting = null;
  let lead = null;

  await tenantStorage.run({ tenantId }, async () => {
    const meetRes = await query('SELECT * FROM meetings WHERE id = $1', [meetingId]);
    meeting = meetRes.rows[0];
    if (meeting) {
      const leadRes = await query('SELECT * FROM leads WHERE id = $1', [meeting.lead_id]);
      lead = leadRes.rows[0];
    }
  });

  if (!meeting || !lead) return;

  const accessToken = await getFreshAccessToken(tenantId);
  const contactId = lead.enrichment_data?.hubspot_contact_id;
  if (!contactId) {
    console.warn(`Skipping HubSpot Deal creation: Lead ${lead.id} has no HubSpot contact ID linked.`);
    return;
  }

  let dealId = 'mock_hs_deal_id_' + Date.now();

  if (process.env.HUBSPOT_CLIENT_ID) {
    // 1. Create Deal in HubSpot
    const dealRes = await fetch('https://api.hubapi.com/crm/v3/objects/deals', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: {
          dealname: `Sales Outreach Deal — ${lead.name}`,
          dealstage: 'appointmentscheduled',
          pipeline: 'default'
        }
      })
    });

    if (!dealRes.ok) {
      console.error(`Failed to create HubSpot Deal: ${await dealRes.text()}`);
      return;
    }

    const dealData = await dealRes.json();
    dealId = dealData.id;

    // 2. Associate Deal with Contact
    const assocRes = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/3`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!assocRes.ok) {
      console.error(`Failed to associate HubSpot Deal with Contact: ${await assocRes.text()}`);
    }
  }

  // Update meeting metadata with deal_id
  await tenantStorage.run({ tenantId }, async () => {
    await query(
      "UPDATE meetings SET meeting_metadata = meeting_metadata || $1::jsonb WHERE id = $2",
      [JSON.stringify({ hubspot_deal_id: dealId }), meetingId]
    );

    // Audit logs
    await query(`
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, NULL, 'CREATE_HUBSPOT_DEAL', 'meetings', $2, $3)
    `, [tenantId, meetingId, JSON.stringify({ hubspot_deal_id: dealId, hubspot_contact_id: contactId })]);
  });
}

/**
 * Real-time push: Log outbound outreach email as a HubSpot Engagement Activity.
 */
async function logEmailActivity(tenantId, messageId) {
  let message = null;
  let lead = null;

  await tenantStorage.run({ tenantId }, async () => {
    const msgRes = await query('SELECT * FROM messages WHERE id = $1', [messageId]);
    message = msgRes.rows[0];
    if (message) {
      const leadRes = await query('SELECT * FROM leads WHERE id = $1', [message.lead_id]);
      lead = leadRes.rows[0];
    }
  });

  if (!message || !lead) return;

  const accessToken = await getFreshAccessToken(tenantId);
  const contactId = lead.enrichment_data?.hubspot_contact_id;
  if (!contactId) {
    console.warn(`Skipping HubSpot Activity log: Lead ${lead.id} has no HubSpot contact ID linked.`);
    return;
  }

  let emailActivityId = 'mock_hs_activity_id_' + Date.now();

  if (process.env.HUBSPOT_CLIENT_ID) {
    // 1. Create Email Activity in HubSpot
    const activityRes = await fetch('https://api.hubapi.com/crm/v3/objects/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: {
          hs_timestamp: Date.now(),
          hs_email_subject: message.subject || 'Outreach Email',
          hs_email_html: message.content,
          hs_email_direction: 'EMAIL'
        }
      })
    });

    if (!activityRes.ok) {
      console.error(`Failed to log HubSpot Email Activity: ${await activityRes.text()}`);
      return;
    }

    const activityData = await activityRes.json();
    emailActivityId = activityData.id;

    // 2. Associate Email Activity with Contact (association type 10 is email-to-contact)
    const assocRes = await fetch(`https://api.hubapi.com/crm/v3/objects/emails/${emailActivityId}/associations/contacts/${contactId}/10`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!assocRes.ok) {
      console.error(`Failed to associate HubSpot Email Activity with Contact: ${await assocRes.text()}`);
    }
  }

  // Update message metadata with activity ID
  await tenantStorage.run({ tenantId }, async () => {
    await query(
      "UPDATE messages SET metadata = metadata || $1::jsonb WHERE id = $2",
      [JSON.stringify({ hubspot_email_activity_id: emailActivityId }), messageId]
    );

    // Audit log
    await query(`
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, NULL, 'LOG_HUBSPOT_EMAIL_ACTIVITY', 'messages', $2, $3)
    `, [tenantId, messageId, JSON.stringify({ hubspot_email_activity_id: emailActivityId, hubspot_contact_id: contactId })]);
  });
}

/**
 * Background runner: Polls HubSpot-connected tenants every 60 minutes.
 */
async function cronSyncAllTenants() {
  console.log('⏰ Running HubSpot CRM bidirectional background sync...');
  
  // Find all tenants with active HubSpot connections (global query, no RLS)
  const res = await query("SELECT id FROM tenants WHERE settings->'hubspot'->>'status' = 'active'", [], false);
  const tenants = res.rows;
  
  for (const tenant of tenants) {
    try {
      await syncHubSpot(tenant.id);
      console.log(`[HubSpot Sync Success] Completed for tenant: ${tenant.id}`);
    } catch (err) {
      console.error(`[HubSpot Sync Failed] For tenant ${tenant.id}:`, err.message);
    }
  }
}

// Schedule polling every 60 minutes
if (process.env.NODE_ENV !== 'test') {
  cron.schedule('0 */1 * * *', async () => {
    await cronSyncAllTenants();
  });
}

module.exports = {
  getOAuthUrl,
  handleCallback,
  getFreshAccessToken,
  syncHubSpot,
  pushLeadUpdate,
  createHubSpotDeal,
  logEmailActivity,
  cronSyncAllTenants
};
