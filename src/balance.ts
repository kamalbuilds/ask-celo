import { PRICE } from "./config.js";

/**
 * What the UI should show for a given balance.
 *
 * Pulled out of the click handlers so it can be tested. The bug that motivated
 * this: when the balance read threw, the handler exited before disabling
 * anything, leaving Ask clickable over an unknown balance — the user pays for
 * a request that cannot complete. MiniPay users are on 2G/3G, so a failed read
 * is a normal condition, not an edge case.
 */
export type BalanceView = {
  balance: string;
  message: string;
  canAsk: boolean;
  canSweep: boolean;
  showStorageWarning: boolean;
};

/** The network could not be reached, so nothing about the balance is known. */
export const unknownBalance: BalanceView = {
  balance: "—",
  message: "Cannot reach the network. Check your connection.",
  // Never let someone spend against a balance we could not read.
  canAsk: false,
  // Neither action is meaningful without knowing what is there.
  canSweep: false,
  showStorageWarning: false,
};

export function balanceView(usd: number): BalanceView {
  const left = Math.floor(usd / PRICE.usd);
  return {
    balance: `$${usd.toFixed(2)}`,
    message: left > 0 ? `${left} question${left === 1 ? "" : "s"} left` : "Add credit to ask a question",
    canAsk: left >= 1,
    canSweep: usd > 0,
    // Only warn when there is something to lose. A standing warning on an
    // empty balance is noise; this appears exactly when clearing site data
    // would cost money.
    showStorageWarning: usd > 0,
  };
}
