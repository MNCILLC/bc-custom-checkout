/* Run with a dedicated simple physical product and a test customer. Never submits an order. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expect: baseExpect } = require('@playwright/test');
const expect = baseExpect.configure({timeout:45000});
const { attachPreview, launchPreviewBrowser } = require('./warehouse-preview.cjs');

async function run() {
    const storefrontUrl = process.env.STOREFRONT_URL || 'http://localhost:3011';
    const productPath = process.env.PREVIEW_TEST_PRODUCT_PATH;
    const warehouseId = process.env.PREVIEW_TEST_WAREHOUSE_ID;
    let expectedReturnWarehouse = warehouseId;
    const customerFile = process.env.PREVIEW_TEST_CUSTOMER_FILE;
    const outputDir = process.env.PREVIEW_TEST_OUTPUT_DIR;
    assert(productPath?.startsWith('/') && !productPath.startsWith('//'), 'Set PREVIEW_TEST_PRODUCT_PATH to the dedicated product path.');
    assert(warehouseId && customerFile && outputDir, 'Set PREVIEW_TEST_WAREHOUSE_ID, PREVIEW_TEST_CUSTOMER_FILE and PREVIEW_TEST_OUTPUT_DIR.');
    const customer = JSON.parse(fs.readFileSync(customerFile, 'utf8'));
    const browser = await launchPreviewBrowser();
    const context = await browser.newContext({ viewport: {width:1440,height:1080}, serviceWorkers:'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    // No options.customer: the existing Catalyst login must be transferred by session sync.
    const preview = await attachPreview(context, page, { storefrontUrl });
    const checks = {};
    const check = (name, value) => { assert(value, name); checks[name] = true; console.log('PASS: ' + name); };
    async function session() {
        return page.evaluate(async () => {
            const response = await fetch('/api/auth/session');
            const data = await response.json();
            return { authenticated: !!data?.user?.customerAccessToken, cartId:data?.user?.cartId };
        });
    }
    async function checkout() {
        return page.evaluate(async id => {
            const response = await fetch('/api/storefront/checkouts/' + id);
            return { status:response.status, data:await response.json() };
        }, preview.handoff.cartId);
    }
    try {
        await page.goto(storefrontUrl + '/login/', { waitUntil:'domcontentloaded' });
        await page.locator('input[name=email]').fill(customer.email);
        await page.locator('input[name=password]').fill(customer.password);
        await page.getByRole('button', {name:'Log in', exact:true}).click();
        await expect.poll(async () => (await session()).authenticated, {timeout:45000}).toBe(true);
        const reject = page.getByRole('button', {name:'Reject All',exact:true});
        if (await reject.isVisible()) await reject.click();
        await page.goto(storefrontUrl + productPath, { waitUntil:'domcontentloaded' });
        const picker = page.locator('#warehouse-choice');
        await expect(picker).toBeEnabled();
        await Promise.all([
            page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).origin === new URL(storefrontUrl).origin),
            picker.selectOption(warehouseId),
        ]);
        await expect(picker).toBeEnabled();
        await expect(picker).toHaveValue(warehouseId);
        await page.getByRole('button', {name:'Add to cart',exact:true}).click();
        await expect(page.getByText('1 in cart', {exact:true})).toBeVisible();
        const initialSession = await session();
        check('storefront authenticated with cart', initialSession.authenticated && !!initialSession.cartId);
        await page.goto(storefrontUrl + '/cart/', {waitUntil:'domcontentloaded'});
        await expect(page.locator('#warehouse-choice')).toBeEnabled();
        await expect.poll(async () => {
            if (new URL(page.url()).origin === new URL(storefrontUrl).origin && /^\/cart\/?$/.test(new URL(page.url()).pathname)) {
                const button = page.locator('button:visible').filter({hasText:/^Preview checkout$/});
                if (await button.isEnabled()) await button.click();
            }
            return preview.events.find(event => event.path === '/session-sync')?.status;
        }, {timeout:90000,intervals:[1000,2000,3000]}).toBe(302);
        await preview.waitUntilReady();
        await expect(page.locator('.checkout-steps')).toBeVisible();
        await expect.poll(async () => (await checkout()).status).toBe(200);
        check('session sync succeeded without SDK login', preview.events.some(event => event.path === '/session-sync' && event.status === 302 && !event.crawlerBrowser));
        check('correct cart and warehouse transferred', preview.handoff.cartId === initialSession.cartId && preview.handoff.warehouse.id === warehouseId);
        const initial = await checkout();
        await expect(page.getByRole('button', {name:'Sign out',exact:true})).toBeVisible();
        await expect(page.getByText(customer.email,{exact:true})).toBeVisible();
        check('checkout customer authenticated', initial.data.cart.customerId > 0 && initial.data.cart.email === customer.email);
        check('enhanced checkout rendered', await page.locator('.enhancedThemeV1').count() > 0);
        await expect(page.locator('[data-test=warehouse-validation-content]')).toHaveJSProperty('disabled',false,{timeout:45000});
        const warehouse = preview.handoff.warehouse;
        if (warehouse.allowShipping) {
            await expect(page.locator('[data-test=warehouse-ship]')).toBeVisible();
            await page.locator('[data-test=warehouse-pickup]').click();
        } else {
            await expect(page.locator('[data-test=warehouse-ship]')).toHaveCount(0);
            await page.locator('[data-test=warehouse-prepare-pickup]').click();
        }
        await expect.poll(async () => (await checkout()).data.consignments?.[0]?.selectedPickupOption?.pickupMethodId).toBe(warehouse.pickupMethodId);
        check('native pickup matches selected warehouse', true);
        await page.reload({waitUntil:'domcontentloaded'});
        await expect(page.locator('[data-test=warehouse-pickup-summary]')).toBeVisible();
        await expect(page.locator('[data-test=warehouse-validation-content]')).toHaveJSProperty('disabled',false,{timeout:45000});
        await expect(page.locator('#checkout-payment-continue')).toBeVisible();
        const after = await checkout();
        check('pickup persists after refresh', after.data.consignments[0].selectedPickupOption.pickupMethodId === warehouse.pickupMethodId);
        check('order remains unsubmitted', after.data.orderId === null);
        fs.mkdirSync(outputDir, {recursive:true});
        await page.screenshot({path:path.join(outputDir, warehouseId + '-checkout.png'),fullPage:true,animations:'disabled'});
        if (process.env.PREVIEW_TEST_VALIDATION === 'true') {
            const callValidation = async (overrides = {}) => page.evaluate(async overrides => {
                const config = window.warehouseCheckout;
                const response = await fetch(config.validation.endpoint, {
                    method:'POST', credentials:'omit',
                    headers: { 'Content-Type':'application/json', Authorization:'Bearer ' + (overrides.token || config.validation.token) },
                    body:JSON.stringify({cartId:config.cartId,revision:config.validation.revision,...overrides.body}),
                });
                const data = await response.json();
                return {status:response.status,code:data.code,warehouse:data.warehouse,revision:data.revision};
            }, overrides);
            check('authenticated validator accepts current cart', (await callValidation()).status === 200);
            check('tampered credential rejected', (await callValidation({token:'invalid-token'})).status === 401);
            check('different cart rejected', (await callValidation({body:{cartId:'a3be09fb-77c5-4c8a-8c4e-853661e2a439'}})).status === 401);
            check('browser-supplied warehouse override rejected', (await callValidation({body:{warehouseId:'another-warehouse'}})).status === 400);
            if (warehouse.allowShipping) check('shipping-enabled warehouse permits shipping preflight', (await callValidation({body:{requestedMode:'shipping'}})).status === 200);
            if (!warehouse.allowShipping) check('pickup-only warehouse rejects shipping request', (await callValidation({body:{requestedMode:'shipping'}})).code === 'FULFILLMENT_CONFLICT');
            let mutateTestCart;
            const conflictProductId = Number(process.env.PREVIEW_TEST_CONFLICT_PRODUCT_ID);
            if (conflictProductId) {
                const envFile = process.env.PREVIEW_TEST_STORE_ENV_FILE;
                assert(envFile, 'Set PREVIEW_TEST_STORE_ENV_FILE for optional test-cart inventory conflict setup.');
                const environment = Object.fromEntries(fs.readFileSync(envFile,'utf8').split('\n').filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const index=line.indexOf('='); return [line.slice(0,index),line.slice(index+1).trim().replace(/^['"]|['"]$/g,'')];}));
                async function cartRequest(suffix,method,body) {
                    const response = await fetch('https://api.bigcommerce.com/stores/'+environment.BIGCOMMERCE_STORE_HASH+'/v3/carts/'+preview.handoff.cartId+suffix,{method,headers:{'X-Auth-Token':environment.BIGCOMMERCE_ACCESS_TOKEN,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
                    if (!response.ok) throw new Error('Test cart setup failed: HTTP '+response.status);
                    return response.status===204?undefined:(await response.json()).data;
                }
                mutateTestCart = cartRequest;
                const addedCart = await cartRequest('/items','POST',{line_items:[{product_id:conflictProductId,quantity:1}]});
                const added = {status:200,itemId:addedCart.line_items.physical_items.find(item=>item.product_id===conflictProductId)?.id};
                check('conflict fixture added to test cart', !!added.itemId && added.status < 300);
                try {
                    check('fresh location inventory rejects incompatible item', (await callValidation()).code === 'INVENTORY_CONFLICT');
                    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
                    await expect(page.locator('[data-test=warehouse-validation]')).toContainText('available', {timeout:45000});
                    await expect(page.locator('[data-test=warehouse-validation-content]')).toHaveJSProperty('disabled',true);
                } finally {
                    await cartRequest('/items/'+added.itemId,'DELETE');
                    check('conflict fixture removed after test', true);
                }
                await page.getByRole('button',{name:'Retry verification',exact:true}).click();
                await expect(page.locator('[data-test=warehouse-validation-content]')).toHaveJSProperty('disabled',false,{timeout:45000});
                check('inventory conflict can recover', (await callValidation()).status === 200);
            }
            // Two storefront tabs render the same revision. Reconfirming the warehouse
            // deliberately creates a new revision, without changing fixture inventory.
            const tabA = await context.newPage();
            const tabB = await context.newPage();
            for (const tab of [tabA,tabB]) {
                await tab.goto(storefrontUrl + '/cart/',{waitUntil:'domcontentloaded'});
                await expect(tab.locator('#warehouse-choice')).toBeEnabled();
            }
            const switchWarehouse = process.env.PREVIEW_TEST_SWITCH_WAREHOUSE_ID;
            if (switchWarehouse) {
                assert(mutateTestCart && conflictProductId, 'Switch test requires the dedicated alternate-location fixture.');
                await mutateTestCart('/items','POST',{line_items:[{product_id:conflictProductId,quantity:1}]});
                for (const item of after.data.cart.lineItems.physicalItems) await mutateTestCart('/items/'+item.id,'DELETE');
            }
            await Promise.all([
                tabA.waitForResponse(response=>response.request().method()==='POST' && new URL(response.url()).origin===new URL(storefrontUrl).origin),
                switchWarehouse ? tabA.locator('#warehouse-choice').selectOption(switchWarehouse) : tabA.locator('#warehouse-choice').dispatchEvent('change'),
            ]);
            if (switchWarehouse) {
                await expect(tabA.locator('#warehouse-choice')).toHaveValue(switchWarehouse);
                expectedReturnWarehouse = switchWarehouse;
                check('compatible warehouse switch persists on the same cart',true);
            }
            await expect(tabA.locator('#warehouse-choice')).toBeEnabled();
            await expect.poll(async () => (await callValidation()).code,{timeout:45000}).toBe('STALE_WAREHOUSE');
            check('old checkout credential rejected after another tab saves selection',true);
            await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            await expect(page.locator('[data-test=warehouse-validation]')).toContainText('changed in another tab',{timeout:45000});
            await expect(page.locator('[data-test=warehouse-validation-content]')).toHaveJSProperty('disabled',true);
            check('stale checkout visibly blocks fulfillment controls',true);
            await Promise.all([
                tabB.waitForResponse(response=>response.request().method()==='POST' && new URL(response.url()).origin===new URL(storefrontUrl).origin),
                tabB.locator('#warehouse-choice').dispatchEvent('change'),
            ]);
            await expect(tabB.getByRole('alert').filter({hasText:'changed in another tab'})).toBeVisible();
            check('stale storefront picker cannot overwrite newer selection',true);
            await page.screenshot({path:path.join(outputDir,warehouseId+'-stale-checkout.png'),fullPage:true,animations:'disabled'});
            await tabA.close(); await tabB.close();
        }
        await page.getByRole('link', {name:'Return to cart',exact:true}).click();
        await expect(page.locator('#warehouse-choice')).toBeEnabled();
        await expect(page.locator('#warehouse-choice')).toHaveValue(expectedReturnWarehouse);
        const returnedSession = await session();
        check('return to cart preserves login and cart', returnedSession.authenticated && returnedSession.cartId === initialSession.cartId);
        if (process.env.PREVIEW_TEST_VALIDATION === 'true') {
            const oldRevision = preview.handoff.validation.revision;
            await expect.poll(async () => {
                if (new URL(page.url()).origin === new URL(storefrontUrl).origin && /^\/cart\/?$/.test(new URL(page.url()).pathname)) {
                    const button = page.locator('button:visible').filter({hasText:/^Preview checkout$/});
                    if (await button.isEnabled()) await button.click();
                }
                return preview.handoff.validation.revision !== oldRevision;
            },{timeout:90000,intervals:[1000,2000,3000]}).toBe(true);
            await preview.waitUntilReady();
            await expect(page.locator('[data-test=warehouse-validation-content]')).toHaveJSProperty('disabled',false,{timeout:45000});
            check('fresh handoff recovers the current persisted warehouse',preview.handoff.warehouse.id === expectedReturnWarehouse && preview.handoff.validation.revision !== oldRevision);
            await page.getByRole('link',{name:'Return to cart',exact:true}).click();
            await expect(page.locator('#warehouse-choice')).toHaveValue(expectedReturnWarehouse);
        }
        check('no order or payment request attempted', !preview.events.some(event => event.reason === 'order_or_payment' && !['GET','HEAD','OPTIONS'].includes(event.method)));
        check('no checkout errors', preview.errors.length === 0);
        const result = { warehouseId, returnedWarehouseId:expectedReturnWarehouse, cartId:initialSession.cartId, checks, sessionSync:preview.events.filter(event => event.path === '/session-sync'),sdkSignInUsed:false,ordersSubmitted:0 };
        fs.writeFileSync(path.join(outputDir, warehouseId + '-result.json'), JSON.stringify(result,null,2));
        console.log(JSON.stringify({warehouseId,passed:Object.keys(checks).length,sessionSync:302,ordersSubmitted:0}));
    } catch (error) {
        fs.mkdirSync(outputDir, {recursive:true});
        await page.screenshot({path:path.join(outputDir, warehouseId + '-failure.png'), fullPage:true}).catch(() => {});
        console.error(JSON.stringify({path:new URL(page.url()).pathname,events:preview.events,errors:preview.errors}));
        throw error;
    } finally {
        await browser.close();
    }
}
run().catch(error => { console.error(error.message.replace(/(?:jwt|token)=[^&\s"]+/g,'credential=[redacted]'));process.exitCode=1; });
