"use client";

/**
 * Compatibility entry point.
 *
 * The single implementation is the whole-file port in
 * `elements/chain-of-thought.tsx` (vercel/ai-elements
 * `packages/elements/src/chain-of-thought.tsx` @
 * ca8be600bfd01b3131f9bf6134b51602a71f4374, Apache-2.0). Keeping this file as
 * a re-export prevents production and the Elements tests from drifting onto
 * two different state machines.
 */

export * from "./elements/chain-of-thought";
