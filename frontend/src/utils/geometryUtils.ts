/**
 * Geometry Utilities
 * Point-in-polygon detection, path simplification, and geometric calculations
 */

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Ray casting algorithm for point-in-polygon detection
 * @param point Point to test
 * @param polygon Array of polygon vertices
 * @returns true if point is inside polygon
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const x = point.x;
  const y = point.y;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Check if a bounding box intersects with a polygon
 * Tests multiple scenarios:
 * 1. Any bbox corner is inside polygon
 * 2. Any polygon vertex is inside bbox
 * 3. Center of bbox is inside polygon
 */
export function bboxIntersectsPolygon(bbox: BoundingBox, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;

  // Test 1: Check if any corner or center of bbox is inside polygon
  const bboxPoints: Point[] = [
    { x: bbox.x0, y: bbox.y0 }, // Top-left
    { x: bbox.x1, y: bbox.y0 }, // Top-right
    { x: bbox.x1, y: bbox.y1 }, // Bottom-right
    { x: bbox.x0, y: bbox.y1 }, // Bottom-left
    { x: (bbox.x0 + bbox.x1) / 2, y: (bbox.y0 + bbox.y1) / 2 }, // Center
  ];

  if (bboxPoints.some((point) => pointInPolygon(point, polygon))) {
    return true;
  }

  // Test 2: Check if any polygon vertex is inside bbox
  const polygonInBbox = polygon.some((point) =>
    point.x >= bbox.x0 && point.x <= bbox.x1 &&
    point.y >= bbox.y0 && point.y <= bbox.y1
  );

  if (polygonInBbox) {
    return true;
  }

  // Test 3: Check if bbox center is very close to polygon bounds
  // (handles edge cases where shapes overlap but no points are inside each other)
  const polygonBounds = getPolygonBounds(polygon);
  const bboxCenterX = (bbox.x0 + bbox.x1) / 2;
  const bboxCenterY = (bbox.y0 + bbox.y1) / 2;

  // Check if bounding boxes overlap
  const bboxesOverlap = !(
    bbox.x1 < polygonBounds.x0 ||
    bbox.x0 > polygonBounds.x1 ||
    bbox.y1 < polygonBounds.y0 ||
    bbox.y0 > polygonBounds.y1
  );

  return bboxesOverlap;
}

/**
 * Calculate distance between two points
 */
export function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Simplify polygon path using Ramer-Douglas-Peucker algorithm
 * Reduces number of points while maintaining shape
 * @param points Original path points
 * @param epsilon Simplification tolerance (higher = more simplified)
 */
export function simplifyPath(points: Point[], epsilon: number = 2): Point[] {
  if (points.length < 3) return points;

  // Find the point with maximum distance from line between first and last
  let maxDist = 0;
  let maxIndex = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const dist = perpendicularDistance(points[i], points[0], points[end]);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // If max distance is greater than epsilon, recursively simplify
  if (maxDist > epsilon) {
    const left = simplifyPath(points.slice(0, maxIndex + 1), epsilon);
    const right = simplifyPath(points.slice(maxIndex), epsilon);

    // Merge results (remove duplicate point)
    return [...left.slice(0, -1), ...right];
  } else {
    // All points can be removed except endpoints
    return [points[0], points[end]];
  }
}

/**
 * Calculate perpendicular distance from point to line segment
 */
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  if (dx === 0 && dy === 0) {
    // Line segment is actually a point
    return distance(point, lineStart);
  }

  // Calculate perpendicular distance
  const numerator = Math.abs(
    dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x
  );
  const denominator = Math.sqrt(dx * dx + dy * dy);

  return numerator / denominator;
}

/**
 * Check if polygon is closed (first and last points are close)
 */
export function isPolygonClosed(polygon: Point[], threshold: number = 10): boolean {
  if (polygon.length < 3) return false;
  return distance(polygon[0], polygon[polygon.length - 1]) < threshold;
}

/**
 * Close polygon by adding first point at the end if not already closed
 */
export function closePolygon(polygon: Point[], threshold: number = 10): Point[] {
  if (isPolygonClosed(polygon, threshold)) {
    return polygon;
  }
  return [...polygon, polygon[0]];
}

/**
 * Calculate bounding box for a polygon
 */
export function getPolygonBounds(polygon: Point[]): BoundingBox {
  if (polygon.length === 0) {
    return { x0: 0, y0: 0, x1: 0, y1: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    x0: minX,
    y0: minY,
    x1: maxX,
    y1: maxY,
  };
}

/**
 * Smooth polygon path using Catmull-Rom spline
 * Makes the path look more natural and less jagged
 */
export function smoothPath(points: Point[], smoothing: number = 0.2): Point[] {
  if (points.length < 3) return points;

  const smoothed: Point[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    // Calculate control points for smooth curve
    const smooth1 = {
      x: curr.x - (next.x - prev.x) * smoothing,
      y: curr.y - (next.y - prev.y) * smoothing,
    };

    const smooth2 = {
      x: curr.x + (next.x - prev.x) * smoothing,
      y: curr.y + (next.y - prev.y) * smoothing,
    };

    smoothed.push(smooth1, curr, smooth2);
  }

  smoothed.push(points[points.length - 1]);

  return smoothed;
}

/**
 * Calculate polygon area (for validation)
 */
export function getPolygonArea(polygon: Point[]): number {
  if (polygon.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    area += polygon[i].x * polygon[j].y;
    area -= polygon[j].x * polygon[i].y;
  }

  return Math.abs(area / 2);
}
