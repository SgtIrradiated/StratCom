/**
 * Deterministic math for the simulation. Everything here is bit-identical across
 * JavaScript engines (ADR-0002). Deterministic trig/vector helpers arrive in M1.
 */
export { StateHasher } from "./hash";
export { Prng } from "./prng";
