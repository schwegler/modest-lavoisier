const { test, expect } = require('@playwright/test');

test.describe('setSetting fallback error handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080');
  });

  test('should fallback to localStorage.setItem if indexedDB fails to put item', async ({ page }) => {
    const key = 'testKey';
    const value = { prop: 'testValue' };

    await page.evaluate(async (args) => {
      // Import the module
      const { setSetting } = await import('/js/db.js');

      const originalPut = IDBObjectStore.prototype.put;
      window.__originalPut = originalPut;

      IDBObjectStore.prototype.put = function(val, key) {
        const mockRequest = {
           set onerror(cb) { this._onerror = cb; },
           get onerror() { return this._onerror; }
        };
        setTimeout(() => {
          mockRequest.error = new Error('Mock IDB Error');
          if (mockRequest._onerror) {
            mockRequest._onerror({ target: mockRequest });
          }
        }, 10);
        return mockRequest;
      };

      const originalSetItem = localStorage.setItem;
      window.__originalSetItem = originalSetItem;
      window.__localStorageCalls = [];
      localStorage.setItem = function(key, val) {
        window.__localStorageCalls.push({ key, val });
        return originalSetItem.apply(this, arguments);
      };

      try {
        await setSetting(args.key, args.value);
      } catch (e) {
        console.error("setSetting threw unhandled error to caller:", e);
      }

    }, { key, value });

    const localStorageCalls = await page.evaluate(() => window.__localStorageCalls);

    const call = localStorageCalls.find(c => c.key === key);
    expect(call).toBeDefined();
    expect(call.key).toBe(key);
    expect(call.val).toBe(JSON.stringify(value));

    // Cleanup
    await page.evaluate(() => {
      IDBObjectStore.prototype.put = window.__originalPut;
      localStorage.setItem = window.__originalSetItem;
      delete window.__originalPut;
      delete window.__originalSetItem;
      delete window.__localStorageCalls;
    });
  });

  test('should fallback to localStorage.setItem if indexedDB fails to open', async ({ page }) => {
    const key = 'testKey2';
    const value = { prop: 'testValue2' };

    await page.evaluate(async (args) => {
      const { setSetting } = await import('/js/db.js');

      const originalIndexedDBOpen = window.indexedDB.open;
      window.__originalIndexedDBOpen = originalIndexedDBOpen; // Save for cleanup

      window.indexedDB.open = function() {
        const mockRequest = {
           set onerror(cb) { this._onerror = cb; },
           get onerror() { return this._onerror; }
        };
        setTimeout(() => {
          mockRequest.error = new Error('Mock IDB Open Error');
          if (mockRequest._onerror) {
            mockRequest._onerror({ target: mockRequest });
          }
        }, 10);
        return mockRequest;
      };

      // Spy on localStorage.setItem
      const originalSetItem = localStorage.setItem;
      window.__originalSetItem = originalSetItem;
      window.__localStorageCalls = [];
      localStorage.setItem = function(key, val) {
        window.__localStorageCalls.push({ key, val });
        return originalSetItem.apply(this, arguments);
      };

      try {
        await setSetting(args.key, args.value);
      } catch (e) {
        console.error("setSetting threw unhandled error to caller:", e);
      }
    }, { key, value });

    // Verify localStorage.setItem was called
    const localStorageCalls = await page.evaluate(() => window.__localStorageCalls);

    const call = localStorageCalls.find(c => c.key === key);
    expect(call).toBeDefined();
    expect(call.key).toBe(key);
    expect(call.val).toBe(JSON.stringify(value));

    // Cleanup mocks
    await page.evaluate(() => {
      window.indexedDB.open = window.__originalIndexedDBOpen;
      localStorage.setItem = window.__originalSetItem;
      delete window.__originalIndexedDBOpen;
      delete window.__originalSetItem;
      delete window.__localStorageCalls;
    });
  });
});
