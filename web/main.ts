import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { CFG, PRICE } from "../src/config.js";
import { balanceView, unknownBalance } from "../src/balance.js";
import { loadSessionKey, usdcBalance, toUsd, isMiniPay, connect, topUp, sweepBack } from "../src/session.js";

const PRICE_USD = PRICE.usd;
const TAG = import.meta.env.VITE_ATTRIBUTION_TAG as string | undefined;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, on = true) => ($(id).hidden = !on);

let wallet: Address | null = null;
// Matches the pre-selected chip. A mismatch here would charge an amount the
// user did not pick — the default must come from the markup, not a guess.
let amount = Number(
  document.querySelector<HTMLButtonElement>(".choice.is-selected")?.dataset.amount ?? 0.25,
);

/** The session key pays, so the x402 client is built once around it. */
const session = loadSessionKey();
const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(privateKeyToAccount(session.privateKey)));
const payFetch = wrapFetchWithPayment(fetch, client);

function setStatus(id: string, msg: string, isError = false) {
  const el = $(id);
  el.textContent = msg;
  el.classList.toggle("is-error", isError);
}

async function refreshBalance() {
  // The view is decided in balance.ts so it can be tested; this only applies it.
  let usd = 0;
  let view;
  try {
    usd = toUsd(await usdcBalance(session.address));
    // Read the connected wallet too, so an empty session with a funded wallet
    // reads differently from having no USDC at all.
    const walletUsd = wallet ? toUsd(await usdcBalance(wallet).catch(() => 0n)) : undefined;
    view = balanceView(usd, walletUsd);
  } catch {
    view = unknownBalance;
  }

  $("balance").textContent = view.balance;
  $("questions-left").textContent = view.message;
  // Not gated on balance: questions about the service, and questions we
  // cannot answer, are free — and a disabled button made every one of them
  // unreachable for the visitor who has not paid yet, which is exactly the
  // person they exist for. The paid path still stops at the paywall below.
  $<HTMLButtonElement>("ask-btn").disabled = false;
  show("sweep", view.canSweep);
  show("storage-note", view.showStorageWarning);
  return usd;
}

async function init() {
  if (!(window as any).ethereum) {
    show("no-wallet");
    return;
  }

  show("balance-card");
  show("topup");
  show("ask");

  // Balance first, and never behind the wallet prompt. A pending prompt can
  // stay unanswered indefinitely, and awaiting it here left the whole screen
  // showing a placeholder balance forever.
  await refreshBalance();

  // Auto-connect: MiniPay requires it, and a Connect Wallet button inside
  // MiniPay is a listing failure. Outside MiniPay this prompts, which is the
  // right behaviour for a browser wallet. Either way it must not block paint.
  connect()
    .then((account) => {
      wallet = account;
      if (!wallet) throw new Error("no account");
    })
    .catch(() => {
      setStatus(
        "topup-status",
        isMiniPay() ? "Reopen the app to continue." : "Connect a wallet to add credit.",
        true,
      );
      $<HTMLButtonElement>("topup-btn").disabled = true;
    });
}

for (const btn of document.querySelectorAll<HTMLButtonElement>(".choice")) {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".choice").forEach((b) => b.classList.remove("is-selected"));
    btn.classList.add("is-selected");
    amount = Number(btn.dataset.amount);
  });
}

$("topup-btn").addEventListener("click", async () => {
  const btn = $<HTMLButtonElement>("topup-btn");

  // A tap must never do nothing. If the wallet never connected (a prompt was
  // dismissed, or the page loaded before the provider), retry here rather than
  // returning silently and leaving the user pressing a dead button.
  if (!wallet) {
    setStatus("topup-status", "Connecting…");
    try {
      wallet = await connect();
    } catch {
      wallet = null;
    }
    if (!wallet) {
      setStatus(
        "topup-status",
        isMiniPay() ? "Reopen the app to continue." : "Connect a wallet to add credit.",
        true,
      );
      return;
    }
  }

  btn.disabled = true;
  setStatus("topup-status", "Confirm in your wallet…");
  const before = await usdcBalance(loadSessionKey().address);
  try {
    const hash = await topUp(wallet, amount, TAG);
    // The receipt link goes up immediately. If the page is closed mid-wait the
    // user still has a way to see what happened to their money.
    $("receipts").innerHTML = `<a href="${CFG.explorer}/tx/${hash}" target="_blank" rel="noopener">Top-up receipt</a>`;
    setStatus("topup-status", "Adding credit…");

    // Wait for the balance to actually rise. Comparing against the balance
    // before the transfer matters: a user who already had credit would other-
    // wise see "Ready" instantly, before their new money had arrived.
    let arrived = false;
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if ((await usdcBalance(loadSessionKey().address)) > before) {
        arrived = true;
        break;
      }
    }
    await refreshBalance();

    // Never claim success on a timeout. The transfer may still land, so say
    // that plainly rather than reporting "Ready" over an unchanged balance.
    setStatus(
      "topup-status",
      arrived ? "Ready." : "Still confirming. Your receipt is below; the credit will appear here.",
      !arrived,
    );
  } catch (e: any) {
    setStatus("topup-status", e?.message?.includes("reject") ? "Cancelled." : "Could not add credit. Try again.", true);
  } finally {
    btn.disabled = false;
  }
});

// A blank box does not tell anyone what is worth asking. Tapping an example
// fills it in rather than sending, so the user still chooses to spend.
// The button label is part of the price. Render it from the same constant so
// the UI cannot quote a figure the server does not charge.

