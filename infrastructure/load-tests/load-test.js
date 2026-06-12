import http from 'k6/http';
import { check, sleep } from 'k6';

// k6 Options configuration
export const options = {
  scenarios: {
    // Scenario 1: 500 Concurrent Lead Imports
    lead_import_load: {
      executor: 'constant-vus',
      vus: 500,
      duration: '30s',
      exec: 'runLeadImport',
    },
    // Scenario 2: 1000 Simultaneous Follow-Up Jobs/Simulator Tasks
    followup_job_load: {
      executor: 'constant-vus',
      vus: 1000,
      duration: '30s',
      exec: 'runFollowUpJob',
    },
  },
  thresholds: {
    // Assert 95% of request latencies are under 500ms
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'], // Assert failure rate is less than 1%
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:8080';
const JWT_TOKEN = __ENV.JWT_TOKEN || 'mock-admin-token';

export function runLeadImport() {
  const url = `${BASE_URL}/api/leads/import`;
  const payload = JSON.stringify({
    leads: [
      { name: 'Load Test Prospect', email: 'loadprospect@stripe.com', company: 'Stripe', title: 'Developer Relation' }
    ]
  });
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${JWT_TOKEN}`
    }
  };

  const response = http.post(url, payload, params);
  check(response, {
    'import status is 200': (r) => r.status === 200,
    'import time under 500ms': (r) => r.timings.duration < 500
  });

  sleep(0.1);
}

export function runFollowUpJob() {
  const url = `${BASE_URL}/api/simulator/incoming-response`;
  const payload = JSON.stringify({
    tenantId: 'a0000000-0000-0000-0000-000000000001',
    leadId: 'a2000000-0000-0000-0000-000000000001',
    replyContent: 'I am interested. Let us schedule a brief demonstration.'
  });

  const params = {
    headers: {
      'Content-Type': 'application/json'
    }
  };

  const response = http.post(url, payload, params);
  check(response, {
    'followup status is 200': (r) => r.status === 200,
    'followup time under 500ms': (r) => r.timings.duration < 500
  });

  sleep(0.1);
}
