const { test, expect } = require('@playwright/test');

test.describe('getSetting fallback', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080');
  });

  test('should fallback to localStorage if IndexedDB fails', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // Setup localStorage with a fallback value
      localStorage.setItem('test_setting', JSON.stringify('fallback_value'));

      // Mock indexedDB to simulate failure
      const originalIndexedDB = Object.getOwnPropertyDescriptor(window, 'indexedDB');
      Object.defineProperty(window, 'indexedDB', {
        value: {
          open: () => {
            const request = {};
            setTimeout(() => {
              request.error = new DOMException('Simulated IndexedDB failure');
              if (request.onerror) request.onerror({ target: request });
            }, 0);
            return request;
          }
        },
        configurable: true
      });

      try {
        // We import db.js dynamically to ensure it uses the mocked indexedDB.
        // Cache busting to ensure we don't use a cached module from another test.
        const { getSetting } = await import(`/js/db.js?t=${Date.now()}`);
        return await getSetting('test_setting');
      } finally {
        // Restore indexedDB and cleanup
        if (originalIndexedDB) {
          Object.defineProperty(window, 'indexedDB', originalIndexedDB);
        } else {
          delete window.indexedDB;
        }
        localStorage.removeItem('test_setting');
      }
    });

    expect(result).toBe('fallback_value');
  });

  test('should return undefined if both IndexedDB and localStorage fail', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // Mock indexedDB to simulate failure
      const originalIndexedDB = Object.getOwnPropertyDescriptor(window, 'indexedDB');
      Object.defineProperty(window, 'indexedDB', {
        value: {
          open: () => {
            const request = {};
            setTimeout(() => {
              request.error = new DOMException('Simulated IndexedDB failure');
              if (request.onerror) request.onerror({ target: request });
            }, 0);
            return request;
          }
        },
        configurable: true
      });

      // Mock localStorage to simulate failure
      const originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: () => {
            throw new Error('Simulated localStorage failure');
          }
        },
        configurable: true
      });

      try {
        const { getSetting } = await import(`/js/db.js?t=${Date.now()}`);
        return await getSetting('test_setting_fail');
      } finally {
        // Restore
        if (originalIndexedDB) {
          Object.defineProperty(window, 'indexedDB', originalIndexedDB);
        }
        if (originalLocalStorage) {
          Object.defineProperty(window, 'localStorage', originalLocalStorage);
        }
      }
    });

    expect(result).toBeUndefined();
  });
});
