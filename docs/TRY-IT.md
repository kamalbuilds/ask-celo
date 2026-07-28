# Try it

The service is live on Celo mainnet at **https://ask-celo.vercel.app** and
charges $0.01 in USDC per question.

## From a browser (the MiniPay path)

1. Open https://ask-celo.vercel.app
2. Tap **Add credit** and approve one transfer. The default is 25c, which is
   25 questions — enough to decide whether this is worth anything to you. That is the only wallet
   approval you will ever see: no signature prompt, no seed phrase, and the
   network fee is paid in USDC so you never need CELO.
3. Ask something. Each question spends a cent from the session key.
   Questions about the service itself ("is this a scam", "can I get a refund",
   "what happens to my money") are answered **free**, before the paywall — you
   have not agreed to pay anything yet. Questions the service cannot answer are
   refused free too, so you are never charged for a non-answer.
4. **Return unused credit** sends whatever is left back to your wallet. Your
   browser signs the refund and the facilitator pays the gas, because the
   session key holds USDC and no CELO and so cannot pay for a transfer itself.

Inside MiniPay it auto-connects, as MiniPay requires. In a desktop wallet it
prompts once.

## From an agent or a script

The buyer needs USDC on Celo mainnet and **no CELO**: the facilitator submits
the settlement and sponsors the gas.

```bash
npm i @x402/fetch @x402/evm viem
```

```ts
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client();
const account = privateKeyToAccount(process.env.KEY);
client.register("eip155:*", new ExactEvmScheme(account));
const pay = wrapFetchWithPayment(fetch, client);

const res = await pay("https://ask-celo.vercel.app/api/ask", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ q: "what is a dollar worth in shillings?" }),
});

if (res.status === 402) {
  // The wallet could not pay. Almost always: no USDC on Celo mainnet at that
  // address. Fund it and run again — the buyer needs no CELO, since the
  // facilitator sponsors the settlement gas.
  console.error("payment failed — is there USDC on Celo mainnet at", account.address, "?");
} else {
  console.log(await res.json());
  // The settlement tx hash comes back in the payment-response header. It is
  // absent on any non-200, so guard before decoding it.
  const receipt = res.headers.get("payment-response");
  if (receipt) console.log("settled:", JSON.parse(atob(receipt)).transaction);
}
```

The 402 is what an unfunded wallet gets, and the body is empty by design: the
terms live in the `payment-required` header. `GET /api/health` states the price
in plain JSON if you want to read it before paying.

## What it answers

| Ask | Get |
|---|---|
| `dollar to shillings` | the live USD/KES rate from Mento's on-chain oracle |
| `dollar to pesos`, `send money to brazil` | the same for COP and BRL, either direction |
| `what does a transfer cost` | current gas and what a transfer really costs |
| `how much cKES exists` | live supply of each local stablecoin |
| `how fast are blocks` | current height and finality |

Every answer is read at the moment you ask.

## Inspect it without paying

```bash
curl https://ask-celo.vercel.app/api/health

# the 402 challenge, decoded. The question must be one the service can
# answer: anything else is refused for free before the paywall, so it never
# produces a challenge.
curl -si -X POST https://ask-celo.vercel.app/api/ask \
  -H 'content-type: application/json' -d '{"q":"dollar to shillings"}' \
  | grep -i '^payment-required' | cut -d' ' -f2 | tr -d '\r' | base64 -d
```

That returns the exact terms: `eip155:42220`, Celo USDC
`0xcebA9300f2b948710d2653dD7B07f33A8B32118C`, `10000` base units, and the
receiving address. Nothing is hidden behind a signup.
