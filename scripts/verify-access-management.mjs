import { spawn } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/ledgerise';
const port = process.env.VERIFY_API_PORT ?? '3311';
const baseUrl = `http://127.0.0.1:${port}`;
const unique = Date.now();
const adminEmail = `verify-admin-${unique}@ledgerise.test`;
const adminPassword = `verify-admin-${unique}`;
const invitedEmail = `verify-access-${unique}@ledgerise.test`;
const invitedPassword = `verify-access-${unique}`;
const apiKeyName = `verify-access-${unique}`;

const api = spawn('node', ['apps/api/dist/index.js'], {
  env: {
    ...process.env,
    API_PORT: port,
    DATABASE_URL: databaseUrl,
    DEFAULT_OPERATOR_SLUG: process.env.DEFAULT_OPERATOR_SLUG ?? 'local-operator',
    LEDGERISE_BOOTSTRAP_ADMIN_EMAIL: adminEmail,
    LEDGERISE_BOOTSTRAP_ADMIN_PASSWORD: adminPassword
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let apiOutput = '';

api.stdout.on('data', (chunk) => {
  apiOutput += chunk.toString();
});

api.stderr.on('data', (chunk) => {
  apiOutput += chunk.toString();
});

try {
  await waitForHealthcheck();

  const healthcheck = await getJson('/healthcheck');
  assertEqual(healthcheck.statusCode, 200, 'healthcheck status');
  assertEqual(healthcheck.body.repository, 'postgres', 'healthcheck repository');

  const unauthenticatedUsers = await getJson('/api/users');
  assertEqual(unauthenticatedUsers.statusCode, 401, 'unauthenticated user list status');

  const adminLogin = await postJson('/api/auth/login', {
    email: adminEmail,
    password: adminPassword
  });
  assertEqual(adminLogin.statusCode, 200, 'bootstrap admin login status');
  const dashboardHeaders = {
    authorization: `Bearer ${adminLogin.body.token}`
  };

  const initialUsers = await getJson('/api/users', dashboardHeaders);
  assertEqual(initialUsers.statusCode, 200, 'user list status');
  assert(Array.isArray(initialUsers.body.records), 'user list shape');

  const invited = await postJson(
    '/api/users/invitations',
    {
      email: invitedEmail,
      display_name: 'Verify Access User',
      role: 'finance',
      password: invitedPassword
    },
    dashboardHeaders
  );
  assertEqual(invited.statusCode, 201, 'invite user status');
  assertEqual(invited.body.record.email, invitedEmail, 'invite user email');
  assertEqual(invited.body.record.role, 'finance', 'invite user role');
  assertEqual(invited.body.record.status, 'invited', 'invite user status');
  assertEqual(invited.body.record.has_password, true, 'invite user password flag');

  const login = await postJson('/api/auth/login', {
    email: invitedEmail,
    password: invitedPassword
  });
  assertEqual(login.statusCode, 200, 'login status');
  assert(typeof login.body.token === 'string' && login.body.token.length > 20, 'login token shape');
  assertEqual(login.body.user.email, invitedEmail, 'login user email');

  const me = await getJson('/api/auth/me', {
    authorization: `Bearer ${login.body.token}`
  });
  assertEqual(me.statusCode, 200, 'auth me status');
  assertEqual(me.body.user.email, invitedEmail, 'auth me user email');

  const updated = await patchJson(
    `/api/users/${invited.body.record.id}`,
    {
      role: 'auditor',
      status: 'disabled'
    },
    dashboardHeaders
  );
  assertEqual(updated.statusCode, 200, 'update user status');
  assertEqual(updated.body.record.role, 'auditor', 'updated user role');
  assertEqual(updated.body.record.status, 'disabled', 'updated user lifecycle status');

  const users = await getJson('/api/users', dashboardHeaders);
  assertEqual(users.statusCode, 200, 'refreshed user list status');
  assert(
    users.body.records.some((record) => record.email === invitedEmail && record.status === 'disabled'),
    'refreshed user list includes updated user'
  );

  const initialKeys = await getJson('/api/api-keys', dashboardHeaders);
  assertEqual(initialKeys.statusCode, 200, 'api key list status');
  assert(Array.isArray(initialKeys.body.records), 'api key list shape');

  const createdKey = await postJson(
    '/api/api-keys',
    {
      name: apiKeyName,
      scopes: ['posting_batches:read', 'posting_artifacts:download']
    },
    dashboardHeaders
  );
  assertEqual(createdKey.statusCode, 201, 'create api key status');
  assertEqual(createdKey.body.record.name, apiKeyName, 'created api key name');
  assert(createdKey.body.secret.startsWith('lr_live_sk_'), 'created api key secret prefix');
  assertEqual(createdKey.body.record.enabled, true, 'created api key enabled');

  const listedKeys = await getJson('/api/api-keys', dashboardHeaders);
  assertEqual(listedKeys.statusCode, 200, 'refreshed api key list status');
  const listedKey = listedKeys.body.records.find((record) => record.id === createdKey.body.record.id);
  assert(Boolean(listedKey), 'refreshed api key list includes created key');
  assert(!('secret' in listedKey), 'api key list does not expose secret');
  assertEqual(listedKey.key_prefix, createdKey.body.record.key_prefix, 'listed key prefix');

  const revoked = await postJson(
    `/api/api-keys/${createdKey.body.record.id}/revoke`,
    {},
    dashboardHeaders
  );
  assertEqual(revoked.statusCode, 200, 'revoke api key status');
  assertEqual(revoked.body.record.enabled, false, 'revoked api key disabled');
  assert(Boolean(revoked.body.record.revoked_at), 'revoked api key timestamp');

  console.log('Access management verification passed.');
  console.log(
    JSON.stringify(
      {
        user_id: invited.body.record.id,
        user_email: invitedEmail,
        api_key_id: createdKey.body.record.id,
        api_key_prefix: createdKey.body.record.key_prefix
      },
      null,
      2
    )
  );
} catch (error) {
  console.error('Access management verification failed.');
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  if (apiOutput.trim()) {
    console.error('\nAPI output:');
    console.error(apiOutput.trim());
  }
  process.exitCode = 1;
} finally {
  api.kill();
}

async function waitForHealthcheck() {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < 10_000) {
    if (api.exitCode !== null) {
      throw new Error(`API process exited early with code ${api.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/healthcheck`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for API healthcheck${lastError ? `: ${String(lastError)}` : ''}`
  );
}

async function getJson(path, headers = undefined) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers
  });
  return {
    statusCode: response.status,
    body: await response.json()
  };
}

async function postJson(path, body, headers = undefined) {
  return sendJson('POST', path, body, headers);
}

async function patchJson(path, body, headers = undefined) {
  return sendJson('PATCH', path, body, headers);
}

async function sendJson(method, path, body, headers = undefined) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });

  return {
    statusCode: response.status,
    body: await response.json()
  };
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(`Assertion failed: ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${label}. Expected ${expected}, got ${actual}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
