jest.mock('otplib', () => {
  return {
    generateSecret: jest.fn(() => 'MOCKSECRET1234567890'),
    generateURI: jest.fn(({ secret, label, issuer }) => `otpauth://totp/${issuer}:${label}?secret=${secret}`),
    verifySync: jest.fn(({ token, secret }) => {
      return { valid: token === '123456' };
    }),
    verify: jest.fn(async ({ token, secret }) => {
      return { valid: token === '123456' };
    }),
  };
});

const mockClient = {
  query: jest.fn().mockResolvedValue({ rows: [] }),
  release: jest.fn(),
  escapeLiteral: jest.fn((val) => `'${val}'`),
};

const mockPool = {
  connect: jest.fn().mockResolvedValue(mockClient),
  query: jest.fn().mockResolvedValue({ rows: [] }),
};

jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool),
}));

