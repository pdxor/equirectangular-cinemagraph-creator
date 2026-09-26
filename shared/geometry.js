export const wrap = (x, width) => ((x % width) + width) % width;
export const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

export function normalizeOverlay(placement, asset, width, height) {
  const { x, y, width: requestedWidth, opacity = 1 } = placement;
  if (![x, y, requestedWidth, opacity, asset.width, asset.height].every(Number.isFinite)) throw new Error('Invalid overlay placement.');
  const w = Math.round(requestedWidth), h = Math.max(1, Math.round(w * asset.height / asset.width)), top = Math.round(y);
  if (w < 1 || w > width || h > height || top < 0 || top + h > height || opacity < 0 || opacity > 1) throw new Error('Keep the overlay within the panorama height and use opacity from 0 to 1.');
  return { source: asset.file, x: wrap(Math.round(x), width), y: top, width: w, height: h, opacity };
}

export function normalizeRegion(region, width, height) {
  if (![region?.x, region?.y, region?.size, width, height].every(Number.isFinite)) throw new Error('Invalid square selection.');
  const size = Math.round(region.size);
  if (size < 16 || size > height) throw new Error('Square must be between 16 pixels and the panorama height.');
  const y = Math.round(region.y);
  if (y < 0 || y + size > height) throw new Error('Square extends above or below the panorama.');
  return { x: wrap(Math.round(region.x), width), y, size };
}

// The lasso identifies a square crop, not an irregular compositing mask.
export function squareFromPoints(points, width, height) {
  const unwrapped = [];
  for (const point of points) {
    let x = point.x;
    const previous = unwrapped.at(-1);
    if (previous) {
      while (x - previous.x > width / 2) x -= width;
      while (x - previous.x < -width / 2) x += width;
    }
    unwrapped.push({ x, y: point.y });
  }
  const xs = unwrapped.map(p => p.x), ys = unwrapped.map(p => p.y);
  const left = Math.min(...xs), right = Math.max(...xs);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const size = Math.round(clamp(Math.max(right - left, bottom - top), 16, height));
  return { x: Math.round(wrap((left + right - size) / 2, width)), y: Math.round(clamp((top + bottom - size) / 2, 0, height - size)), size };
}

export function regionSegments(region, width) {
  const firstWidth = Math.min(region.size, width - region.x);
  const parts = [{ x: region.x, y: region.y, width: firstWidth, offset: 0 }];
  if (firstWidth < region.size) parts.push({ x: 0, y: region.y, width: region.size - firstWidth, offset: firstWidth });
  return parts;
}
