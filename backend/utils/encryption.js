const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
// ENCRYPTION_KEY must be exactly 32 bytes
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'sales_agent_super_secret_enc_key_32bytes!';

if (process.env.NODE_ENV === 'production' && (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY === 'sales_agent_super_secret_enc_key_32bytes!')) {
  throw new Error('FATAL: A secure, unique ENCRYPTION_KEY must be provided in production environments.');
}

/**
 * Encrypts cleartext using AES-256-CBC.
 */
function encrypt(text) {
  if (!text) return null;
  
  let key = Buffer.from(ENCRYPTION_KEY, 'utf8');
  if (key.length < 32) {
    key = Buffer.concat([key, Buffer.alloc(32 - key.length)]);
  } else if (key.length > 32) {
    key = key.subarray(0, 32);
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return {
    encryptedData: encrypted,
    iv: iv.toString('hex')
  };
}

/**
 * Decrypts hexadecimal encrypted text using AES-256-CBC.
 */
function decrypt(encryptedData, ivHex) {
  if (!encryptedData || !ivHex) return null;
  
  let key = Buffer.from(ENCRYPTION_KEY, 'utf8');
  if (key.length < 32) {
    key = Buffer.concat([key, Buffer.alloc(32 - key.length)]);
  } else if (key.length > 32) {
    key = key.subarray(0, 32);
  }

  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

module.exports = {
  encrypt,
  decrypt
};
