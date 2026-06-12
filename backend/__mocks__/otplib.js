module.exports = {
  generateSecret: jest.fn(() => 'MOCKSECRET1234567890'),
  generateURI: jest.fn(({ secret, label, issuer }) => `otpauth://totp/${issuer}:${label}?secret=${secret}`),
  verifySync: jest.fn(({ token, secret }) => {
    return { valid: token === '123456' };
  }),
  verify: jest.fn(async ({ token, secret }) => {
    return { valid: token === '123456' };
  }),
};
