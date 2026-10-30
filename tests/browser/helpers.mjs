export async function openSpu(page,index=0){
  const group=page.locator('details.product[data-spu]').nth(index);
  await group.waitFor();
  if(!await group.evaluate(element=>element.open))await group.locator(':scope > summary').click();
  return group;
}
