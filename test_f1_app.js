import { chromium } from 'playwright';

async function test() {
  console.log("Starting Playwright verification for F1 Clash 3D...");
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error('PAGE ERROR:', msg.text());
    } else {
      console.log('PAGE LOG:', msg.text());
    }
  });

  page.on('pageerror', err => {
    console.error('PAGE UNCAUGHT EXCEPTION:', err);
  });

  console.log("Navigating to http://127.0.0.1:5173/ ...");
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });

  console.log("Waiting for loading screen to disappear (assets to load)...");
  await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 35000 });
  console.log("Loading overlay closed! 3D Scene & Cars successfully initialized.");

  // Wait 3 seconds for cars to drive along the track
  await page.waitForTimeout(3000);

  // Capture Screenshot 1: Default Orbit View with Racing Cars & HUD
  await page.screenshot({ path: 'screenshot_f1_orbit.png' });
  console.log("Saved screenshot_f1_orbit.png");

  // Read live telemetry values & performance monitor
  const speed = await page.$eval('#telemetry-speed', el => el.innerText);
  const gear = await page.$eval('#telemetry-gear', el => el.innerText);
  const rpm = await page.$eval('#telemetry-rpm', el => el.innerText);
  const drs = await page.$eval('#telemetry-drs', el => el.innerText);
  const lap = await page.$eval('#lap-counter', el => el.innerText);
  const fps = await page.$eval('#perf-fps', el => el.innerText);
  const frametime = await page.$eval('#perf-ms', el => el.innerText);

  console.log(`Telemetry check -> Speed: ${speed} km/h, Gear: ${gear}, RPM: ${rpm}, DRS: ${drs}, Lap: ${lap} | Performance: ${fps}, ${frametime}`);

  // Switch to F1 Clash Tactical Cam
  console.log("Testing F1 Clash Tactical Cam...");
  await page.click('[data-cam="clash"]');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot_f1_clash.png' });
  console.log("Saved screenshot_f1_clash.png");

  // Switch to Chase Cam
  console.log("Testing Chase Cam...");
  await page.click('[data-cam="chase"]');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot_f1_chase.png' });
  console.log("Saved screenshot_f1_chase.png");

  // Switch to Onboard T-Cam (Cockpit)
  console.log("Testing Onboard T-Cam...");
  await page.click('[data-cam="cockpit"]');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot_f1_cockpit.png' });
  console.log("Saved screenshot_f1_cockpit.png");

  // Switch to Sunset lighting
  console.log("Testing Sunset Lighting...");
  await page.click('#btn-tod');
  await page.click('[data-cam="tv"]');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot_f1_tv_sunset.png' });
  console.log("Saved screenshot_f1_tv_sunset.png");

  // Switch to Night lighting with Floodlights
  console.log("Testing Night Lighting...");
  await page.click('#btn-tod');
  await page.click('[data-cam="drone"]');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot_f1_drone_night.png' });
  console.log("Saved screenshot_f1_drone_night.png");

  await browser.close();
  console.log("=== Verification Finished Successfully! ===");
}

test().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
