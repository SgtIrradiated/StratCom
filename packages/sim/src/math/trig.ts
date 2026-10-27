/**
 * Deterministic trigonometry built only from `+ - * /`, `Math.sqrt`, `Math.floor` and
 * `Math.round`, which are exact or correctly rounded by the ECMAScript spec, so results are
 * bit-identical in every engine (ADR-0002). Accuracy is about 1e-9, far finer than gameplay
 * needs.
 */

/** π as the nearest double. */
export const PI = 3.141592653589793;
/** 2π. */
export const TWO_PI = 6.283185307179586;
/** π/2. */
export const HALF_PI = 1.5707963267948966;
/** π/4. */
export const QUARTER_PI = 0.7853981633974483;

/** Sine of `x` radians. */
export function sin(x: number): number {
  // Reduce to [-π, π], then fold to [-π/2, π/2] using sin(π - x) = sin(x).
  let r = x - TWO_PI * Math.round(x / TWO_PI);
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const r2 = r * r;
  // Taylor series to r^17: truncation error below 1e-11 on [-π/2, π/2].
  return (
    r *
    (1 +
      r2 *
        (-1 / 6 +
          r2 *
            (1 / 120 +
              r2 * (-1 / 5040 + r2 * (1 / 362880 + r2 * (-1 / 39916800 + r2 * (1 / 6227020800)))))))
  );
}

/** Cosine of `x` radians. */
export function cos(x: number): number {
  return sin(x + HALF_PI);
}

/** Arctangent of `z`, in (-π/2, π/2). */
export function atan(z: number): number {
  const negative = z < 0;
  let a = negative ? -z : z;
  // For a > 1 use atan(a) = π/2 - atan(1/a).
  const inverted = a > 1;
  if (inverted) a = 1 / a;
  // Two half-angle reductions atan(a) = 2·atan(a / (1 + √(1 + a²))) bring a below ~0.2.
  a = a / (1 + Math.sqrt(1 + a * a));
  a = a / (1 + Math.sqrt(1 + a * a));
  const a2 = a * a;
  let result =
    4 * a * (1 + a2 * (-1 / 3 + a2 * (1 / 5 + a2 * (-1 / 7 + a2 * (1 / 9 + a2 * (-1 / 11))))));
  if (inverted) result = HALF_PI - result;
  return negative ? -result : result;
}

/** Angle of the vector (`x`, `y`) in (-π, π], like `Math.atan2(y, x)`. */
export function atan2(y: number, x: number): number {
  if (x === 0) {
    if (y > 0) return HALF_PI;
    if (y < 0) return -HALF_PI;
    return 0;
  }
  const a = atan(y / x);
  if (x > 0) return a;
  return y >= 0 ? a + PI : a - PI;
}

/** Wraps an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  const r = a - TWO_PI * Math.round(a / TWO_PI);
  return r <= -PI ? r + TWO_PI : r;
}
