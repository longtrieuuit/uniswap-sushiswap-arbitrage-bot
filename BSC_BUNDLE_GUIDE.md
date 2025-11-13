# Hướng Dẫn Sử Dụng eth_sendBundle Trên BSC

## 🎯 Tổng Quan

Trên **BSC (Binance Smart Chain)**, không có Flashbots chính thức như Ethereum. Thay vào đó, có 3 dịch vụ chính để gửi bundle transactions:

1. **NodeReal** - Dịch vụ Bundle API theo chuẩn BEP-322
2. **48Club** - Puissant Builder với eth_sendBundle
3. **bloXroute** - blxr_submit_bundle (tốn phí $5,000/tháng)

---

## 📚 DANH SÁCH DỰ ÁN GITHUB

### 1. NodeReal - Web3.js Plugin Bundle (⭐ Khuyên Dùng)

**Repository:** https://github.com/node-real/web3.js-plugin-bundle

**Đặc điểm:**
- ✅ Plugin chính thức cho Web3.js
- ✅ Tuân thủ BEP-322
- ✅ Miễn phí (cần API key)
- ✅ Code examples đầy đủ

**Cài Đặt:**
```bash
npm install @node-real/web3-plugin-bundle
# hoặc
pnpm i @node-real/web3-plugin-bundle
```

**Code Example:**
```javascript
const { Web3 } = require("web3");
const { Web3BundlePlugin } = require("@node-real/web3-plugin-bundle");

// 1. Khởi tạo Web3 với NodeReal RPC
const web3 = new Web3("https://bsc-mainnet.nodereal.io/v1/YOUR_API_KEY");

// 2. Register plugin
web3.registerPlugin(new Web3BundlePlugin());

// 3. Lấy bundle price hiện tại
let bundlePrice = await web3.bundle.bundlePrice();
console.log("Current bundle price:", bundlePrice);

// 4. Tạo và ký transactions
const signedTxs = [];
for (let i = 0; i < 3; i++) {
  const tx = {
    from: myAddress,
    to: targetAddress,
    value: web3.utils.toWei("0.0001", "ether"),
    gas: 100000,
    gasPrice: bundlePrice, // ← Dùng bundle price!
    nonce: await web3.eth.getTransactionCount(myAddress) + i,
  };

  const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
  signedTxs.push(signedTx.rawTransaction);
}

// 5. Gửi bundle
const bundleHash = await web3.bundle.sendBundle({
  txs: signedTxs,
  maxBlockNumber: 0, // 0 = không giới hạn block
  // revertingTxHashes: [] // Optional: tx được phép revert
});

console.log("Bundle hash:", bundleHash);

// 6. Query bundle status
const status = await web3.bundle.queryBundle(bundleHash);
console.log("Bundle status:", status);
```

**API Methods:**
```javascript
// Lấy giá bundle
await web3.bundle.bundlePrice()

// Gửi bundle
await web3.bundle.sendBundle({
  txs: [rawTx1, rawTx2, ...],
  maxBlockNumber: 0,
  revertingTxHashes: [] // Optional
})

// Query bundle
await web3.bundle.queryBundle(bundleHash)

// Lấy danh sách builders
await web3.bundle.builders()

// Lấy danh sách validators
await web3.bundle.validators()
```

**RPC Endpoints:**
```
Mainnet: https://bsc-mainnet.nodereal.io/v1/YOUR_API_KEY
Testnet: https://bsc-testnet.nodereal.io/v1/YOUR_API_KEY
```

---

### 2. NodeReal - JS Direct Route (⚠️ DEPRECATED)

**Repository:** https://github.com/node-real/js-direct-route

**Trạng thái:** ❌ Archived vào 30/01/2023 - KHÔNG còn support

**Lý do liệt kê:** Tham khảo code pattern

**Code Example (Chỉ Tham Khảo):**
```javascript
const Web3 = require('@node-real/web3');

const directRouteEndPoint = "https://api.nodereal.io/direct-route";
let web3 = new Web3(directRouteEndPoint);

const bundleArgs = {
  'txs': [signedTx1.rawTransaction, signedTx2.rawTransaction],
  'minTimestamp': Math.floor(Date.now() / 1000),
  'maxTimestamp': Math.floor(Date.now() / 1000) + 300, // +5 phút
  'revertingTxHashes': [signedTx2.transactionHash], // Cho phép tx2 revert
};

const bundleHash = await web3.eth.sendBundle(bundleArgs);
```

