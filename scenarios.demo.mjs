import { startDemoServer } from './src/demo-server.js';
export default {
  project: 'local-demo', start: startDemoServer, widths:[375,1024],height:800,
  collector:{selectors:['fbr-button']},
  scenarios:[
    {name:'liste',path:'/',states:[
      {name:'normal'},
      {name:'survol',prepare:page=>page.locator('fbr-button').first().hover()},
    ]},
    {name:'detail-modale',path:'/detail',prepare:page=>page.locator('#open').click()},
  ],
};
