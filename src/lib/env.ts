/**
 * The test copy (built from the dev branch, served at /personal-budget/dev/) shares the live
 * app's web address, so it would share its browser storage. It uses its own prefix for
 * everything it stores, in the browser and on relays, so testing never touches real data.
 */
export const IS_TEST_COPY = import.meta.env.VITE_TEST_COPY === 'true';

export const STORAGE_PREFIX = IS_TEST_COPY ? 'personal-budget-test:' : 'personal-budget:';