---

### 3. 48Club - Puissant Builder

**Documentation:** https://docs.48.club/puissant-builder/send-bundle

**RPC Endpoint:**
```
https://puissant-bsc.48.club
```

**Method:** `eth_sendBundle` (Giống Flashbots!)

**Code Example:**
```javascript
const Web3 = require('web3');
const web3 = new Web3('https://puissant-bsc.48.club');

// Tạo bundle request
const bundleRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "eth_sendBundle",
  params: [
    {
      txs: [
        "0x02f873...", // Raw transaction 1
        "0x02f874...", // Raw transaction 2
      ],
      maxBlockNumber: "0x1234567", // Hex format
      maxTimestamp: 1234567890, // Unix timestamp
      revertingTxHashes: [], // Tx được phép revert
      // 48spSign: "..." // Optional signature
    }
  ]
};

// Gửi bundle
const response = await fetch('https://puissant-bsc.48.club', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(bundleRequest)
});

const result = await response.json();
console.log("Bundle hash:", result.result);
```

**Đặc Điểm:**
- ✅ API tương thích Flashbots (eth_sendBundle)
- ✅ Support revertingTxHashes
- ✅ Auction mechanism (gas fees + direct BNB transfers)
- ⚠️ Cần research thêm về phí

**Auction Pricing:**
```
Bundle Priority = Total Gas Fees + Direct BNB Transfers to Builder
→ Direct transfers được ưu tiên cao hơn trong auction
```

---

### 4. bloXroute - BSC Bundle Submission

**Documentation:** https://docs.bloxroute.com/bsc-and-eth/apis/transaction-bundles/bundle-submission/bsc-bundle-submission

**RPC Endpoint:**
```
https://api.blxrbdn.com
```

**Method:** `blxr_submit_bundle`

**Chi Phí:** 💰 $5,000/tháng base fee + per-bundle costs

**Code Example:**
```javascript
const axios = require('axios');

const bundle = {
  jsonrpc: "2.0",
  id: 1,
  method: "blxr_submit_bundle",
  params: {
    transaction: [
      "ab..ab", // Raw tx WITHOUT 0x prefix, comma separated
      "cd..cd"
    ],
    blockchain_network: "BSC-Mainnet",
    block_number: "0xa11446", // Target block (hex)
    mev_builders: {
      all: "" // Gửi tới tất cả builders
    },
    // Optional:
    min_timestamp: 1234567890,
    max_timestamp: 1234567900,
    reverting_hashes: [] // Tx được phép revert
  }
};

const response = await axios.post('https://api.blxrbdn.com', bundle, {
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'YOUR_AUTH_HEADER' // ← Cần auth token
  }
});

console.log("Bundle result:", response.data.result);
```

**Đặc Điểm:**
- ✅ Professional-grade service
- ✅ Guaranteed delivery to validators
- ✅ Bundle tracking & tracing
- ❌ Chi phí CỰC CAO ($5k/tháng)
- ⚠️ Phù hợp với institutional MEV searchers

**Theo nghiên cứu từ DonggeunYu/MEV-Attack-on-the-BSC:**
> "bloXroute có profits thấp hơn General path vì phí cạnh tranh cao"

---

### 5. DonggeunYu/MEV-Attack-on-the-BSC (⭐ Case Study Thực Tế)

**Repository:** https://github.com/DonggeunYu/MEV-Attack-on-the-BSC

**Đặc điểm:**
- ✅ MEV bot thực tế hoạt động từ 01/2024 - 05/2024
- ✅ Sử dụng cả bloXroute VÀ 48Club
- ✅ Code Python với sandwich attacks
- ✅ Có số liệu profit/loss thực tế

**Kiến Trúc:**
```
MEV Bot
├── General Path (Public mempool)
├── 48 Club (Puissant API)
└── bloXroute ($5k/month)
```

**Kết Luận Từ Tác Giả:**
```
1. General Path: Profit cao nhất, nhưng rủi ro gas cao
2. 48 Club: Profit trung bình, de-risk failed transactions
3. bloXroute: Profit thấp nhất (vì phí cao), nhưng guaranteed ordering
```

