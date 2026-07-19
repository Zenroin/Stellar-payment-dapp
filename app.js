/* ============================================================
   StellarPay — Simple Payment dApp (Stellar Testnet)
   Level 1 (White Belt) — Rise In · Stellar Journey to Mastery

   Features:
   1. Connect / disconnect the Freighter wallet
   2. Fetch & display the XLM balance (Horizon testnet)
   3. Fund the account via Friendbot
   4. Send an XLM payment and show success/failure + tx hash
   ============================================================ */

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";
const EXPLORER_TX = "https://stellar.expert/explorer/testnet/tx/";

// Freighter's browser bundle exposes `window.freighterApi`
const freighter = window.freighterApi;

// ── State ────────────────────────────────────────────────────
let state = {
  address: null,
  network: null,
};

// ── DOM ──────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
  connect: $("btn-connect"),
  disconnect: $("btn-disconnect"),
  chip: $("wallet-chip"),
  address: $("wallet-address"),
  refresh: $("btn-refresh"),
  fund: $("btn-fund"),
  balance: $("balance-value"),
  balanceNote: $("balance-note"),
  dest: $("input-dest"),
  amount: $("input-amount"),
  memo: $("input-memo"),
  send: $("btn-send"),
  txCard: $("tx-status"),
  txBody: $("tx-body"),
  netWarn: $("network-warning"),
};

// ── Helpers ──────────────────────────────────────────────────
const short = (addr) => `${addr.slice(0, 4)}…${addr.slice(-4)}`;

// Freighter API responses differ slightly between versions:
// some return plain values, newer ones return { address / error } objects.
function unwrap(result, key) {
  if (result && typeof result === "object") {
    if (result.error) throw new Error(result.error.message || String(result.error));
    if (key in result) return result[key];
  }
  return result;
}

function setStatus(html) {
  els.txCard.classList.remove("hidden");
  els.txBody.innerHTML = html;
  els.txCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderSuccess(hash) {
  setStatus(`
    <p class="tx-line tx-ok">✓ Transaction successful</p>
    <p class="tx-line">Transaction hash:</p>
    <div class="tx-hash">${hash}</div>
    <p class="tx-line"><a href="${EXPLORER_TX}${hash}" target="_blank" rel="noreferrer">View on Stellar Expert ↗</a></p>
  `);
}

function renderError(message) {
  setStatus(`
    <p class="tx-line tx-err">✗ Transaction failed</p>
    <p class="tx-line">${escapeHtml(message)}</p>
  `);
}

function renderPending(message) {
  setStatus(`<p class="tx-line"><span class="spinner"></span>${escapeHtml(message)}</p>`);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

function setConnectedUI(connected) {
  els.connect.classList.toggle("hidden", connected);
  els.chip.classList.toggle("hidden", !connected);
  els.refresh.disabled = !connected;
  els.fund.disabled = !connected;
  els.send.disabled = !connected;
  if (!connected) {
    els.balance.textContent = "—";
    els.balanceNote.textContent = "Connect your wallet to see your balance.";
    els.netWarn.classList.add("hidden");
  }
}

// ── 1. Wallet connect / disconnect ───────────────────────────
async function connectWallet() {
  try {
    if (!freighter) {
      alert("Freighter extension not found. Install it from https://www.freighter.app and refresh the page.");
      return;
    }

    els.connect.disabled = true;
    els.connect.textContent = "Connecting…";

    // Ask the user for permission and get the public key
    const address = unwrap(await freighter.requestAccess(), "address");
    if (!address) throw new Error("No address returned by Freighter.");

    state.address = address;
    els.address.textContent = short(address);
    els.address.title = address;
    setConnectedUI(true);

    // Verify the wallet is on TESTNET
    try {
      const network = unwrap(await freighter.getNetwork(), "network");
      state.network = network;
      els.netWarn.classList.toggle("hidden", String(network).toUpperCase() === "TESTNET");
    } catch (_) {
      /* getNetwork not critical */
    }

    await refreshBalance();
  } catch (err) {
    alert("Could not connect wallet: " + err.message);
  } finally {
    els.connect.disabled = false;
    els.connect.textContent = "Connect Freighter";
  }
}

function disconnectWallet() {
  // Freighter has no programmatic "disconnect"; we clear the app session.
  state.address = null;
  state.network = null;
  setConnectedUI(false);
  els.txCard.classList.add("hidden");
}

// ── 2. Balance handling ──────────────────────────────────────
async function refreshBalance() {
  if (!state.address) return;
  els.balance.textContent = "…";
  els.balanceNote.textContent = "Fetching balance from Horizon…";

  try {
    const res = await fetch(`${HORIZON_URL}/accounts/${state.address}`);

    if (res.status === 404) {
      els.balance.textContent = "0";
      els.balanceNote.textContent =
        "Account not found on testnet — it isn't funded yet. Use Friendbot below.";
      return;
    }
    if (!res.ok) throw new Error(`Horizon returned ${res.status}`);

    const account = await res.json();
    const native = account.balances.find((b) => b.asset_type === "native");
    const xlm = native ? Number(native.balance) : 0;

    els.balance.textContent = xlm.toLocaleString("en-US", {
      maximumFractionDigits: 7,
    });
    els.balanceNote.textContent = `Live XLM balance of ${short(state.address)} on testnet.`;
  } catch (err) {
    els.balance.textContent = "—";
    els.balanceNote.textContent = "Failed to fetch balance: " + err.message;
  }
}

// ── Friendbot funding ────────────────────────────────────────
async function fundWithFriendbot() {
  if (!state.address) return;
  els.fund.disabled = true;
  els.fund.textContent = "Requesting XLM…";
  try {
    const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(state.address)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.detail || `Friendbot returned ${res.status}`);
    }
    await refreshBalance();
  } catch (err) {
    alert("Friendbot request failed: " + err.message);
  } finally {
    els.fund.disabled = false;
    els.fund.textContent = "Fund with Friendbot (testnet)";
  }
}

