const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { generateSecret, generateURI, verifySync } = require('otplib');
const { query } = require('../db/db');

const JWT_SECRET = process.env.JWT_SECRET || 'sales_agent_super_secret_token';

/**
 * Registers a new user.
 */
async function registerUser({ email, password, role, tenantId }) {
  const hashedPassword = await bcrypt.hash(password, 10);
  const insertUserSql = `
    INSERT INTO users (tenant_id, email, role, hashed_password)
    VALUES ($1, $2, $3, $4)
    RETURNING id, tenant_id, email, role;
  `;
  const res = await query(insertUserSql, [tenantId, email, role || 'rep', hashedPassword], false);
  return res.rows[0];
}

/**
 * Standard password authentication.
 */
async function authenticatePassword(email, password) {
  const res = await query('SELECT * FROM users WHERE email = $1', [email], false);
  if (res.rows.length === 0) {
    return { success: false, reason: 'Invalid email or password.' };
  }

  const user = res.rows[0];
  const isMatch = await bcrypt.compare(password, user.hashed_password);
  if (!isMatch) {
    return { success: false, reason: 'Invalid email or password.', userId: user.id, tenantId: user.tenant_id };
  }

  if (user.two_factor_enabled) {
    // Return temporary 2FA requirement token
    const mfaToken = jwt.sign(
      { userId: user.id, tenantId: user.tenant_id, partial: true },
      JWT_SECRET,
      { expiresIn: '5m' }
    );
    return { success: true, requires2fa: true, mfaToken };
  }

  return { success: true, user };
}

/**
 * Generates JWT Access Token (15m) and secure random Refresh Token (7d).
 */
async function generateTokens(user) {
  const accessToken = jwt.sign(
    { userId: user.id, tenantId: user.tenant_id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: '15m' }
  );

  const refreshToken = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000); // 7 days

  await query(
    `INSERT INTO refresh_tokens (token, user_id, tenant_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [refreshToken, user.id, user.tenant_id, expiresAt],
    false
  );

  return { accessToken, refreshToken };
}

/**
 * Rotates a refresh token (invalidates old, issues new pair).
 * Incorporates replay attack protection.
 */
async function rotateRefreshToken(tokenStr) {
  const res = await query('SELECT * FROM refresh_tokens WHERE token = $1', [tokenStr], false);
  if (res.rows.length === 0) {
    throw new Error('Invalid refresh token.');
  }

  const rToken = res.rows[0];

  // Replay Attack Detection: if token is already revoked, terminate all active sessions for safety
  if (rToken.revoked || new Date(rToken.expires_at) < new Date()) {
    await query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1', [rToken.user_id], false);
    throw new Error('Session compromised or expired. Please log in again.');
  }

  // Revoke the current token
  await query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1', [rToken.id], false);

  // Fetch corresponding user
  const userRes = await query('SELECT * FROM users WHERE id = $1', [rToken.user_id], false);
  if (userRes.rows.length === 0) {
    throw new Error('User not found.');
  }

  const user = userRes.rows[0];

  // Generate new pair
  return await generateTokens(user);
}

/**
 * Revokes a refresh token (logs out).
 */
async function revokeRefreshToken(tokenStr) {
  await query('UPDATE refresh_tokens SET revoked = TRUE WHERE token = $1', [tokenStr], false);
}

/**
 * Sets up 2FA (TOTP secret) for a user.
 */
async function setup2FA(userId) {
  const userRes = await query('SELECT * FROM users WHERE id = $1', [userId], false);
  if (userRes.rows.length === 0) {
    throw new Error('User not found.');
  }
  const user = userRes.rows[0];
  const secret = generateSecret();
  const otpauth = generateURI({ secret, label: user.email, issuer: 'AI-Sales-Agent-SaaS' });

  await query('UPDATE users SET two_factor_secret = $1 WHERE id = $2', [secret, userId], false);

  return { secret, otpauth };
}

/**
 * Verifies the first 2FA code and enables 2FA for the user.
 */
async function verifyAndEnable2FA(userId, code) {
  const userRes = await query('SELECT two_factor_secret FROM users WHERE id = $1', [userId], false);
  if (userRes.rows.length === 0 || !userRes.rows[0].two_factor_secret) {
    return false;
  }

  const secret = userRes.rows[0].two_factor_secret;
  const res = verifySync({ token: code, secret });
  const isValid = res && res.valid;

  if (isValid) {
    await query('UPDATE users SET two_factor_enabled = TRUE WHERE id = $1', [userId], false);
    return true;
  }

  return false;
}

/**
 * Verifies TOTP code during login.
 */
async function verify2FACode(userId, code) {
  const userRes = await query('SELECT two_factor_secret FROM users WHERE id = $1', [userId], false);
  if (userRes.rows.length === 0 || !userRes.rows[0].two_factor_secret) {
    return false;
  }

  const secret = userRes.rows[0].two_factor_secret;
  const res = verifySync({ token: code, secret });
  return !!(res && res.valid);
}

module.exports = {
  registerUser,
  authenticatePassword,
  generateTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  setup2FA,
  verifyAndEnable2FA,
  verify2FACode
};