**Lưu Ý:** Code chi tiết trong thư mục `src/` (Python)

---

### 6. Các MEV Bot Projects Khác

#### A. marksantiago02/Ethereum-MEV-BOT
**Repository:** https://github.com/marksantiago02/Ethereum-MEV-BOT

- MEV bot cho cả Ethereum VÀ BSC
- Bundle optimization
- Next-block transaction bundling

#### B. sunwayliving/BSC-MEV-Frontrunning-Sandwich-Bot-Opensource
**Repository:** https://github.com/sunwayliving/BSC-MEV-Frontrunning-Sandwich-Bot-Opensource

- ✅ Open source
- ✅ Sandwich attack bot
- ✅ Python implementation
- ✅ Miễn phí

#### C. CelestiaNFT/MEV-BOT
**Repository:** https://github.com/CelestiaNFT/MEV-BOT

- "FASTEST MEV BOT ON ETHEREUM AND BSC"
- Multi-chain support

#### D. NorVirae/mev-triangular-arbitrage-bot-contract
**Repository:** https://github.com/NorVirae/mev-triangular-arbitrage-bot-contract

- Arbitrage bot cho Uniswap V2 forks
- Support BSC, Polygon, Ethereum

---

## 🔥 SO SÁNH CÁC DỊCH VỤ

| Dịch Vụ | Method | Chi Phí | Đặc Điểm | Khuyên Dùng |
|---------|--------|---------|----------|-------------|
| **NodeReal** | `sendBundle()` | Miễn phí (API key) | BEP-322, Plugin chính thức | ⭐⭐⭐⭐⭐ |
| **48Club** | `eth_sendBundle` | ? (Research cần) | Flashbots-like, Auction | ⭐⭐⭐⭐ |
| **bloXroute** | `blxr_submit_bundle` | $5k/tháng | Professional, Guaranteed | ⭐⭐ (Chỉ cho whales) |
| **General** | Public mempool | Gas fees | No guarantee, High risk | ⭐⭐⭐ |

---

## 📊 BUNDLE VS PUBLIC MEMPOOL

### Ưu Điểm Bundle:

```
✅ Privacy: Transactions KHÔNG hiện trên P2P mempool
✅ Atomicity: All-or-nothing execution
✅ Ordering: Guaranteed transaction order
✅ Gas Protection: Failed tx không tốn gas (với relay)
✅ MEV Protection: Không bị frontrun
```

### Nhược Điểm Bundle:

```
❌ Complexity: Phức tạp hơn normal tx
❌ Fees: Bundle price có thể cao hơn
❌ Competition: Phải compete với searchers khác
❌ Latency: Có thể chậm hơn (vài block)
```

---

## 🛠️ SETUP THỰC TẾ

### Option 1: NodeReal (Recommended cho Beginners)

```bash
# 1. Đăng ký NodeReal account
# https://nodereal.io

# 2. Tạo API key
# Dashboard → API Keys → Create

# 3. Install package
npm install @node-real/web3-plugin-bundle web3

# 4. Code
const { Web3 } = require("web3");
const { Web3BundlePlugin } = require("@node-real/web3-plugin-bundle");

const web3 = new Web3("https://bsc-mainnet.nodereal.io/v1/YOUR_API_KEY");
web3.registerPlugin(new Web3BundlePlugin());

// Ready to use!
```

### Option 2: 48Club (Advanced)

```bash
# 1. Research documentation
# https://docs.48.club

# 2. No special packages needed
npm install web3

# 3. Direct RPC calls
const web3 = new Web3('https://puissant-bsc.48.club');
```

### Option 3: bloXroute (Enterprise)

```bash
# 1. Contact bloXroute sales
# 2. Setup $5k/month subscription
# 3. Get authorization header
# 4. Use with axios/fetch
```

---

## 💡 BEST PRACTICES

### 1. Bundle Price

```javascript
// ❌ SAI: Dùng gas price thông thường
const gasPrice = await web3.eth.getGasPrice();

// ✅ ĐÚNG: Dùng bundle price
const bundlePrice = await web3.bundle.bundlePrice();

// Tại sao? Bundle price cao hơn để compete trong auction
```

### 2. Transaction Ordering

