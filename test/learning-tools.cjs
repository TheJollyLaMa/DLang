async function openTool(page, name) {
  const button = page.locator(`.tool-rail [data-open-panel="${name}"]`);
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await page.locator(`#panel-${name}`).waitFor({ state: 'visible' });
}
module.exports = { openTool };
