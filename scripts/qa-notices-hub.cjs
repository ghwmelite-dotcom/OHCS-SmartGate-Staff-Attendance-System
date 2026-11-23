const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.cwd();
fs.mkdirSync(path.join(root, 'outputs/notices-hub'), { recursive: true });
function serve(app) {
 const folder = path.join(root, 'packages', app, 'dist');
 return new Promise(resolve => {const server = http.createServer((req,res) => {
  let target = path.join(folder, decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target=path.join(folder,'index.html');
  const ext=path.extname(target); res.setHeader('Content-Type', {'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'}[ext] || 'application/octet-stream');res.end(fs.readFileSync(target));
 });server.listen(0,'127.0.0.1',()=>resolve(server));});
}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true}); const errors=[];
 const record={id:'DEMO-2026-001',user_id:'staff-demo',staff_name:'Ama Mensah (Demo)',directorate_name:'Research, Statistics & Information Management',directorate_abbr:'RSIMD',reason:'transport',note:'Transport disruption on my route. I have informed my team and expect to return tomorrow.',notice_date:'2026-11-23',expected_return_date:'2026-11-24',created_at:'2026-11-23T07:40:00Z',version:1,status:'submitted',acknowledged_at:null,acknowledged_by_name:null,withdrawn_at:null};
 for(const app of ['web','staff']) {
  const server=await serve(app),port=server.address().port;
  const context=await browser.newContext({viewport: app==='web'?{width:1440,height:1000}:{width:390,height:844},serviceWorkers:'block'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  let acknowledged=false; let decision=app==='staff'?'declined':null; let decisionNote='Please discuss alternative arrangements with your head.';
  await page.route('**/api/**', async route=>{
   const url=new URL(route.request().url()), endpoint=url.pathname;
   let data=null;
   if(endpoint==='/api/auth/me') data={user:{id:app==='web'?'director-demo':'staff-demo',name:app==='web'?'Director (Demo)':'Ama Mensah (Demo)',role:app==='web'?'director':'staff',email:'demo@example.org',staff_id:'DEMO',directorate_abbr:'RSIMD',pin_acknowledged:true}};
   else if(endpoint==='/api/notices') data={notices:[{...record,...(decision?{status:decision}:acknowledged?{status:'acknowledged'}:{})}],total:1,page:1,page_size:20,can_review:app==='web'};
   else if(endpoint.endsWith('/decision')) {const body=JSON.parse(route.request().postData());assert.equal(body.version,1); decision=body.decision;decisionNote=body.comment;data={decision};}
   else if(endpoint.endsWith('/acknowledge')){assert.equal(JSON.parse(route.request().postData()).version,1);acknowledged=true;data={acknowledged:true};}
   else if(endpoint.startsWith('/api/notices/'))data={...record,status:decision || (acknowledged?'acknowledged':'submitted'),decision,decision_note:decisionNote,decided_by_name:decision?'Director (Demo)':null,decided_at:decision?'2026-11-23T09:10:00Z':null,can_decide:app==='web'&&!decision,acknowledged_at:acknowledged?'2026-11-23T09:00:00Z':null,acknowledged_by_name:acknowledged?'Director (Demo)':null,can_acknowledge:app==='web'&&!acknowledged,revisions:[{version:1,event:'submitted',reason:record.reason,note:record.note,expected_return_date:record.expected_return_date,at:record.created_at}]};
   else if(endpoint.includes('notifications'))data=[];
   else data={};
   await route.fulfill({json:{data,error:null}});
  });
  await page.goto(`http://127.0.0.1:${port}/notices`);
  await page.getByText('1 matching notice').waitFor();
  if(app==='web')await page.getByRole('button',{name:'Directorate register',exact:true}).click();
  await page.screenshot({path:`outputs/notices-hub/${app}-register.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:/Ama Mensah/}).click();
  await page.getByRole('heading',{name:'Record history'}).waitFor();
  await page.screenshot({path:`outputs/notices-hub/${app}-detail.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(app==='web'){
   // Regression: clicking either tab from a record must close the detail,
   // including clicking the tab that is already selected.
   await page.getByRole('button',{name:'Directorate register',exact:true}).click();
   await page.getByText('1 matching notice').waitFor();
   assert.equal(new URL(page.url()).searchParams.has('notice'),false);
   assert.equal(new URL(page.url()).searchParams.get('view'),'register');
   await page.getByRole('button',{name:/Ama Mensah/}).click();
   await page.reload();
   await page.getByRole('heading',{name:'Record history'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Directorate register',exact:true}).getAttribute('aria-pressed'),'true');
   await page.getByRole('button',{name:'My Notices',exact:true}).click();
   await page.getByText('1 matching notice').waitFor();
   assert.equal(new URL(page.url()).searchParams.get('view'),'mine');
   await page.goBack();
   await page.getByRole('heading',{name:'Record history'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Directorate register',exact:true}).getAttribute('aria-pressed'),'true');
   await page.getByRole('button',{name:'Acknowledge receipt',exact:true}).click();
   await page.getByText('Receipt acknowledged.',{exact:true}).waitFor();
   await page.screenshot({path:'outputs/notices-hub/web-acknowledged.png',fullPage:true});
   await page.getByRole('button',{name:'Decline absence',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'Confirm decline',exact:true}).isDisabled(),true);
   await page.getByLabel('Reason for declining (required)').fill('Please discuss alternative arrangements with your head.');
   await page.screenshot({path:'outputs/notices-hub/web-decision-confirm.png',fullPage:true});
   await page.getByRole('button',{name:'Confirm decline',exact:true}).click();
   await page.getByText('Absence decision recorded.',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Approve absence',exact:true}).count(),0);
   await page.screenshot({path:'outputs/notices-hub/web-declined.png',fullPage:true});
   decision=null; await page.reload();
   await page.getByRole('button',{name:'Approve absence',exact:true}).click();
   await page.getByRole('button',{name:'Confirm approval',exact:true}).click();
   await page.getByText('Absence decision recorded.',{exact:true}).waitFor();
   await page.screenshot({path:'outputs/notices-hub/web-approved.png',fullPage:true});
   await page.setViewportSize({width:390,height:844});
   await page.getByRole('button',{name:'Back to notices'}).click();
   await page.screenshot({path:'outputs/notices-hub/web-mobile.png',fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }else {assert.equal(await page.getByRole('button',{name:'Acknowledge receipt',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Approve absence',exact:true}).count(),0);await page.getByText('Please discuss alternative arrangements with your head.',{exact:false}).waitFor();}
  await context.close();await new Promise(resolve=>server.close(resolve));
 }
 await browser.close();assert.deepEqual(errors,[]);console.log('PASS: desktop/mobile register, personal history, detail, acknowledgement, approval/decline confirmation and staff decision visibility, no horizontal overflow or page errors. Synthetic fixtures only.');
})().catch(e=>{console.error(e);process.exit(1)});