```javascript
// Bundle transactions theo thứ tự CHÍNH XÁC

const bundle = {
  txs: [
    approveRawTx,    // ← TRƯỚC: Approve token
    swapRawTx,       // ← SAU: Swap
  ]
};

// ⚠️ Nếu đảo thứ tự → Bundle FAIL!
```

### 3. Nonce Management

```javascript
// Tất cả txs trong bundle PHẢI có nonce liên tiếp

const baseNonce = await web3.eth.getTransactionCount(myAddress);

const tx1 = { ...params, nonce: baseNonce };
const tx2 = { ...params, nonce: baseNonce + 1 };
const tx3 = { ...params, nonce: baseNonce + 2 };

// ❌ KHÔNG được skip nonce: baseNonce, baseNonce+2, baseNonce+3
```

### 4. maxBlockNumber

```javascript
// Nếu bundle không được mine trong N blocks → tự động hủy

const currentBlock = await web3.eth.getBlockNumber();

await web3.bundle.sendBundle({
  txs: signedTxs,
  maxBlockNumber: currentBlock + 5, // ← Bundle hợp lệ trong 5 blocks
});

// 0 hoặc không set = unlimited (rủi ro!)
```

### 5. Reverting Transactions

```javascript
// Một số tx có thể fail KHÔNG làm fail cả bundle

await web3.bundle.sendBundle({
  txs: [tx1, tx2, tx3],
  revertingTxHashes: [
    hash2, // ← Tx2 được phép revert
  ]
});

// Use case: Arbitrage với slippage cao
```

---

## 🎯 WORKFLOW HOÀN CHỈNH

```javascript
// ===== COMPLETE ARBITRAGE BOT VỚI BUNDLE =====

const { Web3 } = require("web3");
const { Web3BundlePlugin } = require("@node-real/web3-plugin-bundle");

// 1. Setup
const web3 = new Web3("https://bsc-mainnet.nodereal.io/v1/YOUR_API_KEY");
web3.registerPlugin(new Web3BundlePlugin());

// 2. Monitor mempool hoặc blocks
web3.eth.subscribe('pendingTransactions').on('data', async (txHash) => {

  // 3. Detect arbitrage opportunity
  const opportunity = await detectArbitrage(txHash);

  if (opportunity.profit > MIN_PROFIT) {

    // 4. Prepare bundle transactions
    const nonce = await web3.eth.getTransactionCount(myAddress);
    const bundlePrice = await web3.bundle.bundlePrice();

    // Tx 1: Swap on DEX A
    const tx1 = {
      from: myAddress,
      to: UNISWAP_ROUTER,
      data: swapCalldata,
      gas: 200000,
      gasPrice: bundlePrice,
      nonce: nonce
    };

    // Tx 2: Swap on DEX B
    const tx2 = {
      from: myAddress,
      to: SUSHISWAP_ROUTER,
      data: swapCalldata2,
      gas: 200000,
      gasPrice: bundlePrice,
      nonce: nonce + 1
    };

    // 5. Sign transactions
    const signed1 = await web3.eth.accounts.signTransaction(tx1, privateKey);
    const signed2 = await web3.eth.accounts.signTransaction(tx2, privateKey);

    // 6. Send bundle
    const bundleHash = await web3.bundle.sendBundle({
      txs: [signed1.rawTransaction, signed2.rawTransaction],
      maxBlockNumber: await web3.eth.getBlockNumber() + 3,
    });

    console.log(`Bundle sent: ${bundleHash}`);

    // 7. Monitor bundle status
    const checkStatus = setInterval(async () => {
      const status = await web3.bundle.queryBundle(bundleHash);
      console.log("Status:", status);

      if (status.bundleStatus === 'mined') {
        console.log(`✅ Arbitrage executed! Block: ${status.blockNumber}`);
        clearInterval(checkStatus);
      }
    }, 3000);
  }
});
```

---

## 🔐 BẢO MẬT

### 1. Private Key

```javascript
// ❌ NGUY HIỂM: Hardcode private key
const privateKey = "0x1234...";

// ✅ AN TOÀN: Dùng environment variables
require('dotenv').config();
const privateKey = process.env.PRIVATE_KEY;
```

### 2. API Keys

```javascript
// ❌ Commit .env vào git
// .env
NODEREAL_API_KEY=abc123

// ✅ Add vào .gitignore
// .gitignore
.env
*.key
```

### 3. Bundle Privacy

