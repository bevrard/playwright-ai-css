/** Adapter les routes, les sélecteurs et les actions à votre application. */
export default {
  project: 'angular-buttons',
  baseURL: process.env.APP_URL,
  widths: [375, 767, 1024, 1199, 1280, 1440],
  height: 900,
  timeout: 15000,
  collector: {
    selectors: ['fbr-button'],
    stopPrefixes: ['fbr-', 'fmo-', 'fho-', 'mss-', 'fto-'],
    ionicSheetURLs: [],
    includeText: false,
  },
  // context: { storageState: '.auth/user.json', colorScheme: 'dark' },
  scenarios: [{
    name: 'page-principale',
    path: '/',
    prepare: async page => {
      await page.locator('fbr-button').first().waitFor({ state: 'visible' });
    },
    states: [
      { name: 'normal' },
      { name: 'survol', prepare: async page => {
        await page.locator('fbr-button').first().hover();
      } },
    ],
  }],
};