// ── 3. Transaction flow ──────────────────────────────────────
async function sendPayment() {
  const destination = els.dest.value.trim();
  const amount = els.amount.value.trim();
  const memoText = els.memo.value.trim();

  // Basic validation
  if (!state.address) return;
  if (!/^G[A-Z2-7]{55}$/.test(destination)) {
    renderError("Invalid destination address. Stellar public keys start with G and are 56 characters long.");
    return;
  }
  if (!amount || Number(amount) <= 0) {
    renderError("Please enter an amount greater than 0.");
    return;
  }
  if (destination === state.address) {
    renderError("Destination is the same as the connected wallet.");
    return;
  }

  els.send.disabled = true;

  try {
    renderPending("Building transaction…");

    const server = new (StellarSdk.Horizon?.Server || StellarSdk.Server)(HORIZON_URL);
    const sourceAccount = await server.loadAccount(state.address);

    // If the destination account doesn't exist yet on testnet,
    // we must use createAccount instead of payment.
    let destinationExists = true;
    try {
      await server.loadAccount(destination);
    } catch (e) {
      destinationExists = false;
    }

    const operation = destinationExists
      ? StellarSdk.Operation.payment({
          destination,
          asset: StellarSdk.Asset.native(),
          amount,
        })
      : StellarSdk.Operation.createAccount({
          destination,
          startingBalance: amount,
        });

    const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    }).addOperation(operation);

    if (memoText) builder.addMemo(StellarSdk.Memo.text(memoText));

    const tx = builder.setTimeout(60).build();

    renderPending("Waiting for signature in Freighter…");

    const signResult = await freighter.signTransaction(tx.toXDR(), {
      networkPassphrase: StellarSdk.Networks.TESTNET,
    });
    const signedXdr = unwrap(signResult, "signedTxXdr");

    renderPending("Submitting to the Stellar testnet…");

    const signedTx = StellarSdk.TransactionBuilder.fromXDR(
      signedXdr,
      StellarSdk.Networks.TESTNET
    );
    const result = await server.submitTransaction(signedTx);

    renderSuccess(result.hash);
    els.dest.value = "";
    els.amount.value = "";
    els.memo.value = "";
    await refreshBalance();
  } catch (err) {
    // Surface Horizon's result codes when available (e.g. underfunded)
    const codes = err?.response?.data?.extras?.result_codes;
    const detail = codes ? JSON.stringify(codes) : err.message || String(err);
    renderError(detail);
  } finally {
    els.send.disabled = false;
  }
}

// ── Starfield background (decorative) ────────────────────────
function drawStars() {
  const canvas = $("stars");
  const ctx = canvas.getContext("2d");
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 140; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      const r = Math.random() * 1.2;
      ctx.globalAlpha = 0.2 + Math.random() * 0.6;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  resize();
  window.addEventListener("resize", resize);
}

// ── Wire up ──────────────────────────────────────────────────
els.connect.addEventListener("click", connectWallet);
els.disconnect.addEventListener("click", disconnectWallet);
els.refresh.addEventListener("click", refreshBalance);
els.fund.addEventListener("click", fundWithFriendbot);
els.send.addEventListener("click", sendPayment);
drawStars();

// Auto-restore session if the site is already authorized in Freighter
(async () => {
  try {
    if (!freighter) return;
    const allowed = unwrap(await freighter.isAllowed(), "isAllowed");
    if (allowed) {
      const address = unwrap(await freighter.getAddress(), "address");
      if (address) {
        state.address = address;
        els.address.textContent = short(address);
        els.address.title = address;
        setConnectedUI(true);
        refreshBalance();
      }
    }
  } catch (_) {
    /* silent — user can connect manually */
  }
})();