```javascript
// Bundle transactions KHÔNG public trên mempool
// → An toàn hơn normal transactions
// → NHƯNG vẫn visible sau khi mine

// ⚠️ Không gửi sensitive operations qua bundle
```

---

## 📖 TÀI LIỆU THAM KHẢO

### Official Docs:

1. **NodeReal Bundle API**
   - https://docs.nodereal.io/reference/nr-bundle

2. **48Club Puissant Builder**
   - https://docs.48.club/puissant-builder/send-bundle

3. **bloXroute BSC Bundle**
   - https://docs.bloxroute.com/bsc-and-eth/apis/transaction-bundles/bundle-submission/bsc-bundle-submission

4. **BEP-322 (BSC Bundle Specification)**
   - https://github.com/bnb-chain/BEPs/blob/master/BEPs/BEP322.md

### GitHub Repositories:

1. **node-real/web3.js-plugin-bundle** (Khuyên dùng)
   - https://github.com/node-real/web3.js-plugin-bundle

2. **DonggeunYu/MEV-Attack-on-the-BSC** (Case study)
   - https://github.com/DonggeunYu/MEV-Attack-on-the-BSC

3. **sunwayliving/BSC-MEV-Frontrunning-Sandwich-Bot-Opensource** (Open source)
   - https://github.com/sunwayliving/BSC-MEV-Frontrunning-Sandwich-Bot-Opensource

### Learning Resources:

1. **BSC MEV Documentation**
   - https://docs.bnbchain.org/bnb-smart-chain/validator/mev/user-guide/

2. **Flashbots (Ethereum - For comparison)**
   - https://docs.flashbots.net/

3. **MEV on BSC - Medium Article**
   - https://blocksecteam.medium.com/the-two-sides-of-the-private-tx-service-on-binance-smart-chain-a76917c3ce51

---

## ⚠️ LƯU Ý QUAN TRỌNG

### 1. BSC ≠ Ethereum

```
❌ Flashbots KHÔNG hỗ trợ BSC
❌ eth_sendBundle trên BSC KHÔNG phải Flashbots
✅ Dùng NodeReal/48Club/bloXroute thay thế
```

### 2. Validators Participation

```
BSC có 21 validators
→ KHÔNG phải tất cả đều support bundle
→ NodeReal: Một số validators
→ 48Club: Một số validators
→ bloXroute: Nhiều validators

→ Bundle có thể không được mine ngay
```

### 3. Bundle Competition

```
Nhiều searchers compete cùng lúc
→ Phải bid gas price cao
→ Bundle price > normal gas price
→ Profit phải đủ lớn để cover fees
```

### 4. Failed Bundles

```
Bundle có thể FAIL vì:
- Gas price quá thấp (outbid)
- maxBlockNumber hết hạn
- Transaction revert (nếu không trong revertingTxHashes)
- Nonce conflict
- Validators không support

→ KHÔNG mất gas (ưu điểm!)
→ NHƯNG mất cơ hội (nhược điểm!)
```

---

## 🎓 KẾT LUẬN

### Khuyến Nghị Theo Level:

**Beginner:**
- ✅ Dùng **NodeReal** (Miễn phí, dễ dùng)
- ✅ Start với `@node-real/web3-plugin-bundle`
- ✅ Test trên Testnet trước

**Intermediate:**
- ✅ Research **48Club** Puissant Builder
- ✅ So sánh profits giữa NodeReal vs 48Club
- ✅ Implement monitoring & statistics

**Advanced:**
- ✅ Evaluate **bloXroute** (nếu volume lớn)
- ✅ Build hybrid strategy (public + bundle)
- ✅ Optimize bundle bidding algorithm

**Professional:**
- ✅ Direct validator relationships
- ✅ Custom MEV infrastructure
- ✅ Multi-chain MEV strategies

---

## 📞 SUPPORT & COMMUNITY

**NodeReal:**
- Discord: https://discord.gg/nodereal
- Telegram: @NodeRealio

**48Club:**
- Documentation: https://docs.48.club
- (Check website for community links)

**bloXroute:**
- Discord: https://discord.gg/bloxroute
- Website: https://bloxroute.com

---

**Tạo bởi:** Claude
**Ngày:** 2025-01-13
**Phiên bản:** 1.0
**License:** Educational purposes only
