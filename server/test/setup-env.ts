process.env.DB_PATH = ':memory:'
process.env.JWT_SECRET = 'test-secret'
// Place search (SRCH) uses the deterministic fixture provider; no outbound network in tests.
process.env.SEARCH_PROVIDER = 'fake'