/**
 * Reveal the answer and bring it into view.
 *
 * On a 360x640 phone the answer renders about 500px tall, below the fold: the
 * user taps Ask, nothing appears to happen, and the product looks broken at
 * the exact moment it worked. Desktop hid this because the whole page fits.
 */
function showAnswer(text: string) {
  const el = $("answer");
  el.textContent = text;
  show("answer");
  // Deliberately not `behavior: "smooth"`. Smooth scrolling is ignored under
  // headless emulation and in any browser with reduced-motion set, which means
  // the one behaviour that matters here could not be verified. An instant
  // scroll always happens, so it is the one that ships.
  el.scrollIntoView({ block: "center" });
}

$("ask-btn").textContent = `Ask · ${PRICE.short}`;

for (const chip of document.querySelectorAll<HTMLButtonElement>(".example")) {
  chip.addEventListener("click", () => {
    const box = $<HTMLTextAreaElement>("q");
    box.value = chip.textContent ?? "";
    box.focus();
  });
}

$("ask-btn").addEventListener("click", async () => {
  const q = $<HTMLTextAreaElement>("q").value.trim();
  if (!q) return;
  const btn = $<HTMLButtonElement>("ask-btn");
  btn.disabled = true;
  show("answer", false);
  setStatus("ask-status", "Thinking…");
  const balanceBefore = await usdcBalance(loadSessionKey().address).catch(() => 0n);
  try {
    // The 402 handshake, signing and retry all happen inside payFetch. The
    // user is not prompted: the session key already holds the funds.
    const res = await payFetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q }),
    });
    if (!res.ok) {
      // An off-topic question is refused free with guidance on what this can
      // answer. Showing "request failed (400)" would hide the one piece of
      // text that tells the user how to get their money's worth.
      const body = await res.json().catch(() => ({}) as { hint?: string });
      if (body.hint) {
        showAnswer(body.hint);
        setStatus("ask-status", "");
        return;
      }
      // A paid question with no credit: the x402 client cannot settle, and
      // the raw status is meaningless to someone who has not topped up. Say
      // the one thing that unblocks them.
      if (res.status === 402) {
        setStatus("ask-status", "That one costs a cent. Add credit above and ask again.", true);
        return;
      }
      throw new Error(`request failed (${res.status})`);
    }
    const { answer } = await res.json();
    showAnswer(answer);
    setStatus("ask-status", "");

    // Clear the box. The answered question sitting there means a second one
    // starts with manual deletion, and a repeat tap re-asks and re-charges for
    // something already on screen.
    $<HTMLTextAreaElement>("q").value = "";

    const receipt = res.headers.get("payment-response");
    if (receipt) {
      const decoded = JSON.parse(atob(receipt));
      const hash = decoded.transaction ?? decoded.txHash;
      if (hash)
        $("receipts").innerHTML = `<a href="${CFG.explorer}/tx/${hash}" target="_blank" rel="noopener">Payment receipt</a>`;
    }
    await refreshBalance();
  } catch (e: any) {
    // Do not promise the money is safe without checking. The middleware does
    // cancel settlement when the handler fails, but this catch also fires on a
    // dropped connection after payment, where the claim would be false.
    // Re-read the balance and say only what is true.
    console.error(e);
    try {
      const spent = (await usdcBalance(loadSessionKey().address)) < balanceBefore;
      setStatus(
        "ask-status",
        spent
          ? "Something went wrong after payment. Your receipt is below."
          : "Could not get an answer. Your credit was not spent.",
        true,
      );
    } catch {
      setStatus("ask-status", "Could not get an answer. Check your balance below.", true);
    }
    await refreshBalance().catch(() => {});
  } finally {
    btn.disabled = false;
  }
});

$("sweep").addEventListener("click", async () => {
  const btn = $<HTMLButtonElement>("sweep");

  // Same rule as the top-up button: a tap must never silently do nothing.
  if (!wallet) {
    setStatus("topup-status", "Connecting…");
    try {
      wallet = await connect();
    } catch {
      wallet = null;
    }
    if (!wallet) {
      setStatus("topup-status", "Connect a wallet to return your credit.", true);
      return;
    }
  }

  // Without this the button stays live during a settlement that takes seconds,
  // and a second tap signs a second authorization for money already moving.
  btn.disabled = true;
  setStatus("topup-status", "Returning your credit…");
  try {
    const hash = await sweepBack(wallet);
    if (!hash) {
      setStatus("topup-status", "Nothing to return.");
      return;
    }

    $("receipts").innerHTML = `<a href="${CFG.explorer}/tx/${hash}" target="_blank" rel="noopener">Refund receipt</a>`;

    // A settlement hash means the facilitator accepted it, not that the funds
    // have landed. Confirm the balance actually emptied before saying so.
    let returned = false;
    for (let i = 0; i < 20; i++) {
      if ((await usdcBalance(loadSessionKey().address)) === 0n) {
        returned = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    setStatus(
      "topup-status",
      returned ? "Sent back to your wallet." : "Refund submitted. Your receipt is below.",
      !returned,
    );
    await refreshBalance();
  } catch (e: any) {
    // Say why. "Try again" on a refund that will never work is cruel, and the
    // server's reason (over the limit, not the full balance) is actionable.
    const reason = typeof e?.message === "string" && e.message.length < 120 ? e.message : "";
    setStatus("topup-status", reason ? `Could not return credit: ${reason}` : "Could not return credit. Try again.", true);
    console.error(e);
  } finally {
    btn.disabled = false;
  }
});

init();
