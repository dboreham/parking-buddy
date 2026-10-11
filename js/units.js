// Parse a length in feet: decimal feet, feet and inches (9'6", 9 ft 6 in)
// or inches alone (114").
export function parseLength(str) {
  const s = String(str).trim().toLowerCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!s) return NaN;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inches)?)?$/);
  if (m) return parseFloat(m[1]) + (m[2] ? parseFloat(m[2]) / 12 : 0);
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inches)$/);
  if (m) return parseFloat(m[1]) / 12;
  if (/^\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
  return NaN;
}
