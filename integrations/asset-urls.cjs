// Resource positions in HTML/CSS/JSX and JSON metadata, not arbitrary visible hash text.
const RESOURCE =
  /(url\(\s*(?:&quot;|&#0*39;|["'])?|\bsrc(?:&quot;|["'])?\s*[:=]\s*(?:&quot;|["']))(asset:[a-f0-9]{64})/g;
function mapAssetUrls(markup, resolve) {
  return markup.replace(RESOURCE, (_match, prefix, ref) => prefix + resolve(ref));
}
function assetUrls(markup) {
  const refs = new Set();
  mapAssetUrls(markup, (ref) => {
    refs.add(ref);
    return ref;
  });
  return [...refs];
}
module.exports = { mapAssetUrls, assetUrls };
