/** Trois stories et huit cibles fournies par l’utilisateur. */
const baseURL=process.env.CHROMATIC_URL || 'https://66d854e7d3de36684545a982-efvfetcqns.chromatic.com';
const app='body > fho-application-wrapper > cfcal-fho-application-container > cfcal-fho-base > div.website-wrapper.opened-main-sidebar.displayed-header.minimized-main-sidebar > div > div > div > div';
const savingTop=app+' > fho-saving-account-details > fho-page-container-template-detail > fho-page-container > div > ion-grid > fho-page-container-template-detail-table-wrapper > ion-row.table-template-top-section.ng-star-inserted.md.hydrated > ion-col:nth-child(2) > fto-button-set > fbr-action-button > div';
const savingPanel='#pn_id_118_content > div > div > ion-grid';
const notificationForm='#pn_id_70_content > div > div > ion-grid > ion-row:nth-child(3) > ion-col > fbr-form-button > div > fbr-form-button > div > fbr-button';
function story(id) {
  return '/iframe.html?'+new URLSearchParams({globals:'viewport:w1280h720',id,viewMode:'story'});
}
async function prepare(page) {
  if (new URL(page.url()).hostname !== new URL(baseURL).hostname || /\/sign-?in|\/login/i.test(new URL(page.url()).pathname))
    throw new Error('Chromatic demande une connexion ou a redirigé hors du build. Fournir une URL publique ou exécuter npm run chromatic:login, puis CHROMATIC_STORAGE_STATE=.auth/chromatic.json npm run chromatic.');
  await page.locator('fho-application-wrapper').waitFor({state:'visible'});
}
export default {
  project:'chromatic-fbr-buttons',baseURL,widths:[1280],height:720,timeout:60000,navigationAttempts:3,
  context:process.env.CHROMATIC_STORAGE_STATE ? {storageState:process.env.CHROMATIC_STORAGE_STATE} : {},
  collector:{stopPrefixes:['fbr-','fmo-','fho-','mss-','fto-'],includeText:false},
  scenarios:[
    {name:'saving-detail',path:story('pages-accounts-saving-e2e-savings-details-fhocfcal-395--saving-detail'),prepare,
      targets:[
        {name:'saving-top-1',selector:savingTop+' > fbr-button:nth-child(1)'},
        {name:'saving-top-2',selector:savingTop+' > fbr-button:nth-child(2)'},
        {name:'saving-search',selector:savingPanel+' > ion-row.row-search.ng-star-inserted.md.hydrated > ion-col.col-btn-search.md.hydrated > fbr-button'},
        {name:'saving-panel-1',selector:savingPanel+' > ion-row:nth-child(4) > ion-col > fto-button-set > fbr-button:nth-child(1)'},
        {name:'saving-panel-2',selector:savingPanel+' > ion-row:nth-child(4) > ion-col > fto-button-set > fbr-button:nth-child(2)'},
      ]},
    {name:'manage-notifications',path:story('pages-myprofile-e2e-manage-notifications-fhocfcal-696--manage-notifications'),prepare,
      targets:[
        {name:'notifications-cover',selector:app+' > fho-manage-notifications > fho-page-container-template-annex > fho-page-container > div > fho-cover > div > div > div.custom-container.ng-star-inserted > ion-row > ion-col.cover-template-section-center.md.hydrated > ion-row > ion-col.col-right.md.hydrated > fto-button-set > fbr-action-button > div > fbr-button'},
        // L’hôte inline a une boîte 0 × 0 ; le bouton flottant reste visible.
        {name:'notifications-form',selector:notificationForm,screenshotSelector:notificationForm+' > button'},
      ]},
    {name:'mobile',path:story('pages-myprofile-e2e-mobile-fhocfcal-498--mobile'),prepare,
      targets:[
        {name:'mobile-first-row-action',selector:'#pn_id_53-table > tbody > tr:nth-child(1) > td.custom-sticky-col.ng-star-inserted > span > div > fbr-action-button > fbr-button'},
      ]},
  ],
};
