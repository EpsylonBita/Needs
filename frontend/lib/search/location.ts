/** URL coordinates use the same longitude,latitude order as the search RPC. */
export function searchCenter(value: string): [number, number] | null {
  const parts = value.split(',');
  if (parts.length !== 2 || parts.some(part => !part.trim())) return null;
  const [lng, lat] = parts.map(Number);
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90 ? [lng, lat] : null;
}
