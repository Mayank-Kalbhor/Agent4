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

