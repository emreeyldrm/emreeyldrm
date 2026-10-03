process.env.DB_PATH = ':memory:'
process.env.JWT_SECRET = 'test-secret'
// Place search (SRCH) uses the deterministic fixture provider; no outbound network in tests.
process.env.SEARCH_PROVIDER = 'fake'
// TRD test hook: X-Test-Now moves the request clock (7-day window tests). Never set in production.
process.env.E2E_TEST_HOOKS = '1'
