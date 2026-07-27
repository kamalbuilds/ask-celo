import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { CFG } from "../src/config.js";
import { loadSessionKey, usdcBalance, toUsd, isMiniPay, connect, topUp, sweepBack } from "../src/session.js";

const PRICE_USD = 0.01;
const TAG = import.meta.env.VITE_ATTRIBUTION_TAG as string | undefined;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, on = true) => ($(id).hidden = !on);

let wallet: Address | null = null;
let amount = 1;

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
  const balance = await usdcBalance(session.address);
  const usd = toUsd(balance);
  $("balance").textContent = `$${usd.toFixed(2)}`;
  const left = Math.floor(usd / PRICE_USD);
  $("questions-left").textContent =
    left > 0 ? `${left} question${left === 1 ? "" : "s"} left` : "Add credit to ask a question";
  $<HTMLButtonElement>("ask-btn").disabled = left < 1;
  show("sweep", usd > 0);
  // Only warn when there is something to lose. A standing warning on an empty
  // balance is noise; this appears precisely when clearing data would cost money.
  show("storage-note", usd > 0);
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
    if (!res.ok) throw new Error(`request failed (${res.status})`);
    const { answer } = await res.json();
    $("answer").textContent = answer;
    show("answer");
    setStatus("ask-status", "");

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
  if (!wallet) return;
  setStatus("topup-status", "Returning your credit…");
  try {
    const hash = await sweepBack(wallet);
    setStatus("topup-status", hash ? "Sent back to your wallet." : "Nothing to return.");
    await refreshBalance();
  } catch {
    setStatus("topup-status", "Could not return credit. Try again.", true);
  }
});

init();
