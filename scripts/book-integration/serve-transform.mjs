/**
 * The only transformation applied to the accepted player page.
 *
 * The accepted file on disk is never modified. For the preview copy:
 * - the cabinet starts `inert` so no control is playable before a real session,
 *   contract and recovered state exist;
 * - the demo fixture meters are removed, so no fixture credit/bet can leak into
 *   the live meters;
 * - the demo-player recovery call is replaced by a single awaited call into the
 *   integration bootstrap that runs after the accepted game/config assignment.
 */
export function transformPlayerHtml(html) {
  const withInert = html.replace(
    '<slot-game chrome="immersive" presentation="classic">',
    '<slot-game inert chrome="immersive" presentation="classic">',
  );
  const withoutFixture = withInert.replace(/[ \t]*for\(const \[selector,text\][^\n]*\n/, '');
  const withBootstrap = withoutFixture.replace(
    /try\{const state=await \(await fetch\(`\/v1\/state\/demo-player[\s\S]*?\}catch\(_error\)\{\/\* first load may have no persisted round \*\/\}/,
    "await (await import('/integration/bootstrap.mjs')).initialize(element);",
  );
  return withBootstrap;
}
