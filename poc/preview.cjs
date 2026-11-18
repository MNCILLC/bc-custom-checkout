const fs=require('fs'),path=require('path'),readline=require('readline');
const {chromium}=require('/Users/kylehurt/dev/sandbox-catalyst/checkout-powell-poc/node_modules/@playwright/test');
const dir=process.env.POWELL_PREVIEW_STATE_DIR || '/Users/kylehurt/Documents/Codex/2026-11-17/in/work/powell-enhanced-preview',repo='/Users/kylehurt/dev/sandbox-catalyst/checkout-powell-poc';
const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
const state=read('state.json'),redirects=read('redirects-secret.json');
const secret=JSON.parse(fs.readFileSync(path.join(dir,'../powell-sdk-order-test/test-customer-secret.json'),'utf8'));
const emit=o=>console.log(JSON.stringify(o));
(async()=>{
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1080},serviceWorkers:'block'});const page=await context.newPage();
let phase='session',shell='',events=[],errors=[];const origin=new URL(redirects.checkout_url).origin;
page.on('pageerror',e=>{if(phase!=='session'){errors.push(e.stack);emit({pageError:e.stack?.slice(0,1800)});}});
await context.route('**/*',async route=>{
 const r=route.request(),u=new URL(r.url()),mutating=!['GET','HEAD','OPTIONS'].includes(r.method());
 const orderOrPayment=/(^|\/)(orders?|payments?)(\/|$)/i.test(u.pathname)||u.hostname==='payments.bigcommerce.com';
 if(orderOrPayment&&mutating || u.hostname==='payments.bigcommerce.com') {events.push({blocked:true,reason:'order_or_payment',method:r.method(),host:u.hostname,path:u.pathname});return route.abort();}
 if(mutating){const allowed=u.origin===origin&&(/^\/api\/storefront\/(checkouts|customers|carts)(\/|$)/.test(u.pathname)||/^\/internalapi\/v1\/checkout\/(customer|billing|shipping|consignments)/.test(u.pathname));events.push({blocked:!allowed,method:r.method(),host:u.hostname,path:u.pathname});if(!allowed)return route.abort();}
 if(u.origin===origin&&u.pathname.startsWith('/__powell_poc/')){
  const name=u.pathname.slice('/__powell_poc/'.length);if(name.includes('..'))return route.abort();const file=path.join(repo,'build',name);
  if(!fs.existsSync(file)){emit({missingAsset:name});return route.fulfill({status:404,body:'Not found'});}
  return route.fulfill({path:file,contentType:name.endsWith('.css')?'text/css':name.endsWith('.js')?'application/javascript':name.endsWith('.json')?'application/json':'application/octet-stream'});
 }
 if(phase==='app'&&r.isNavigationRequest()&&u.origin===origin&&u.pathname==='/checkout')return route.fulfill({contentType:'text/html',body:shell});
 if(phase==='session'&&r.resourceType()==='script')return route.abort();
 return route.continue();
});
await page.goto(redirects.checkout_url,{waitUntil:'domcontentloaded',timeout:60000});
const original=await page.evaluate(()=>({config:window.checkoutConfig,language:window.language,styles:[...document.querySelectorAll('link[rel="stylesheet"]')].map(x=>x.href)}));
fs.writeFileSync(path.join(dir,'hosted-bootstrap.json'),JSON.stringify(original,null,2));
phase='sdk';await page.setContent('<html><body>Preparing isolated preview</body></html>');await page.addScriptTag({url:'https://checkout-sdk.bigcommerce.com/v1/loader.js'});
const initial=await page.evaluate(async({cartId,secret})=>{const sdk=await checkoutKitLoader.load('checkout-sdk');window.testService=sdk.createCheckoutService();await testService.loadCheckout(cartId);await testService.signInCustomer(secret);return {checkout:testService.getState().data.getCheckout(),config:testService.getState().data.getConfig()};},{cartId:state.cart_id,secret});
fs.writeFileSync(path.join(dir,'sdk-before-preview.json'),JSON.stringify(initial,null,2));
const config={containerId:'checkout-app',checkoutId:state.cart_id,publicPath:origin+'/__powell_poc/'};
shell='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Powell pickup isolated preview</title>'+original.styles.map(s=>'<link rel="stylesheet" href="'+s+'">').join('')+'</head><body><header style="padding:16px 24px;border-bottom:1px solid #ddd;font:16px sans-serif">Sandbox Cowboy · Isolated checkout preview</header><div id="checkout-app"></div><script>window.checkoutConfig='+JSON.stringify(config)+';window.language='+JSON.stringify(original.language||{locale:'en',locales:{},translations:{}})+';</script><script src="/__powell_poc/auto-loader-dev.js"></script></body></html>';
phase='app';await page.goto(origin+'/checkout',{waitUntil:'domcontentloaded'});await page.locator('.checkout-steps').waitFor({timeout:15000}).catch(()=>{});
emit({stage:'local_app_loaded',cartId:state.cart_id,enhancedSettings:initial.config.checkoutSettings.checkoutUserExperienceSettings,body:(await page.locator('body').innerText()).slice(0,4000)});
const rl=readline.createInterface({input:process.stdin});
for await(const line of rl){try{const c=JSON.parse(line);
 if(c.action==='exit'){fs.writeFileSync(path.join(dir,'browser-events.json'),JSON.stringify({events,errors},null,2));await browser.close();break;}
 if(c.action==='inspect')emit({url:page.url().split('?')[0],body:(await page.locator('body').innerText()).slice(0,10000),enhanced:await page.locator('.enhancedThemeV1').count(),inputs:await page.locator('input,select,button').evaluateAll(xs=>xs.map(x=>({tag:x.tagName,id:x.id,type:x.type,name:x.name,text:x.tagName==='BUTTON'?x.innerText:undefined,value:x.type==='password'?undefined:x.value,disabled:x.disabled}))),events,errors});
 if(c.action==='eval')emit({result:await page.evaluate(c.code)});
 if(c.action==='click'){await page.locator(c.selector).click();emit({clicked:c.selector});}
 if(c.action==='fill'){await page.locator(c.selector).fill(c.value);emit({filled:c.selector});}
 if(c.action==='select'){await page.locator(c.selector).selectOption(c.value);emit({selected:c.selector});}
 if(c.action==='blur'){await page.locator(c.selector).blur();emit({blurred:c.selector});}
 if(c.action==='reload'){await page.reload({waitUntil:'domcontentloaded'});await page.locator('.checkout-steps').waitFor({timeout:15000}).catch(()=>{});emit({reloaded:true});}
 if(c.action==='screenshot'){await page.screenshot({path:path.resolve('outputs',c.name),fullPage:true});emit({screenshot:c.name});}
 if(c.action==='viewport'){await page.setViewportSize({width:c.width,height:c.height});emit({viewport:{width:c.width,height:c.height}});}
 if(c.action==='state'){const r=await page.evaluate(async id=>{const r=await fetch('/api/storefront/checkouts/'+id);return {status:r.status,data:await r.json()};},state.cart_id);fs.writeFileSync(path.join(dir,c.name||'browser-checkout.json'),JSON.stringify(r,null,2));emit({checkoutRead:r.status,orderId:r.data.orderId,consignments:r.data.consignments});}
 }catch(e){emit({error:e.message.slice(0,1500)});}}
})().catch(e=>{emit({fatal:e.message,stack:e.stack?.slice(0,1500)});process.exitCode=1;});
